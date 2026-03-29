import { ToolResult } from '../types'
import { WorkspaceInstance } from '../workspace/types'

interface GenerateImageInput {
  prompt: string
  edit_previous?: boolean
  output_filename?: string
}

const IMAGE_MODEL = 'google/gemini-3-pro-image-preview'

// ==================== Session Management ====================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenRouterMessage = { role: string; content: string | any[] }

interface ImageSession {
  messages: OpenRouterMessage[]
  lastImageBase64: string | null
  lastImageMimeType: string
  lastTextResponse: string
  createdAt: number
}

/** Session TTL: 1 hour */
const SESSION_TTL_MS = 60 * 60 * 1000

/** Per-conversation session — keyed by conversationId to survive across API calls */
const sessions = new Map<string, ImageSession>()

/** Clean up expired sessions */
function cleanExpiredSessions() {
  const now = Date.now()
  for (const [key, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(key)
    }
  }
}

// ==================== Main Entry ====================

/**
 * Generate or edit an image using Gemini's image generation via OpenRouter.
 * Supports multi-turn editing: first call generates, subsequent calls with
 * edit_previous=true continue the conversation preserving full context.
 */
export async function executeGenerateImage(
  input: GenerateImageInput,
  workspace: WorkspaceInstance,
  conversationId?: string
): Promise<ToolResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return { content: 'OPENROUTER_API_KEY is not set', is_error: true }
  }

  const { prompt, edit_previous = false, output_filename = 'image.png' } = input
  const outputPath = `output/${output_filename}`
  const sessionKey = conversationId ?? '__default__'

  // Periodically clean up expired sessions
  cleanExpiredSessions()

  // Build messages based on session state
  let messages: OpenRouterMessage[]

  if (edit_previous) {
    const session = sessions.get(sessionKey)
    if (!session || !session.lastImageBase64) {
      return {
        content: 'No previous image generation session found. Call GenerateImage without edit_previous first.',
        is_error: true,
      }
    }

    // Rebuild assistant message in OpenRouter multi-part format
    const assistantContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
    if (session.lastTextResponse) {
      assistantContent.push({ type: 'text', text: session.lastTextResponse })
    }
    assistantContent.push({
      type: 'image_url',
      image_url: { url: `data:${session.lastImageMimeType};base64,${session.lastImageBase64}` },
    })

    // Build full history: previous messages + reconstructed assistant + new user prompt
    messages = [
      ...session.messages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: prompt },
    ]

    console.log(`[generate-image] Continue session ${sessionKey} | ${session.messages.length} existing msgs | prompt: "${prompt.slice(0, 80)}"`)
  } else {
    // New session
    messages = [{ role: 'user', content: prompt }]
    sessions.delete(sessionKey)
    console.log(`[generate-image] New session ${sessionKey} | prompt: "${prompt.slice(0, 80)}"`)
  }

  console.log(`[generate-image] Sending ${messages.length} messages to ${IMAGE_MODEL}`)

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://pegasus.local',
        'X-Title': 'Pegasus',
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages,
        modalities: ['text', 'image'],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`OpenRouter API error ${res.status}: ${errText}`)
    }

    const data = await res.json()
    const choice = data.choices?.[0]?.message

    if (!choice) {
      throw new Error('No response from model')
    }

    // Extract image and text from response
    const { imageBase64, imageMimeType, textResponse } = parseResponse(choice)

    if (imageBase64) {
      await workspace.write(outputPath, imageBase64)
      console.log(`[generate-image] Image saved to ${outputPath}, mimeType: ${imageMimeType}`)

      // Store all messages up to this point (the assistant turn will be reconstructed
      // from lastImageBase64/lastTextResponse on the next edit_previous call)
      const updatedMessages = [...messages]

      sessions.set(sessionKey, {
        messages: updatedMessages,
        lastImageBase64: imageBase64,
        lastImageMimeType: imageMimeType,
        lastTextResponse: textResponse,
        createdAt: sessions.get(sessionKey)?.createdAt ?? Date.now(),
      })

      console.log(`[generate-image] Session updated | total msgs for next call: ${updatedMessages.length + 2}`)

      return {
        content: `Image ${edit_previous ? 'edited' : 'generated'} successfully (${imageMimeType}) and saved to ${outputPath}`,
        images: [{ base64: imageBase64, mimeType: imageMimeType }],
      }
    }

    // No image in response
    console.log('[generate-image] No image found. Response keys:', Object.keys(choice))
    console.log('[generate-image] Content type:', typeof choice.content, Array.isArray(choice.content) ? 'array' : '')
    console.log('[generate-image] Text:', textResponse.slice(0, 200))

    return {
      content: `No image generated. Model response: ${textResponse || '(empty)'}`,
      is_error: true,
    }
  } catch (err) {
    const errMsg = (err as Error).message
    console.error('[generate-image] Error:', errMsg)
    return {
      content: `Image generation error: ${errMsg}`,
      is_error: true,
    }
  }
}

// ==================== Response Parsing ====================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResponse(choice: any): {
  imageBase64: string | null
  imageMimeType: string
  textResponse: string
} {
  let imageBase64: string | null = null
  let imageMimeType = 'image/png'
  let textResponse = typeof choice.content === 'string' ? choice.content : ''

  // Method 1: OpenRouter images[] array
  const images = choice.images as { type: string; image_url: { url: string } }[] | undefined
  if (images && images.length > 0) {
    for (const img of images) {
      if (img.image_url?.url) {
        const match = img.image_url.url.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          imageMimeType = match[1]
          imageBase64 = match[2]
          break
        }
      }
    }
  }

  // Method 2: content array with image_url parts
  if (!imageBase64 && Array.isArray(choice.content)) {
    for (const part of choice.content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        const match = (part.image_url.url as string).match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          imageMimeType = match[1]
          imageBase64 = match[2]
        }
      }
      if (part.type === 'text' && part.text) {
        textResponse = part.text
      }
    }
  }

  return { imageBase64, imageMimeType, textResponse }
}
