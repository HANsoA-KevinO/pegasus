'use client'

import { useState, useEffect, useCallback } from 'react'

interface Memory {
  memory_id: string
  name: string
  description: string
  type: 'user' | 'project' | 'feedback' | 'reference'
  content: string
  tags: string[]
  access_count: number
  last_accessed_at: string
  created_at: string
  updated_at: string
}

const TYPE_LABELS: Record<Memory['type'], string> = {
  user: '用户',
  project: '项目',
  feedback: '反馈',
  reference: '引用',
}

const TYPE_COLORS: Record<Memory['type'], string> = {
  user: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  project: 'bg-green-500/20 text-green-300 border-green-500/30',
  feedback: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  reference: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
}

interface MemoryPanelProps {
  onClose: () => void
}

export function MemoryPanel({ onClose }: MemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<Memory['type'] | 'all'>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Memory>>({})

  const fetchMemories = useCallback(async () => {
    setLoading(true)
    try {
      const url = filterType === 'all' ? '/api/memories' : `/api/memories?type=${filterType}`
      const res = await fetch(url)
      if (res.ok) {
        setMemories(await res.json())
      }
    } catch {
      /* ignore */
    }
    setLoading(false)
  }, [filterType])

  useEffect(() => {
    fetchMemories()
  }, [fetchMemories])

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这条记忆？')) return
    const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setMemories(prev => prev.filter(m => m.memory_id !== id))
    }
  }

  const startEdit = (memory: Memory) => {
    setEditingId(memory.memory_id)
    setEditForm({
      name: memory.name,
      description: memory.description,
      type: memory.type,
      content: memory.content,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({})
  }

  const saveEdit = async () => {
    if (!editingId) return
    const res = await fetch(`/api/memories/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      const updated = await res.json()
      setMemories(prev => prev.map(m => m.memory_id === editingId ? { ...m, ...updated } : m))
      cancelEdit()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-gray-900 text-white shadow-2xl flex flex-col h-full ml-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-lg font-semibold">记忆管理</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-gray-700/50">
          {(['all', 'user', 'project', 'feedback', 'reference'] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                filterType === t
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {t === 'all' ? '全部' : TYPE_LABELS[t]}
              {t === 'all' && ` (${memories.length})`}
            </button>
          ))}
        </div>

        {/* Memory list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
              加载中...
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-sm">
              <svg className="w-10 h-10 mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              暂无记忆
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {memories.map(memory => (
                <div key={memory.memory_id} className="px-4 py-3 hover:bg-gray-800/50 transition-colors">
                  {editingId === memory.memory_id ? (
                    /* Edit mode */
                    <div className="space-y-2">
                      <input
                        value={editForm.name ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                        placeholder="名称"
                      />
                      <input
                        value={editForm.description ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="描述"
                      />
                      <select
                        value={editForm.type ?? 'user'}
                        onChange={e => setEditForm(f => ({ ...f, type: e.target.value as Memory['type'] }))}
                        className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                      >
                        {Object.entries(TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                      <textarea
                        value={editForm.content ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))}
                        rows={5}
                        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 resize-y"
                        placeholder="内容"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={saveEdit}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs transition-colors"
                        >
                          保存
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <>
                      <div className="flex items-start gap-2 mb-1">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${TYPE_COLORS[memory.type]}`}>
                          {TYPE_LABELS[memory.type]}
                        </span>
                        <h3 className="text-sm font-medium flex-1 min-w-0">{memory.name}</h3>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => startEdit(memory)}
                            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
                            title="编辑"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(memory.memory_id)}
                            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-colors"
                            title="删除"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {memory.description && (
                        <p className="text-xs text-gray-400 mb-1">{memory.description}</p>
                      )}
                      <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words bg-gray-800/50 rounded px-2 py-1.5 max-h-32 overflow-y-auto">
                        {memory.content}
                      </pre>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                        <span>访问 {memory.access_count} 次</span>
                        <span>更新于 {new Date(memory.updated_at).toLocaleDateString('zh-CN')}</span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
