'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

export interface DrawioEditorProps {
  xmlContent: string
  onUpdate: (newXmlContent: string) => void
}

/**
 * Embeds draw.io editor via iframe (embed.diagrams.net).
 * Communicates via postMessage API for loading/saving XML.
 *
 * Protocol: https://www.drawio.com/doc/faq/embed-mode
 */
export function DrawioEditor({ xmlContent, onUpdate }: DrawioEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const xmlRef = useRef(xmlContent)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  // Track the latest XML to avoid re-loading on our own saves
  const lastSavedRef = useRef(xmlContent)

  // Load XML into the editor
  const loadXml = useCallback((xml: string) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    iframe.contentWindow.postMessage(
      JSON.stringify({ action: 'load', xml, autosave: 1 }),
      '*'
    )
  }, [])

  // Listen for messages from draw.io iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!iframeRef.current) return
      // Only accept messages from the iframe
      try {
        const iframe = iframeRef.current
        if (e.source !== iframe.contentWindow) return
      } catch {
        return
      }

      let msg: { event?: string; xml?: string }
      try {
        msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }

      switch (msg.event) {
        case 'init':
          // Editor is ready — load our XML
          setReady(true)
          loadXml(xmlRef.current)
          break

        case 'autosave':
          // User made changes — save back
          if (msg.xml) {
            lastSavedRef.current = msg.xml
            onUpdateRef.current(msg.xml)
          }
          break

        case 'save':
          // Explicit save (Ctrl+S)
          if (msg.xml) {
            lastSavedRef.current = msg.xml
            onUpdateRef.current(msg.xml)
          }
          // Send export acknowledgment to dismiss save dialog
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ action: 'status', modified: false }),
            '*'
          )
          break

        case 'exit':
          // User clicked close — we don't actually close, just ignore
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [loadXml])

  // When external XML content changes (e.g., agent edits), reload
  useEffect(() => {
    xmlRef.current = xmlContent
    if (ready && xmlContent !== lastSavedRef.current) {
      loadXml(xmlContent)
      lastSavedRef.current = xmlContent
    }
  }, [xmlContent, ready, loadXml])

  // draw.io embed URL params:
  // - embed=1: enable embed mode
  // - proto=json: use JSON protocol
  // - spin=1: show spinner while loading
  // - modified=0: start as unmodified
  // - libraries=0: hide shape libraries panel (cleaner)
  // - noSaveBtn=1: hide save button (we autosave)
  // - noExitBtn=1: hide exit button
  const embedUrl = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&modified=0&libraries=0&noSaveBtn=0&noExitBtn=1'

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
        <span className="font-medium text-stone-700">Draw.io 编辑器</span>
        <span className="ml-auto">
          {ready ? '已就绪' : '加载中...'}
        </span>
        <button
          className="px-2 py-0.5 rounded bg-stone-200 hover:bg-stone-300 text-stone-600"
          onClick={() => {
            const blob = new Blob([xmlContent], { type: 'application/xml' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'diagram.drawio'
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          下载 XML
        </button>
      </div>

      {/* draw.io iframe */}
      <div className="flex-1 min-h-0 relative">
        <iframe
          ref={iframeRef}
          src={embedUrl}
          className="absolute inset-0 w-full h-full border-0"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  )
}
