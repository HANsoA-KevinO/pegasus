'use client'

import { useMemo } from 'react'
import { DisplayPart } from '@/lib/types'

export interface GalleryImage {
  path: string
  label: string
  content: string  // base64
  mimeType: string
}

export interface WorkspaceArtifact {
  path: string
  label: string
  type: 'image' | 'drawio' | 'markdown' | 'text' | 'gallery'
  content: string
  mimeType?: string
  timestamp: number
  images?: GalleryImage[]  // only for type === 'gallery'
}

/** DB conversation document shape (subset needed for artifact extraction) */
export interface ConversationArtifactFields {
  analysis?: {
    domain_classification?: string
    logic_structure?: string
    style_guide?: string
    visual_spec?: string
  }
  output?: {
    draw_prompt?: string
    image_base64?: string
    diagram_xml?: string
    image_icons_only_base64?: string
    icons_transparent_base64?: string
    [key: string]: string | undefined
  }
}

const PATH_LABELS: Record<string, string> = {
  'output/image.png': '生成图片',
  'output/image_icons_only.png': 'Icons Only',
  'output/icons_transparent.png': '透明背景',

  'output/diagram.xml': 'Draw.io 图表',
  'output/draw-prompt.md': '绘图 Prompt',
  'analysis/domain-classification.md': '领域分类',
  'analysis/logic-structure.md': '逻辑结构',
  'analysis/style-guide.md': '风格指南',
  'analysis/visual-spec.md': '视觉规格',
}

function inferType(path: string): WorkspaceArtifact['type'] {
  if (path === 'output/diagram.xml' || path.endsWith('.drawio')) return 'drawio'
  if (path.endsWith('.png') || path.endsWith('.jpg')) return 'image'
  if (path.endsWith('.md')) return 'markdown'
  return 'text'
}

function normalizePath(path: string): string {
  return path.replace(/^\/workspace\//, '').replace(/^workspace\//, '').replace(/^\//, '')
}

/**
 * Collapse multiple image artifacts into a single gallery artifact.
 * If only 1 image, leave it as-is.
 */
function collapseImagesToGallery(artifacts: WorkspaceArtifact[]): WorkspaceArtifact[] {
  const images: WorkspaceArtifact[] = []
  const others: WorkspaceArtifact[] = []

  for (const a of artifacts) {
    if (a.type === 'image') {
      images.push(a)
    } else {
      others.push(a)
    }
  }

  if (images.length <= 1) return artifacts

  const galleryImages: GalleryImage[] = images.map(img => ({
    path: img.path,
    label: img.label,
    content: img.content,
    mimeType: img.mimeType ?? 'image/png',
  }))

  const gallery: WorkspaceArtifact = {
    path: 'output/gallery',
    label: `图片集 (${images.length})`,
    type: 'gallery',
    content: images[0].content, // primary image for fallback
    mimeType: 'image/png',
    timestamp: images[0].timestamp,
    images: galleryImages,
  }

  return [gallery, ...others]
}

/**
 * Extract workspace artifacts from DisplayPart[] of the latest assistant message.
 * Watches tool_done events: Write tool carries `content`, GenerateImage carries `base64`.
 */
export function useWorkspaceArtifacts(parts: DisplayPart[]): WorkspaceArtifact[] {
  return useMemo(() => {
    const artifactMap = new Map<string, WorkspaceArtifact>()
    const now = Date.now()

    for (const part of parts) {
      if (part.type !== 'tool_call' || part.pending) continue

      // Extract from completed Write/Edit tool calls (content is passed via tool_done SSE event)
      if ((part.tool === 'Write' || part.tool === 'Edit') && !part.is_error && part.content && part.file_path) {
        const normalized = normalizePath(part.file_path)
        const type = inferType(normalized)

        artifactMap.set(normalized, {
          path: normalized,
          label: PATH_LABELS[normalized] ?? normalized.split('/').pop() ?? normalized,
          type,
          content: part.content,
          timestamp: now,
        })
      }

      // Extract image from completed GenerateImage tool calls
      // The base64 is embedded in the content field as JSON by the tool_done event
      if (part.tool === 'GenerateImage' && !part.is_error && part.content) {
        try {
          const parsed = JSON.parse(part.content)
          if (parsed.base64) {
            // Use output_filename if available, otherwise default
            const filename = parsed.output_filename ?? 'image.png'
            const path = `output/${filename}`
            artifactMap.set(path, {
              path,
              label: PATH_LABELS[path] ?? filename,
              type: 'image',
              content: parsed.base64,
              mimeType: parsed.mime_type ?? 'image/png',
              timestamp: now,
            })
          }
        } catch {
          /* ignore parse errors */
        }
      }

      // Extract image from completed ImageProcessor tool calls
      if (part.tool === 'ImageProcessor' && !part.is_error && part.content && part.file_path) {
        const normalized = normalizePath(part.file_path)
        if (inferType(normalized) === 'image') {
          artifactMap.set(normalized, {
            path: normalized,
            label: PATH_LABELS[normalized] ?? normalized.split('/').pop() ?? normalized,
            type: 'image',
            content: part.content,
            mimeType: 'image/png',
            timestamp: now,
          })
        }
      }
    }

    // Sort: image first, then svg, then others
    const artifacts = Array.from(artifactMap.values())
    artifacts.sort((a, b) => {
      const priority: Record<string, number> = { image: 0, gallery: 0, drawio: 1, markdown: 2, text: 3 }
      const pa = priority[a.type] ?? 9
      const pb = priority[b.type] ?? 9
      if (pa !== pb) return pa - pb
      return a.timestamp - b.timestamp
    })

    return collapseImagesToGallery(artifacts)
  }, [parts])
}

/** Build WorkspaceArtifact[] from DB conversation fields (for loaded conversations) */
export function buildArtifactsFromDB(doc: ConversationArtifactFields): WorkspaceArtifact[] {
  const artifacts: WorkspaceArtifact[] = []
  const now = Date.now()

  // DB field → workspace path mapping
  const fieldMap: Array<{ field: string | undefined; path: string }> = [
    { field: doc.output?.image_base64, path: 'output/image.png' },
    { field: doc.output?.image_icons_only_base64, path: 'output/image_icons_only.png' },
    { field: doc.output?.icons_transparent_base64, path: 'output/icons_transparent.png' },

    { field: doc.output?.diagram_xml, path: 'output/diagram.xml' },
    { field: doc.output?.draw_prompt, path: 'output/draw-prompt.md' },
    { field: doc.analysis?.domain_classification, path: 'analysis/domain-classification.md' },
    { field: doc.analysis?.logic_structure, path: 'analysis/logic-structure.md' },
    { field: doc.analysis?.style_guide, path: 'analysis/style-guide.md' },
    { field: doc.analysis?.visual_spec, path: 'analysis/visual-spec.md' },
  ]

  // Add individual icon slots (1-20)
  for (let i = 1; i <= 20; i++) {
    const field = doc.output?.[`icon_${i}_base64`]
    if (field) {
      fieldMap.push({ field, path: `output/icons/icon_${i}.png` })
    }
  }

  for (const { field, path } of fieldMap) {
    if (!field) continue
    const type = inferType(path)
    artifacts.push({
      path,
      label: PATH_LABELS[path] ?? path.split('/').pop() ?? path,
      type,
      content: field,
      mimeType: type === 'image' ? 'image/png' : undefined,
      timestamp: now,
    })
  }

  // Sort same as live artifacts
  artifacts.sort((a, b) => {
    const priority: Record<string, number> = { image: 0, gallery: 0, drawio: 1, markdown: 2, text: 3 }
    const pa = priority[a.type] ?? 9
    const pb = priority[b.type] ?? 9
    if (pa !== pb) return pa - pb
    return a.timestamp - b.timestamp
  })

  return collapseImagesToGallery(artifacts)
}
