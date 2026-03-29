import { NextRequest, NextResponse } from 'next/server'
import { getConversation, deleteConversation, updateConversationFields } from '@/lib/db/repository'

/** Map workspace paths to MongoDB field paths (for frontend artifact edits) */
const PATH_TO_FIELD: Record<string, string> = {
  'output/diagram.xml': 'output.diagram_xml',
  'output/draw-prompt.md': 'output.draw_prompt',
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const conversation = await getConversation(id)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    return NextResponse.json(conversation)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { path, content } = await req.json()

    if (!path || typeof content !== 'string') {
      return NextResponse.json({ error: 'Missing path or content' }, { status: 400 })
    }

    const field = PATH_TO_FIELD[path]
    if (!field) {
      return NextResponse.json({ error: `Unknown artifact path: ${path}` }, { status: 400 })
    }

    await updateConversationFields(id, { [field]: content })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const deleted = await deleteConversation(id)
    if (!deleted) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}
