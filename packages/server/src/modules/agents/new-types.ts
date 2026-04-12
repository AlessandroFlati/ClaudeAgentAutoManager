/**
 * New conversation-oriented types for the Plurics AgentBackend interface.
 * These are the types used by the three new HTTP fetch backends (claude,
 * openai-compat, ollama). They replace nothing yet — agent-backend.ts
 * still exports the legacy interface. The merge happens in Task 3.
 *
 * Deferred (NR Phase 3): sendToolResults implementation, tool-calling loop,
 * toolDefinitions population from toolset field.
 */

/**
 * A handle to an active LLM conversation. Opaque to callers; backends use it
 * to track conversation state (message history, model name, etc.).
 */
export interface ConversationHandle {
  readonly conversationId: string;
}

/**
 * A tool definition in the backend-neutral format. Backends translate this
 * into their API-specific format (Anthropic tool use, OpenAI function calling,
 * Ollama tool objects).
 *
 * In Phase 1, toolDefinitions arrays are always empty.
 */
export interface ToolDefinition {
  name: string;           // registry tool name with dots replaced by underscores
  description: string;
  inputSchema: JsonSchema;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
}

/** A user turn in a conversation. */
export interface UserMessage {
  content: string;
}

/**
 * The assistant's response from a sendMessage or sendToolResults call.
 * Phase 3: `text` is the primary text field; `toolCalls` is populated when
 * the backend returns tool_use blocks. `content` is kept for backward compat.
 */
export interface AssistantMessage {
  /** @deprecated Use `text` instead. Kept for backward compatibility. */
  content: string;
  text: string;
  toolCalls?: ToolCall[];  // populated when backend returns tool_use blocks
  stopReason?: string;
}

/** A tool call from the LLM — used in Phase 3. */
export interface ToolCall {
  toolCallId: string;
  toolName: string;         // dotted registry name (underscores reversed)
  inputs: Record<string, unknown>;
}

/** A tool result to send back to the LLM — used in Phase 3. */
export interface ToolResult {
  toolCallId: string;
  content: string;        // JSON-encoded result or error message
  isError?: boolean;
}

/**
 * Structured error thrown by all three new backends.
 * The `cause` field holds the original Error for network failures.
 */
export type BackendErrorCategory =
  | 'auth_error'
  | 'rate_limit'
  | 'backend_error'
  | 'backend_unavailable'
  | 'conversation_not_found'
  | 'not_implemented'
  // Phase 3 additions:
  | 'tool_not_allowed'        // LLM called tool not in toolset
  | 'tool_budget_exhausted'   // same tool failed N consecutive times
  | 'max_turns_exceeded'      // loop hit maxTurns and LLM still emitted tool calls
  | 'signal_parse_error'      // no valid signal block after corrective re-prompt
  | 'wall_clock_timeout'      // node ran longer than wallClockTimeoutMs
  | 'context_exceeded'        // LLM context window full
  | 'toolset_empty_glob'      // glob in toolset matched zero tools
  | 'handle_not_found';       // LLM referenced value handle not in scope

export class BackendError extends Error {
  readonly category: BackendErrorCategory;
  readonly statusCode: number | undefined;

  constructor(message: string, category: BackendErrorCategory, statusCode?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BackendError';
    this.category = category;
    this.statusCode = statusCode;
  }
}
