'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { WorkspaceArtifact } from '@/hooks/useWorkspaceArtifacts'
import { QuotedSelection } from '@/components/chat/ChatContainer'
import { ImageViewer } from './ImageViewer'
import { ImageGallery } from './ImageGallery'

import { DrawioEditor } from './DrawioEditor'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface WorkspacePanelProps {
  artifacts: WorkspaceArtifact[]
  isStreaming: boolean
  onQuoteSelection?: (selection: QuotedSelection) => void
  quotedSelection?: QuotedSelection | null
  onArtifactUpdate?: (path: string, content: string) => void
}

const TAB_ICONS: Record<string, string> = {
  image: '\u{1F4CA}',    // chart
  gallery: '\u{1F5BC}',  // framed picture

  drawio: '\u{1F4D0}',   // triangular ruler
  markdown: '\u{1F4DD}', // memo
  text: '\u{1F4C3}',     // page with curl
}

export function WorkspacePanel({ artifacts, isStreaming, onQuoteSelection, quotedSelection, onArtifactUpdate }: WorkspacePanelProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const userSwitched = useRef(false)
  const prevLength = useRef(artifacts.length)

  // Auto-switch to new artifact when it appears (unless user manually switched)
  useEffect(() => {
    if (artifacts.length > prevLength.current && !userSwitched.current) {
      setActiveIndex(artifacts.length - 1)
    }
    prevLength.current = artifacts.length
  }, [artifacts.length])

  // Reset user-switched flag when streaming starts
  useEffect(() => {
    if (isStreaming) {
      userSwitched.current = false
    }
  }, [isStreaming])

  const handleTabClick = (index: number) => {
    setActiveIndex(index)
    userSwitched.current = true
  }

  const activeArtifact = artifacts[activeIndex]

  if (artifacts.length === 0) {
    return (
      <div className="h-full border-r border-stone-200/60 bg-stone-50/30 flex items-center justify-center">
        <div className="text-center px-8">
          {isStreaming ? (
            <>
              <div className="w-8 h-8 mx-auto mb-3 border-2 border-stone-300 border-t-stone-500 rounded-full animate-spin" />
              <p className="text-sm text-stone-500 font-medium">Agent 正在工作中...</p>
              <p className="text-xs text-stone-400 mt-1">产物将在这里实时展示</p>
            </>
          ) : (
            <>
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-stone-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25a1.5 1.5 0 001.5 1.5z" />
                </svg>
              </div>
              <p className="text-sm text-stone-400">工作区</p>
              <p className="text-xs text-stone-300 mt-1">发送消息后，生成的产物将在这里展示</p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full border-r border-stone-200/60 bg-white flex flex-col min-w-0">
      {/* Tab bar */}
      <div className="flex-shrink-0 border-b border-stone-200/60 bg-stone-50/50">
        <div className="flex items-center gap-0.5 px-2 pt-2 overflow-x-auto">
          {artifacts.map((artifact, i) => (
            <button
              key={artifact.path}
              onClick={() => handleTabClick(i)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md
                border border-b-0 whitespace-nowrap transition-colors duration-150
                ${i === activeIndex
                  ? 'bg-white border-stone-200/60 text-stone-800 -mb-px z-10'
                  : 'bg-transparent border-transparent text-stone-400 hover:text-stone-600 hover:bg-stone-100/50'
                }
              `}
            >
              <span className="text-sm">{TAB_ICONS[artifact.type] ?? '\u{1F4C3}'}</span>
              {artifact.label}
              {/* Streaming indicator on latest artifact */}
              {isStreaming && i === artifacts.length - 1 && (
                <span className="relative flex h-1.5 w-1.5 ml-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeArtifact && (
          <ArtifactContent
            key={activeArtifact.path}
            artifact={activeArtifact}
            onQuoteSelection={onQuoteSelection}
            quotedSelection={quotedSelection}
            onArtifactUpdate={onArtifactUpdate}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Walk all text nodes inside `root`, find the first occurrence of `searchText`,
 * and wrap the matching range with <mark> elements using CSS Highlight-like styling.
 * Returns a cleanup function that removes the marks.
 */
function highlightTextInDOM(root: HTMLElement, searchText: string): (() => void) | null {
  const MARK_CLASS = 'workspace-quote-highlight'

  // Collect all text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text)
  }

  // Build combined text and find match position
  let combined = ''
  const nodeOffsets: { node: Text; start: number }[] = []
  for (const tn of textNodes) {
    nodeOffsets.push({ node: tn, start: combined.length })
    combined += tn.textContent ?? ''
  }

  // Try exact match first, then fall back to whitespace-normalized matching.
  // window.getSelection().toString() inserts newlines between block elements (li, p, div),
  // but concatenated text node content may have different whitespace.
  let matchStart = combined.indexOf(searchText)
  let matchEnd = matchStart + searchText.length
  if (matchStart === -1) {
    // Build a normalized version: collapse all whitespace to single space
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim()
    const normalizedSearch = normalize(searchText)
    // Build a mapping from normalized index → original index
    const normalizedChars: number[] = [] // normalizedChars[i] = original index of normalized char i
    let ni = 0
    let lastWasSpace = true
    for (let oi = 0; oi < combined.length; oi++) {
      const ch = combined[oi]
      const isWs = /\s/.test(ch)
      if (isWs) {
        if (!lastWasSpace) {
          normalizedChars.push(oi)
          ni++
        }
        lastWasSpace = true
      } else {
        normalizedChars.push(oi)
        ni++
        lastWasSpace = false
      }
    }
    const normalizedCombined = normalize(combined)
    const nStart = normalizedCombined.indexOf(normalizedSearch)
    if (nStart === -1) return null
    const nEnd = nStart + normalizedSearch.length
    // Map back to original indices
    matchStart = normalizedChars[nStart] ?? 0
    matchEnd = (nEnd < normalizedChars.length ? normalizedChars[nEnd] : combined.length)
  }

  // Find which text nodes the match spans
  const marks: HTMLElement[] = []
  for (const { node: tn, start } of nodeOffsets) {
    const len = tn.textContent?.length ?? 0
    const nodeEnd = start + len

    // Skip nodes entirely before or after the match
    if (nodeEnd <= matchStart || start >= matchEnd) continue

    // Calculate overlap within this text node
    const overlapStart = Math.max(0, matchStart - start)
    const overlapEnd = Math.min(len, matchEnd - start)

    if (overlapStart === 0 && overlapEnd === len) {
      // Entire text node is part of the match — wrap it
      const mark = document.createElement('mark')
      mark.className = MARK_CLASS
      tn.parentNode?.replaceChild(mark, tn)
      mark.appendChild(tn)
      marks.push(mark)
    } else {
      // Partial match — split the text node
      const before = tn.textContent!.slice(0, overlapStart)
      const matched = tn.textContent!.slice(overlapStart, overlapEnd)
      const after = tn.textContent!.slice(overlapEnd)

      const frag = document.createDocumentFragment()
      if (before) frag.appendChild(document.createTextNode(before))
      const mark = document.createElement('mark')
      mark.className = MARK_CLASS
      mark.textContent = matched
      frag.appendChild(mark)
      marks.push(mark)
      if (after) frag.appendChild(document.createTextNode(after))

      tn.parentNode?.replaceChild(frag, tn)
    }
  }

  // Scroll the first mark into view
  if (marks.length > 0) {
    marks[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // Return cleanup: unwrap all marks
  return () => {
    for (const mark of marks) {
      const parent = mark.parentNode
      if (!parent) continue
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark)
      }
      parent.removeChild(mark)
      parent.normalize() // merge adjacent text nodes
    }
  }
}

function ArtifactContent({
  artifact,
  onQuoteSelection,
  quotedSelection,
  onArtifactUpdate,
}: {
  artifact: WorkspaceArtifact
  onQuoteSelection?: (selection: QuotedSelection) => void
  quotedSelection?: QuotedSelection | null
  onArtifactUpdate?: (path: string, content: string) => void
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const highlightCleanupRef = useRef<(() => void) | null>(null)

  // Eagerly clean up highlight marks when content changes BEFORE React reconciles.
  // React's DOM diff will crash if it encounters our <mark> wrappers.
  // Running this during render (before commit) restores the DOM React expects.
  const prevContentRef = useRef(artifact.content)
  if (artifact.content !== prevContentRef.current && highlightCleanupRef.current) {
    highlightCleanupRef.current()
    highlightCleanupRef.current = null
  }
  prevContentRef.current = artifact.content

  // Auto-quote on text selection — clear browser selection after capturing
  const handleMouseUp = useCallback(() => {
    if (!onQuoteSelection) return

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return

    const text = sel.toString().trim()
    if (text) {
      onQuoteSelection({ path: artifact.path, content: text })
      // Clear native selection so our custom highlight takes over
      sel.removeAllRanges()
    }
  }, [onQuoteSelection, artifact.path])

  // DOM-based highlight — works on rendered text regardless of source format
  const isQuotedHere = quotedSelection && quotedSelection.path === artifact.path
  useEffect(() => {
    // Clean up previous highlight
    highlightCleanupRef.current?.()
    highlightCleanupRef.current = null

    if (!isQuotedHere || !contentRef.current) return
    highlightCleanupRef.current = highlightTextInDOM(contentRef.current, quotedSelection!.content)
    return () => {
      highlightCleanupRef.current?.()
      highlightCleanupRef.current = null
    }
  }, [isQuotedHere, quotedSelection, artifact.content])

  switch (artifact.type) {
    case 'image':
      return (
        <ImageViewer
          base64={artifact.content}
          mimeType={artifact.mimeType ?? 'image/png'}
        />
      )

    case 'gallery':
      return (
        <ImageGallery images={artifact.images ?? []} />
      )

    case 'drawio':
      return (
        <DrawioEditor
          xmlContent={artifact.content}
          onUpdate={(newContent) => onArtifactUpdate?.(artifact.path, newContent)}
        />
      )

    case 'markdown':
      return (
        <div ref={contentRef} className="h-full overflow-auto p-6" onMouseUp={handleMouseUp}>
          <div className="prose prose-sm prose-stone max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {artifact.content}
            </ReactMarkdown>
          </div>
        </div>
      )

    default:
      return (
        <div ref={contentRef} className="h-full overflow-auto p-6" onMouseUp={handleMouseUp}>
          <pre className="text-xs font-mono text-stone-600 whitespace-pre-wrap break-all">
            {artifact.content}
          </pre>
        </div>
      )
  }
}
