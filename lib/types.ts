// ============================================================
// Global Types for Pegasus
// ============================================================

// --- LLM / Model Types ---

export type ModelProvider = string // OpenRouter model ID, e.g. 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash'

// --- Anthropic Content Block Types (Claude API native format) ---

export type TextBlock = {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export type ImageBlock = {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/** tool_result content: string for text-only, or array for mixed content (text + images) */
export type ToolResultContent = string | (TextBlock | ImageBlock)[]

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: ToolResultContent
  is_error?: boolean
  cache_control?: { type: 'ephemeral' }
}

export type ThinkingBlock = {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type RedactedThinkingBlock = {
  type: 'redacted_thinking'
  data: string
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | RedactedThinkingBlock

// --- Message Types ---

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
  timestamp?: Date
}

// --- Tool Types ---

export interface ToolSchema {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** Image attachment for tool results or user uploads */
export interface ImageAttachment {
  base64: string
  mimeType: string
}

export interface ToolResult {
  content: string
  is_error?: boolean
  /** Full file content after edit — used by Edit tool for workspace sync */
  updatedContent?: string
  /** Images produced by this tool — sent as image content blocks (pixel-based token counting) */
  images?: ImageAttachment[]
}

// --- Agent Types ---

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export interface ToolCallRecord {
  tool: string
  input: Record<string, unknown>
  result: ToolResult
}

export interface AgentLoopResult {
  messages: ConversationMessage[]
  text: string
  toolCalls: ToolCallRecord[]
  usage: TokenUsage
  truncated?: boolean
  waitingForUser?: boolean
  /** True if compaction occurred during this agent loop run */
  compacted?: boolean
  /** The compaction summary text (if compacted) */
  compactionSummary?: string
}

// --- LLM Response (agent loop internal) ---

export interface LLMResponse {
  content: ContentBlock[]
  stop_reason: string
  usage: TokenUsage
}

// --- Display Types (frontend rendering) ---

export type DisplayPart =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; file_path?: string; action?: string; is_error?: boolean; pending?: boolean; content?: string }
  | { type: 'thinking'; text: string; pending?: boolean }
  | { type: 'redacted_thinking'; pending?: boolean }
  | { type: 'ask_user'; question: string; options?: string[]; answered?: boolean }
  | { type: 'image'; base64: string; mimeType: string }

export interface DisplayMessage {
  id: string
  type: 'user' | 'assistant'
  parts: DisplayPart[]
  content: string
  timestamp: Date
}

// --- Tool Call Summary (SSE done event) ---

export interface ToolCallSummary {
  tool: string
  file_path?: string
  action: string
  is_error: boolean
}

// --- Workspace Types ---

export type ResolverType = 'field' | 'static' | 'generated'

export interface FileDeclaration {
  path: string
  description: string
  resolver: ResolverRef
  readOnly?: boolean
}

export interface ResolverRef {
  type: ResolverType
  /** For field resolver: dot-notation path in the conversation document */
  field?: string
  /** For static resolver: the fixed content */
  content?: string
}

export interface WorkspaceDefinition {
  name: string
  description: string
  files: FileDeclaration[]
}

// --- Conversation / DB Types ---

export interface ConversationDoc {
  conversation_id: string
  title: string
  settings: ConversationSettings
  user_input: string
  analysis: {
    domain_classification: string
    logic_structure: string
    style_guide: string
    visual_spec: string
  }
  output: {
    draw_prompt: string
    image_base64: string
    diagram_xml: string
    // Icon extraction pipeline
    image_icons_only_base64: string
    icons_transparent_base64: string
    icons_manifest: string
    // Individual icon slots (1-20)
    [key: `icon_${number}_base64`]: string
  }
  messages: ConversationMessage[]
  /** Compacted messages — when non-empty, used instead of messages for LLM calls */
  compacted_messages?: ConversationMessage[]
  /** Number of times compaction has been performed */
  compaction_count?: number
  created_at: Date
  updated_at: Date
}

export interface ConversationSettings {
  orchestrator_model: ModelProvider
  target_conference?: string
  image_size?: string
}

// --- Skill Types ---

export interface SkillMetadata {
  name: string
  description: string
}

export interface SkillDefinition extends SkillMetadata {
  /** Full body content of SKILL.md (without frontmatter) */
  body: string
  /** Absolute path to the skill directory */
  dirPath: string
}
