import { NextRequest } from 'next/server'
import { ConversationMessage, ModelProvider, ToolCallSummary, ImageAttachment, ContentBlock } from '@/lib/types'
import { createAgentProvider, summarizeToolCall, estimateOverheadTokens } from '@/lib/agent/provider'
import { agentLoop } from '@/lib/agent/loop'
import { createWorkspaceInstance } from '@/lib/workspace/instance'
import { scientificDiagramWorkspace } from '@/lib/workspace/definitions/scientific-diagram'
import { loadSkills } from '@/lib/skills/loader'
import { toolSchemas } from '@/lib/tools/schemas'
import {
  createConversation,
  getConversation,
  updateConversationFields,
  appendMessages,
  updateTitle,
  replaceCompactedMessages,
} from '@/lib/db/repository'
import { ConversationDoc } from '@/lib/types'
import { selectMemories } from '@/lib/agent/memory-selector'
import { extractMemories } from '@/lib/agent/memory-extractor'
import { createMemory } from '@/lib/db/memory-repository'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { conversation_id, message, images, settings } = body as {
    conversation_id?: string
    message: string
    images?: ImageAttachment[]
    settings?: { orchestrator_model?: ModelProvider; target_conference?: string }
  }

  console.log('[chat] POST received:', { conversation_id, message: message.slice(0, 50), settings })

  // Use TransformStream for real-time SSE flushing
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  let streamClosed = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const write = (event: Record<string, any>) => {
    if (streamClosed) return
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => { streamClosed = true })
  }

  // Run the async work in the background — the response streams immediately
  ;(async () => {
    try {
      // 1. Get or create conversation
      let conversation
      if (conversation_id) {
        conversation = await getConversation(conversation_id)
      }
      if (!conversation) {
        conversation = await createConversation(settings)
      }
      const convId = conversation.conversation_id
      const convDoc = conversation.toObject() as unknown as ConversationDoc

      // 1b. Send conversation_id immediately so frontend can update sidebar
      if (!conversation_id) {
        write({ type: 'conversation_started', conversation_id: convId })
      }

      // 2. Update user input immediately
      await updateConversationFields(convId, {
        user_input: message,
        ...(settings?.target_conference
          ? { 'settings.target_conference': settings.target_conference }
          : {}),
      })

      // 3. Create workspace instance with immediate DB persistence on write
      const workspace = createWorkspaceInstance(scientificDiagramWorkspace, convDoc, {
        onWrite: async (field, value) => {
          await updateConversationFields(convId, { [field]: value })
        },
      })
      await workspace.write('input/user-content.md', message)

      // 4. Load skills
      const skills = loadSkills()

      // 4b. Select relevant memories for this conversation
      const selectedMemories = await selectMemories(message)
      if (selectedMemories.length > 0) {
        console.log('[chat] Selected', selectedMemories.length, 'memories:', selectedMemories.map(m => m.name))
      }

      // 5. Create Agent Provider with SSE callbacks
      const modelProvider = settings?.orchestrator_model ?? convDoc.settings.orchestrator_model ?? 'anthropic/claude-opus-4-6'
      console.log('[chat] Creating provider with model:', modelProvider)

      const toolCallSummaries: ToolCallSummary[] = []

      const provider = createAgentProvider(
        workspace,
        skills,
        {
          model: modelProvider,
          maxTokens: 32768,
          temperature: 1,
          conversationId: convId,
        },
        {
          onTextChunk(chunk) {
            write({ type: 'text_delta', text: chunk })
          },
          onToolUseStart(toolName) {
            write({ type: 'tool_start', tool: toolName })
          },
          onToolExecuted(tool, input, result) {
            const summary = summarizeToolCall(tool, input, !!result.is_error)
            toolCallSummaries.push(summary)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const evt: any = {
              type: 'tool_done',
              tool: summary.tool,
              file_path: summary.file_path,
              action: summary.action,
              is_error: summary.is_error,
            }
            // For Write tool, include content for frontend artifact extraction
            if (tool === 'Write' && !result.is_error) {
              evt.content = input.content
            }
            // For Edit tool, include updated file content for workspace sync
            if (tool === 'Edit' && !result.is_error && result.updatedContent) {
              evt.content = result.updatedContent
            }
            // GenerateImage base64 is sent separately via onImageGenerated → 'image' event
            // Don't include it in tool_done to avoid a multi-MB SSE message
            write(evt)
          },
          onThinkingDelta(chunk) {
            write({ type: 'thinking_delta', text: chunk })
          },
          onRedactedThinking() {
            write({ type: 'redacted_thinking' })
          },
          onImageGenerated(base64, mimeType, filename) {
            write({ type: 'image', base64, mime_type: mimeType, output_filename: filename })
          },
          onAskUser(question, options) {
            write({ type: 'ask_user', question, options })
          },
        },
        selectedMemories,
      )

      // 6. Build messages — prefer compacted_messages if available (post-compaction)
      const compactedMsgs = (convDoc.compacted_messages ?? []) as ConversationMessage[]
      const historyMessages = compactedMsgs.length > 0
        ? compactedMsgs
        : (convDoc.messages ?? []) as ConversationMessage[]
      // Build user message — include image blocks before text (if user uploaded images)
      const userContent: ContentBlock[] = []
      if (images?.length) {
        for (const img of images) {
          userContent.push({
            type: 'image',
            source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
          })
        }
      }
      userContent.push({ type: 'text', text: message })

      const userMessage: ConversationMessage = {
        role: 'user',
        content: userContent,
        timestamp: new Date(),
      }
      const allMessages = [...historyMessages, userMessage]

      // Save user message to DB immediately
      await appendMessages(convId, [userMessage])

      // 6b. Estimate overhead tokens (system prompt + tools — fixed, not compressible)
      const overheadTokens = estimateOverheadTokens(workspace, toolSchemas)

      // 7. Run agent loop (saves all messages after completion)
      const result = await agentLoop(provider, allMessages, {
        maxRounds: 20,
        workspace,
        overheadTokens,
        onCompactionStart(preTokens) {
          write({ type: 'compaction_start', input_tokens: preTokens })
        },
        onCompactionDone() {
          write({ type: 'compaction_done' })
        },
        onTokenUsage(totalInputTokens) {
          write({ type: 'token_usage', total_input_tokens: totalInputTokens, overhead_tokens: overheadTokens })
        },
      })
      console.log('[chat] Agent loop completed. Tool calls:', result.toolCalls.length)

      // 8. Save messages
      if (result.compacted) {
        // After compaction, replace the compacted_messages with the rebuilt messages
        await replaceCompactedMessages(convId, result.messages)
        console.log('[chat] Saved compacted messages. Compaction count incremented.')
      } else {
        // Normal: append only new messages (skip history + user message already saved)
        const newMessages = result.messages.slice(allMessages.length)
        if (newMessages.length > 0) {
          await appendMessages(convId, newMessages)
        }
      }

      // 9. Auto-generate title
      if (!conversation_id) {
        const title = message.length > 30 ? message.slice(0, 30) + '...' : message
        await updateTitle(convId, title)
      }

      // 10. Done event (or waiting_for_user if AskUserQuestion paused the loop)
      write({
        type: result.waitingForUser ? 'waiting_for_user' : 'done',
        conversation_id: convId,
        tool_calls: toolCallSummaries,
        usage: result.usage,
      })
      console.log('[chat] Done.')

      // 11. Async memory extraction (fire-and-forget, does not block response)
      if (!result.waitingForUser) {
        extractMemories(result.messages, selectedMemories, modelProvider)
          .then(async (newMemories) => {
            for (const mem of newMemories) {
              await createMemory({
                name: mem.name,
                type: mem.type,
                content: mem.content,
                tags: mem.tags,
              })
              console.log('[memory] Auto-extracted:', mem.name, `(${mem.type})`)
            }
          })
          .catch(err => console.error('[memory] Extraction failed:', (err as Error).message))
      }
    } catch (err) {
      const error = err as Error
      console.error('[chat] ERROR:', error.message, error.cause ? `| Cause: ${(error.cause as Error)?.message ?? error.cause}` : '')
      write({ type: 'error', message: (err as Error).message })
    } finally {
      try { await writer.close() } catch { /* stream already closed (client aborted) */ }
    }
  })()

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
