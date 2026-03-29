// Compaction Engine — compresses conversation history into a structured summary
// Adapted from Claude Code's 5-step compaction pipeline for Pegasus

import type { AgentProvider } from './loop'
import type { ConversationMessage, ContentBlock, TextBlock, ImageBlock, ToolResultContent, TokenUsage } from '../types'
import type { WorkspaceInstance } from '../workspace/types'

// ==================== Types ====================

export interface CompactionResult {
  compactedMessages: ConversationMessage[]
  summary: string
  preCompactionTokens: number
  usage: TokenUsage
}

// ==================== Constants ====================

export const DEFAULT_COMPACTION_THRESHOLD = 140_000

const SUMMARY_PROMPT = `你正在总结一段关于科研图表创作的对话。请先在 <analysis> 中逐步回顾对话内容，然后在 <summary> 中产出结构化摘要。

<summary> 必须包含以下 6 个部分：
1. **用户需求**：用户想创作什么图表，核心目标和约束
2. **工作区状态**：哪些 workspace 文件已被写入，关键内容摘要
3. **分析进展**：领域分类、逻辑结构、风格参考、视觉规格的完成状态
4. **工具调用记录**：关键工具操作及其结果（重点记录 Write/Edit/GenerateImage）
5. **用户偏好与反馈**：用户表达的偏好、修正、风格要求
6. **下一步**：当前正在进行或应该继续的工作

重要规则：
- 工作区状态部分要详细，包含文件路径和关键内容
- 用户偏好部分要完整记录所有用户的修正和反馈
- 不要使用任何工具
- 你必须只输出 <summary>...</summary> 作为最终文本（可以先输出 <analysis> 作为思考过程）`

// ==================== Core ====================

/**
 * Perform compaction: generate a summary of the conversation and rebuild context.
 *
 * Pipeline:
 * 1. Snapshot workspace file contents
 * 2. Append summary prompt to messages and call LLM (silent — no SSE)
 * 3. Extract <summary> from response
 * 4. Rebuild messages: 1 user message with workspace snapshot + summary
 */
export async function performCompaction(
  provider: AgentProvider,
  messages: ConversationMessage[],
  workspace: WorkspaceInstance,
  currentInputTokens: number,
): Promise<CompactionResult> {
  const startTime = Date.now()
  console.log(`\n${'='.repeat(60)}`)
  console.log(`[compaction] STARTED — ${currentInputTokens.toLocaleString()} input tokens, ${messages.length} messages`)
  console.log(`${'='.repeat(60)}`)

  // Step 1: Snapshot workspace files for context rebuild
  console.log('[compaction] Step 1: Building workspace snapshot...')
  const workspaceSnapshot = await buildWorkspaceSnapshot(workspace)
  console.log(`[compaction] Workspace snapshot: ${workspaceSnapshot ? `${workspaceSnapshot.length} chars` : 'empty'}`)

  // Step 2: Build summary request — append summary prompt as last user message
  // Strip image content blocks from tool_results to avoid token waste in summary call
  console.log('[compaction] Step 2: Building summary request (stripping image blocks)...')
  const strippedMessages: ConversationMessage[] = messages.map(msg => {
    if (msg.role !== 'user') return msg
    const hasImage = msg.content.some(
      b => b.type === 'tool_result' && Array.isArray(b.content) &&
        (b.content as (TextBlock | ImageBlock)[]).some(c => c.type === 'image')
    )
    if (!hasImage) return msg
    return {
      ...msg,
      content: msg.content.map((b): ContentBlock => {
        if (b.type !== 'tool_result' || !Array.isArray(b.content)) return b
        const textOnly = (b.content as (TextBlock | ImageBlock)[]).filter((c): c is TextBlock => c.type === 'text')
        const content: ToolResultContent = textOnly.length > 0 ? textOnly : '[image content stripped for compaction]'
        return { ...b, content }
      }),
    }
  })
  const summaryMessages: ConversationMessage[] = [
    ...strippedMessages,
    {
      role: 'user',
      content: [{ type: 'text', text: SUMMARY_PROMPT }],
      timestamp: new Date(),
    },
  ]
  console.log(`[compaction] Summary messages: ${summaryMessages.length} (original ${messages.length} + 1 summary prompt)`)

  // Log message breakdown
  let userCount = 0, assistantCount = 0, toolResultCount = 0
  for (const msg of messages) {
    if (msg.role === 'user') {
      const hasToolResult = msg.content.some(b => b.type === 'tool_result')
      if (hasToolResult) toolResultCount++
      else userCount++
    } else {
      assistantCount++
    }
  }
  console.log(`[compaction] Message breakdown: ${userCount} user, ${assistantCount} assistant, ${toolResultCount} tool_result`)

  // Build request with lower max_tokens, call LLM silently (no SSE callbacks)
  const request = provider.buildRequest(summaryMessages)
  request.max_tokens = 4096

  console.log('[compaction] Step 3: Calling LLM for summary (silent, no SSE)...')
  const llmStartTime = Date.now()
  const response = await provider.callLLMSilent(request)
  const llmDuration = ((Date.now() - llmStartTime) / 1000).toFixed(1)
  const summaryUsage = response.usage
  console.log(`[compaction] LLM call completed in ${llmDuration}s`)
  console.log(`[compaction] Summary usage: input=${summaryUsage.input_tokens}, output=${summaryUsage.output_tokens}, cache_read=${summaryUsage.cache_read_input_tokens || 0}, cache_creation=${summaryUsage.cache_creation_input_tokens || 0}`)

  // Log full LLM output — all content blocks including thinking
  console.log(`[compaction] --- LLM output (${response.content.length} blocks) ---`)
  for (const block of response.content) {
    if (block.type === 'thinking') {
      console.log(`[compaction] [thinking] (${block.thinking.length} chars):`)
      console.log(block.thinking)
    } else if (block.type === 'redacted_thinking') {
      console.log(`[compaction] [redacted_thinking]`)
    } else if (block.type === 'text') {
      console.log(`[compaction] [text] (${block.text.length} chars):`)
      console.log(block.text)
    }
  }
  console.log(`[compaction] --- end LLM output ---`)

  // Step 3: Extract <summary> content
  const fullText = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  const summary = extractSummaryTag(fullText)
  console.log(`[compaction] Extracted summary: ${summary.length} chars`)

  // Step 4: Rebuild context as 1 user message
  console.log('[compaction] Step 5: Rebuilding compacted context...')
  const contentBlocks: ContentBlock[] = []

  // Add workspace snapshot as system-reminder
  if (workspaceSnapshot) {
    contentBlocks.push({
      type: 'text',
      text: `<system-reminder>\n${workspaceSnapshot}\n</system-reminder>`,
    })
  }

  // Add compact summary as plain text
  contentBlocks.push({
    type: 'text',
    text: `This session is being continued from a previous conversation that was compacted. The summary below covers the earlier portion of the conversation.\n\n${summary}`,
  })

  const compactedMessages: ConversationMessage[] = [
    {
      role: 'user',
      content: contentBlocks,
      timestamp: new Date(),
    },
  ]

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)
  const estimatedNewTokens = Math.round(contentBlocks.reduce((sum, b) => sum + (b.type === 'text' ? b.text.length : 0), 0) / 3.5)
  console.log(`[compaction] Rebuilt context: ${compactedMessages.length} message, ~${estimatedNewTokens.toLocaleString()} estimated tokens`)
  console.log(`[compaction] Compression: ${currentInputTokens.toLocaleString()} → ~${estimatedNewTokens.toLocaleString()} tokens (${((1 - estimatedNewTokens / currentInputTokens) * 100).toFixed(0)}% reduction)`)
  console.log(`${'='.repeat(60)}`)
  console.log(`[compaction] COMPLETED in ${totalDuration}s`)
  console.log(`${'='.repeat(60)}\n`)

  return {
    compactedMessages,
    summary,
    preCompactionTokens: currentInputTokens,
    usage: summaryUsage,
  }
}

// ==================== Helpers ====================

/**
 * Extract content from <summary>...</summary> tags.
 * Falls back to full text if tags not found.
 */
function extractSummaryTag(text: string): string {
  const match = text.match(/<summary>([\s\S]*?)<\/summary>/)
  if (match) return match[1].trim()
  // Fallback: use everything after </analysis> if present
  const analysisEnd = text.indexOf('</analysis>')
  if (analysisEnd !== -1) return text.slice(analysisEnd + '</analysis>'.length).trim()
  // Last resort: use full text
  console.warn('[compaction] WARNING: No <summary> tag found in LLM output, using full text as fallback')
  return text.trim()
}

/**
 * Build a snapshot of all workspace files with content.
 * Only includes files that have been written to (non-empty, non-readonly).
 */
async function buildWorkspaceSnapshot(workspace: WorkspaceInstance): Promise<string> {
  const files = workspace.list()
  const sections: string[] = []

  for (const filePath of files) {
    const decl = workspace.getFileDeclaration(filePath)
    if (!decl) continue
    // Skip static/readonly files (like GUIDE.md) — they're always in the system prompt
    if (decl.readOnly || decl.resolver.type === 'static') continue

    const content = await workspace.read(filePath)
    if (!content || !content.trim()) continue

    // Skip binary/image files entirely — they're base64 data, not useful in text summary
    if (filePath.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
      console.log(`[compaction]   ${filePath}: [image, ${Math.round(content.length / 1024)}KB] (skipped)`)
      sections.push(`## ${filePath}\n[image file, ${Math.round(content.length / 1024)}KB base64]`)
      continue
    }

    // Skip XML/SVG files with embedded base64 data — they're too large for the summary
    if (filePath.match(/\.(xml|svg)$/i) && content.length > 50_000) {
      console.log(`[compaction]   ${filePath}: [large file, ${Math.round(content.length / 1024)}KB] (skipped, contains embedded images)`)
      sections.push(`## ${filePath}\n[${filePath.split('.').pop()?.toUpperCase()} file with embedded icon images, ${Math.round(content.length / 1024)}KB — too large for summary]`)
      continue
    }

    console.log(`[compaction]   ${filePath}: ${content.length} chars`)

    // Truncate very long text content
    const displayContent = content.length > 2000
      ? content.slice(0, 2000) + '\n... [truncated, total ' + content.length + ' chars]'
      : content

    sections.push(`## ${filePath}\n${displayContent}`)
  }

  if (sections.length === 0) return ''

  return `The following workspace files were read/written before compaction:\n\n${sections.join('\n\n---\n\n')}`
}

/**
 * Calculate the total input tokens from a single API response's usage.
 *
 * Both Anthropic native API and OpenRouter follow the same convention:
 * - `input_tokens`: non-cached input tokens
 * - `cache_creation_input_tokens`: tokens written to cache
 * - `cache_read_input_tokens`: tokens read from cache
 * - Total context size = input_tokens + cache_read + cache_creation
 */
export function getTotalInputTokens(usage: TokenUsage): number {
  const inputTokens = usage.input_tokens || 0
  const cacheRead = usage.cache_read_input_tokens || 0
  const cacheCreation = usage.cache_creation_input_tokens || 0
  const total = inputTokens + cacheRead + cacheCreation

  if (cacheRead > 0 || cacheCreation > 0) {
    console.log(`[tokens] input=${inputTokens} cache_read=${cacheRead} cache_creation=${cacheCreation} → total=${total}`)
  }

  return total
}
