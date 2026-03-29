// Workspace Provider — bridges Agent Loop with LLM API + Workspace Instance

import type { AgentProvider } from './loop'
import type { ConversationMessage, ContentBlock, ToolResult, ToolCallSummary, LLMResponse, SkillDefinition } from '../types'
import { WorkspaceInstance } from '../workspace/types'
import { toolSchemas } from '../tools/schemas'
import { buildIdentityBlock, buildBehaviorBlock, buildWorkspaceBlock } from './system-prompt'
import { buildSkillReminder, buildMemoryReminder } from './system-reminder'
import type { MemoryDocument } from '../db/memory-models'
import { callAnthropicAPIStream, StreamResult } from './llm-api'

/** Convert raw stream result to internal LLMResponse format */
function convertStreamResult(response: StreamResult): LLMResponse {
  const content: ContentBlock[] = []
  for (const block of response.content || []) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text })
    } else if (block.type === 'tool_use') {
      content.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      })
    } else if (block.type === 'thinking') {
      content.push({ type: 'thinking', thinking: block.thinking, signature: block.signature || '' })
    } else if (block.type === 'redacted_thinking') {
      if (block.data && !(typeof block.data === 'string' && block.data.startsWith('openrouter.reasoning:'))) {
        content.push({ type: 'redacted_thinking', data: block.data })
      }
    }
  }
  return {
    content,
    stop_reason: response.stop_reason || 'end_turn',
    usage: response.usage,
  }
}

// Tool implementations
import { executRead } from '../tools/read'
import { executeWrite } from '../tools/write'
import { executeEdit } from '../tools/edit'
import { executeGlob } from '../tools/glob'
import { executeGrep } from '../tools/grep'
import { executeSkill } from '../tools/skill'
import { executeGenerateImage } from '../tools/generate-image'
import { executeAnalyzeImage } from '../tools/analyze-image'
import { executeWebSearch } from '../tools/web-search'
import { executeImageProcessor } from '../tools/image-processor'

import { executeAssembleXML } from '../tools/assemble-xml'
import { executeRenderSvg } from '../tools/render-svg'

// ==================== Provider Factory ====================

interface ProviderConfig {
  model: string
  maxTokens: number
  temperature: number
  baseUrl?: string
  apiKey?: string
  thinkingEnabled?: boolean
  thinkingBudgetTokens?: number
  conversationId?: string
}

interface ProviderCallbacks {
  onTextChunk?: (chunk: string) => void
  onToolUseStart?: (toolName: string) => void
  onToolStart?: (tool: string, input: Record<string, unknown>) => void
  onToolExecuted?: (tool: string, input: Record<string, unknown>, result: ToolResult) => void
  onThinkingDelta?: (chunk: string) => void
  onRedactedThinking?: () => void
  onImageGenerated?: (base64: string, mimeType: string, filename?: string) => void
  onAskUser?: (question: string, options?: string[]) => void
}

export function createAgentProvider(
  workspace: WorkspaceInstance,
  skills: Map<string, SkillDefinition>,
  config: ProviderConfig,
  callbacks?: ProviderCallbacks,
  memories?: MemoryDocument[],
): AgentProvider {
  const skillMetadata = Array.from(skills.values()).map(s => ({
    name: s.name,
    description: s.description,
  }))

  const tools = toolSchemas.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))

  return {
    buildRequest(messages: ConversationMessage[]) {
      // Multi-block system prompt for optimal caching:
      //   Block 1: Identity (~50 tokens, ultra-stable, no cache)
      //   Block 2: Behavior rules (~1500 tokens, stable, cache breakpoint)
      //   Block 3: Workspace files (dynamic, no cache)
      const system = [
        { type: 'text', text: buildIdentityBlock() },
        { type: 'text', text: buildBehaviorBlock(), cache_control: { type: 'ephemeral' } },
      ]

      const workspaceText = buildWorkspaceBlock(workspace)
      if (workspaceText) {
        system.push({ type: 'text', text: workspaceText })
      }

      // Convert messages — strip all historical cache_control, only add breakpoint on last message's last block
      const rawMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content.map(block => {
          if (block.type === 'text') {
            return { type: 'text', text: block.text }
          }
          if (block.type === 'image') {
            return { type: 'image', source: block.source }
          }
          if (block.type === 'tool_use') {
            return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
          }
          if (block.type === 'thinking') {
            // Skip empty signature (OpenRouter may not forward signature_delta)
            if (!block.signature) return null
            return { type: 'thinking', thinking: block.thinking, signature: block.signature }
          }
          if (block.type === 'redacted_thinking') {
            // Skip empty data and OpenRouter-injected redacted_thinking
            if (!block.data || (typeof block.data === 'string' && block.data.startsWith('openrouter.reasoning:'))) return null
            return { type: 'redacted_thinking', data: block.data }
          }
          // tool_result — content can be string or array (with image blocks)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tr: any = { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content }
          if (block.is_error) tr.is_error = true
          return tr
        }).filter(Boolean),
      }))

      // Merge consecutive same-role messages (safety net for Anthropic API's alternating role rule).
      // Normally shouldn't be needed — AskUserQuestion is stripped from messages in the loop —
      // but kept as a defensive guard against edge cases.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiMessages: typeof rawMessages = []
      for (const msg of rawMessages) {
        const prev = apiMessages[apiMessages.length - 1]
        if (prev && prev.role === msg.role) {
          // Merge content blocks into the previous message
          prev.content.push(...msg.content)
        } else {
          apiMessages.push(msg)
        }
      }

      // Inject skill reminder and memory reminder into the last user message's content (at the beginning)
      const reminderText = buildSkillReminder(skillMetadata)
      const memoryText = buildMemoryReminder(memories ?? [])
      const reminders = [memoryText, reminderText].filter(Boolean)
      if (reminders.length > 0) {
        // Find the last user message
        for (let i = apiMessages.length - 1; i >= 0; i--) {
          if (apiMessages[i].role === 'user') {
            // Inject reminders at the beginning (memory first, then skills)
            for (const text of reminders.reverse()) {
              apiMessages[i].content.unshift({ type: 'text', text })
            }
            break
          }
        }
      }

      // Add cache_control to last block of last message
      if (apiMessages.length > 0) {
        const lastMsg = apiMessages[apiMessages.length - 1]
        if (lastMsg.content.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lastMsg.content[lastMsg.content.length - 1] as any).cache_control = { type: 'ephemeral' }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req: any = {
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system,
        tools,
        messages: apiMessages,
      }

      if (config.thinkingEnabled && config.thinkingBudgetTokens) {
        req.thinking = { type: 'enabled', budget_tokens: config.thinkingBudgetTokens }
        delete req.temperature // Anthropic API requires no temperature when thinking is enabled
      }

      return req
    },

    async callLLM(request): Promise<LLMResponse> {
      const response = await callAnthropicAPIStream(
        request,
        config.baseUrl,
        config.apiKey,
        callbacks?.onTextChunk,
        callbacks?.onToolUseStart,
        callbacks?.onThinkingDelta,
        callbacks?.onRedactedThinking,
      )
      return convertStreamResult(response)
    },

    async callLLMSilent(request): Promise<LLMResponse> {
      // Silent mode — no callbacks, no SSE events to frontend
      const response = await callAnthropicAPIStream(
        request,
        config.baseUrl,
        config.apiKey,
        // All callbacks undefined → no SSE output
      )
      return convertStreamResult(response)
    },

    async executeTool(name, input) {
      switch (name) {
        case 'Read':
          return executRead(
            input as { file_path: string; offset?: number; limit?: number },
            workspace,
            skills
          )
        case 'Write':
          return executeWrite(
            input as { file_path: string; content: string },
            workspace
          )
        case 'Edit':
          return executeEdit(
            input as { file_path: string; old_string: string; new_string: string },
            workspace
          )
        case 'Glob':
          return executeGlob(
            input as { pattern: string },
            workspace
          )
        case 'Grep':
          return executeGrep(
            input as { pattern: string; path?: string },
            workspace
          )
        case 'Skill':
          return executeSkill(
            input as { name: string; args?: string },
            skills
          )
        case 'GenerateImage': {
          const genInput = input as { prompt: string; edit_previous?: boolean; output_filename?: string }
          const result = await executeGenerateImage(genInput, workspace, config.conversationId)
          // Emit image to frontend via SSE (separate from message history)
          if (!result.is_error && result.images?.length && callbacks?.onImageGenerated) {
            callbacks.onImageGenerated(result.images[0].base64, result.images[0].mimeType, genInput.output_filename)
          }
          return result
        }
        case 'AnalyzeImage':
          return executeAnalyzeImage(
            input as { image_path: string; instruction?: string; mode?: 'reverse_xml'; icons?: Array<{ id: number; x: number; y: number; width: number; height: number }>; image_width?: number; image_height?: number },
            workspace
          )
        case 'ImageProcessor': {
          const ipInput = input as { operation: 'remove_white_background' | 'crop' | 'detect_regions'; image_path: string; output_path?: string; bbox?: { x: number; y: number; width: number; height: number }; threshold?: number }
          const result = await executeImageProcessor(ipInput, workspace)
          if (!result.is_error && result.images?.length && callbacks?.onImageGenerated) {
            const filename = ipInput.output_path?.split('/').pop() ?? `${ipInput.operation}.png`
            callbacks.onImageGenerated(result.images[0].base64, result.images[0].mimeType, filename)
          }
          return result
        }
        case 'AssembleXML':
          return executeAssembleXML(
            input as { xml_path: string; manifest_path: string; conversation_id: string; output_path?: string },
            workspace
          )
        case 'RenderSvg': {
          const rsInput = input as { svg_path: string; output_path?: string; scale?: number }
          const result = await executeRenderSvg(rsInput, workspace)
          if (!result.is_error && result.images?.length && callbacks?.onImageGenerated) {
            const filename = rsInput.output_path?.split('/').pop() ?? rsInput.svg_path.replace(/\.svg$/i, '.png').split('/').pop()
            callbacks.onImageGenerated(result.images[0].base64, result.images[0].mimeType, filename)
          }
          return result
        }
        case 'WebSearch':
          return executeWebSearch(input as { query: string })
        case 'AskUserQuestion': {
          const { question, options } = input as { question: string; options?: string[] }
          callbacks?.onAskUser?.(question, options)
          // Return the question as content — the agent loop will pause via SSE
          // and the user's answer will come as a new message
          return { content: `Question sent to user: ${question}. Awaiting response...` }
        }
        default:
          return { content: `Unknown tool: ${name}`, is_error: true }
      }
    },

    onTextChunk: callbacks?.onTextChunk,
    onToolStart: callbacks?.onToolStart,
    onToolExecuted: callbacks?.onToolExecuted,
  }
}

// ==================== Overhead Estimation ====================

/**
 * Estimate the fixed token overhead of system prompt + tool schemas.
 * This portion is not compressible — excluded from the context usage progress bar.
 * Uses ~3.5 chars/token for mixed CJK+English content.
 */
export function estimateOverheadTokens(
  workspace: WorkspaceInstance,
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[],
): number {
  const CHARS_PER_TOKEN = 3.5

  // System prompt blocks
  const identityChars = buildIdentityBlock().length
  const behaviorChars = buildBehaviorBlock().length
  const workspaceChars = buildWorkspaceBlock(workspace)?.length ?? 0

  // Tool schemas
  const toolChars = JSON.stringify(tools).length

  const totalChars = identityChars + behaviorChars + workspaceChars + toolChars
  return Math.round(totalChars / CHARS_PER_TOKEN)
}

// ==================== Tool Call Summary ====================

export function summarizeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  isError: boolean
): ToolCallSummary {
  const filePath = input.file_path as string | undefined
  const displayPath = filePath?.replace(/^\/workspace\//, '') || ''

  let action: string
  switch (toolName) {
    case 'Read': action = `读取了 ${displayPath}`; break
    case 'Edit': action = `修改了 ${displayPath}`; break
    case 'Write': action = `写入了 ${displayPath}`; break
    case 'Glob': action = `搜索了文件模式 ${input.pattern}`; break
    case 'Grep': action = `搜索了内容 ${input.pattern}`; break
    case 'Skill': action = `加载了 Skill: ${input.name}`; break
    case 'GenerateImage': action = '生成了图片'; break
    case 'AnalyzeImage': action = `分析了图片 ${displayPath}`; break
    case 'WebSearch': action = `搜索了 "${input.query}"`; break
    case 'AskUserQuestion': action = '向用户提问'; break
    default: action = `调用了 ${toolName}`
  }

  return { tool: toolName, file_path: filePath, action, is_error: isError }
}
