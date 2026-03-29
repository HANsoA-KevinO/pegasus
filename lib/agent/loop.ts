// Agent Loop — pure loop logic, no external dependencies

import type { ContentBlock, ConversationMessage, ToolResult, ToolCallRecord, TokenUsage, AgentLoopResult, LLMResponse, ToolResultContent } from '../types'
import type { WorkspaceInstance } from '../workspace/types'
import { performCompaction, getTotalInputTokens, DEFAULT_COMPACTION_THRESHOLD } from './compaction'

// ==================== Interfaces ====================

export interface AgentProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildRequest(messages: ConversationMessage[]): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callLLM(request: any): Promise<LLMResponse>
  /** Silent LLM call — no SSE callbacks (used for compaction summary generation) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callLLMSilent(request: any): Promise<LLMResponse>
  executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult>
  onTextChunk?(chunk: string): void
  onToolStart?(tool: string, input: Record<string, unknown>): void
  onToolExecuted?(tool: string, input: Record<string, unknown>, result: ToolResult): void
}

export interface AgentLoopOptions {
  maxRounds?: number
  /** Token threshold for triggering compaction (default: 140000) */
  compactionThreshold?: number
  /** Workspace instance — required for compaction to snapshot file contents */
  workspace?: WorkspaceInstance
  /** Called when compaction starts */
  onCompactionStart?: (preTokens: number) => void
  /** Called when compaction finishes */
  onCompactionDone?: () => void
  /** Called after each LLM call with total input tokens and estimated overhead */
  onTokenUsage?: (totalInputTokens: number) => void
  /** Estimated fixed overhead tokens (system prompt + tools), excluded from progress bar */
  overheadTokens?: number
}

// ==================== Agent Loop ====================

export async function agentLoop(
  provider: AgentProvider,
  initialMessages: ConversationMessage[],
  options?: AgentLoopOptions
): Promise<AgentLoopResult> {
  const messages = [...initialMessages]
  const maxRounds = options?.maxRounds ?? 40
  const compactionThreshold = options?.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD
  const toolCalls: ToolCallRecord[] = []
  const totalUsage: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  let compacted = false
  let compactionSummary: string | undefined

  for (let i = 0; i < maxRounds; i++) {
    const request = provider.buildRequest(messages)
    const response = await provider.callLLM(request)

    accumulateUsage(totalUsage, response.usage)

    // Report token usage for frontend progress bar
    const lastInputTokens = getTotalInputTokens(response.usage)
    options?.onTokenUsage?.(lastInputTokens)

    // Check if compaction is needed before adding assistant message
    if (lastInputTokens > compactionThreshold && options?.workspace) {
      options.onCompactionStart?.(lastInputTokens)
      const compactionResult = await performCompaction(
        provider, messages, options.workspace, lastInputTokens
      )
      // Replace messages with compacted version
      messages.length = 0
      messages.push(...compactionResult.compactedMessages)
      accumulateUsage(totalUsage, compactionResult.usage)
      compacted = true
      compactionSummary = compactionResult.summary
      options.onCompactionDone?.()
    }

    // Now add the assistant message
    messages.push({
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
    })

    // Check if there are tool_use blocks in the response content, regardless of stop_reason.
    // This handles the case where stop_reason='max_tokens' but complete tool_use blocks exist.
    const hasToolUses = response.content.some(b => b.type === 'tool_use')

    // AI says "I'm done" and no pending tools → end
    if (response.stop_reason === 'end_turn' && !hasToolUses) {
      return { messages, text: extractText(response), toolCalls, usage: totalUsage, compacted, compactionSummary }
    }

    // Process tool calls if present (stop_reason may be 'tool_use' or 'max_tokens')
    if (hasToolUses) {
      const toolUses = extractToolUses(response)

      // Separate AskUserQuestion from regular tools.
      // AskUserQuestion is NOT a real tool — it only fires an SSE event.
      // We strip it from the assistant message and skip its tool_result,
      // so the user's answer arrives as a plain text message, maintaining
      // clean assistant[text] → user[text] alternation.
      const askUserTool = toolUses.find(tu => tu.name === 'AskUserQuestion')
      const regularTools = toolUses.filter(tu => tu.name !== 'AskUserQuestion')

      // Execute AskUserQuestion for its SSE side-effect only
      if (askUserTool) {
        provider.onToolStart?.(askUserTool.name, askUserTool.input)
        const result = await provider.executeTool(askUserTool.name, askUserTool.input)
        toolCalls.push({ tool: askUserTool.name, input: askUserTool.input, result })
        provider.onToolExecuted?.(askUserTool.name, askUserTool.input, result)

        // Strip AskUserQuestion tool_use from the saved assistant message
        const lastMsg = messages[messages.length - 1]
        if (lastMsg.role === 'assistant') {
          lastMsg.content = lastMsg.content.filter(
            block => !(block.type === 'tool_use' && block.id === askUserTool.id)
          )
        }
      }

      // Execute regular tools normally with tool_results
      if (regularTools.length > 0) {
        const results: ContentBlock[] = []
        for (const tu of regularTools) {
          provider.onToolStart?.(tu.name, tu.input)
          const result = await provider.executeTool(tu.name, tu.input)
          toolCalls.push({ tool: tu.name, input: tu.input, result })
          provider.onToolExecuted?.(tu.name, tu.input, result)
          // Build tool_result content — if tool returned images, use array format
          // so Claude receives them as image blocks (pixel-based token counting)
          let toolResultContent: ToolResultContent = result.content
          if (result.images && result.images.length > 0) {
            // Filter out images with invalid base64 data to prevent API errors
            const validImages = result.images.filter(img =>
              img.base64 && img.base64.length > 0 && /^[A-Za-z0-9+/=\s]+$/.test(img.base64)
            )
            if (validImages.length > 0) {
              toolResultContent = [
                ...validImages.map(img => ({
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: detectMimeType(img.base64, img.mimeType),
                    data: img.base64.replace(/\s/g, ''),
                  },
                })),
                { type: 'text' as const, text: result.content },
              ]
            }
          }

          results.push({
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: toolResultContent,
            is_error: result.is_error,
          })
        }

        // Add cache_control to last tool_result for prompt caching
        const last = results[results.length - 1]
        if (last.type === 'tool_result') {
          last.cache_control = { type: 'ephemeral' }
        }

        messages.push({
          role: 'user',
          content: results,
          timestamp: new Date(),
        })
      }

      // If AskUserQuestion was called, stop the loop — user needs to respond.
      // The user's answer will come as a plain text user message in the next /api/chat call.
      if (askUserTool) {
        return { messages, text: '', toolCalls, usage: totalUsage, waitingForUser: true, compacted, compactionSummary }
      }
    }
  }

  return { messages, text: '', toolCalls, usage: totalUsage, truncated: true, compacted, compactionSummary }
}

// ==================== Helpers ====================

function extractText(response: LLMResponse): string {
  return response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
}

function extractToolUses(response: LLMResponse): { id: string; name: string; input: Record<string, unknown> }[] {
  return response.content
    .filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use')
    .map(b => ({ id: b.id, name: b.name, input: b.input }))
}

/** Detect actual image MIME type from base64 magic bytes, falling back to the declared type */
function detectMimeType(base64: string, declared: string): string {
  const prefix = base64.replace(/\s/g, '').slice(0, 16)
  // JPEG: starts with /9j/ (FF D8 FF)
  if (prefix.startsWith('/9j/')) return 'image/jpeg'
  // PNG: starts with iVBOR (89 50 4E 47)
  if (prefix.startsWith('iVBOR')) return 'image/png'
  // GIF: starts with R0lG (47 49 46)
  if (prefix.startsWith('R0lG')) return 'image/gif'
  // WebP: starts with UklG (52 49 46 46)
  if (prefix.startsWith('UklG')) return 'image/webp'
  return declared
}

function accumulateUsage(total: TokenUsage, delta: TokenUsage) {
  total.input_tokens += delta.input_tokens || 0
  total.output_tokens += delta.output_tokens || 0
  total.cache_creation_input_tokens = (total.cache_creation_input_tokens || 0) + (delta.cache_creation_input_tokens || 0)
  total.cache_read_input_tokens = (total.cache_read_input_tokens || 0) + (delta.cache_read_input_tokens || 0)
}
