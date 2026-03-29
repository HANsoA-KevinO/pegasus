'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { ModelProvider } from '@/lib/types'
import { useConversations } from '@/hooks/useConversation'
import { useModels } from '@/hooks/useModels'
import { MemoryPanel } from './MemoryPanel'

interface SidebarProps {
  model: ModelProvider
  onModelChange: (model: ModelProvider) => void
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  onNewChat: () => void
  currentConversationId: string | null
  runningConversationIds: Set<string>
  waitingForUserIds: Set<string>
}

export function Sidebar({
  model,
  onModelChange,
  onSelectConversation,
  onDeleteConversation,
  onNewChat,
  currentConversationId,
  runningConversationIds,
  waitingForUserIds,
}: SidebarProps) {
  const { conversations, deleteConversation, refresh } = useConversations()
  const { models, isLoading: modelsLoading } = useModels()
  const [search, setSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Refresh conversation list when the active conversation changes (e.g., new conversation created)
  const prevConvIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (currentConversationId && currentConversationId !== prevConvIdRef.current) {
      prevConvIdRef.current = currentConversationId
      refresh()
    }
  }, [currentConversationId, refresh])

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models
    const q = search.toLowerCase()
    return models.filter(
      m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    )
  }, [models, search])

  const selectedModelName = models.find(m => m.id === model)?.name ?? model

  return (
    <div className="w-64 bg-gray-900 text-white flex flex-col h-full">
      {/* New chat button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full rounded-lg border border-gray-600 px-3 py-2 text-sm hover:bg-gray-800 transition-colors"
        >
          + 新对话
        </button>
      </div>

      {/* Settings */}
      <div className="px-3 pb-3 space-y-3 border-b border-gray-700">
        {/* Model selector */}
        <div className="relative" ref={dropdownRef}>
          <label className="block text-xs text-gray-400 mb-1">模型</label>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full rounded-md bg-gray-800 border border-gray-600 px-2 py-1.5 text-sm text-left truncate focus:outline-none focus:border-blue-500"
          >
            {modelsLoading ? '加载中...' : selectedModelName}
          </button>

          {dropdownOpen && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-xl max-h-72 flex flex-col">
              <div className="p-1.5 border-b border-gray-700">
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜索模型..."
                  className="w-full rounded bg-gray-900 border border-gray-600 px-2 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="overflow-y-auto flex-1">
                {filteredModels.map(m => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onModelChange(m.id)
                      setDropdownOpen(false)
                      setSearch('')
                    }}
                    className={`w-full text-left px-2 py-1.5 text-xs hover:bg-gray-700 transition-colors truncate ${
                      m.id === model ? 'bg-gray-700 text-white' : 'text-gray-300'
                    }`}
                    title={m.id}
                  >
                    {m.name}
                  </button>
                ))}
                {filteredModels.length === 0 && (
                  <div className="px-2 py-3 text-xs text-gray-500 text-center">
                    无匹配模型
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 text-xs text-gray-400 mb-2">历史对话</div>
        {conversations.map(conv => (
          <div
            key={conv.conversation_id}
            className={`group flex items-center px-3 py-2 hover:bg-gray-800 transition-colors ${
              currentConversationId === conv.conversation_id
                ? 'bg-gray-800 text-white'
                : 'text-gray-300'
            }`}
          >
            {waitingForUserIds.has(conv.conversation_id) ? (
              <span className="flex-shrink-0 mr-2 relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
            ) : runningConversationIds.has(conv.conversation_id) ? (
              <span className="flex-shrink-0 mr-2 relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            ) : null}
            <button
              onClick={() => onSelectConversation(conv.conversation_id)}
              className="flex-1 min-w-0 text-left text-sm truncate"
            >
              {conv.title}
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation()
                const ok = await deleteConversation(conv.conversation_id)
                if (ok) onDeleteConversation(conv.conversation_id)
              }}
              className="flex-shrink-0 ml-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-600 transition-all text-gray-400 hover:text-red-400"
              title="删除对话"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="px-3 text-xs text-gray-500">暂无历史对话</div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="p-3 border-t border-gray-700">
        <button
          onClick={() => setMemoryOpen(true)}
          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          记忆管理
        </button>
      </div>

      {/* Memory panel overlay */}
      {memoryOpen && <MemoryPanel onClose={() => setMemoryOpen(false)} />}
    </div>
  )
}
