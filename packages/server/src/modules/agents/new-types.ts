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
 * In Phase 1, toolCalls is always an empty array (backends never return
 * tool_use blocks when toolDefinitions is empty).
 */
export interface AssistantMessage {
  content: string;
  toolCalls: ToolCall[];  // Always [] in Phase 1
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string;
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
  toolName: string;
  content: string;          // JSON-serialized result or error
  isError: boolean;
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
  | 'not_implemented';

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
