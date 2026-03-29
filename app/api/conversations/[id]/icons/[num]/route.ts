import { NextRequest, NextResponse } from 'next/server'
import { getConversation } from '@/lib/db/repository'

/**
 * Serve individual icon PNGs from MongoDB.
 * URL: /api/conversations/{conversationId}/icons/{iconNum}
 * Returns the icon as a PNG binary with CORS headers (for draw.io iframe).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; num: string }> }
) {
  try {
    const { id, num } = await params
    const iconNum = parseInt(num, 10)

    if (isNaN(iconNum) || iconNum < 1 || iconNum > 20) {
      return NextResponse.json({ error: 'Invalid icon number (1-20)' }, { status: 400 })
    }

    const conversation = await getConversation(id)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const doc = conversation.toObject()
    const base64 = doc.output?.[`icon_${iconNum}_base64`]
    if (!base64) {
      return NextResponse.json({ error: `Icon ${iconNum} not found` }, { status: 404 })
    }

    const buffer = Buffer.from(base64, 'base64')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}
