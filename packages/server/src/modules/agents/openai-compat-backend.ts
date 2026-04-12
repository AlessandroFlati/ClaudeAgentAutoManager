import { randomUUID } from 'node:crypto';
import type { AgentBackend, NewBackendType } from './agent-backend.js';
import type {
  ConversationHandle,
  ToolDefinition,
  UserMessage,
  AssistantMessage,
  ToolCall,
  ToolResult,
} from './new-types.js';
import { BackendError } from './new-types.js';

export interface OpenAICompatBackendConfig {
  baseUrl: string;        // e.g. 'http://localhost:8000', 'https://api.openai.com'
  apiKey?: string;        // required for OpenAI direct; optional for local servers
  model: string;          // default model
  maxTokens?: number;     // default 4096
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface ConversationState {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  tools: OpenAITool[];
  // Does not include the system message — it is injected at request time
  messages: OpenAIMessage[];
}

export class OpenAICompatBackend implements AgentBackend {
  readonly backendType: NewBackendType = 'openai-compat';
  readonly id: string;

  private readonly config: OpenAICompatBackendConfig;
  private readonly conversations = new Map<string, ConversationState>();

  constructor(config: OpenAICompatBackendConfig) {
    this.config = config;
    this.id = `openai-compat-backend-${randomUUID()}`;
  }

  async startConversation(params: {
    systemPrompt: string;
    toolDefinitions: ToolDefinition[];
    model: string;
    maxTokens?: number;
  }): Promise<ConversationHandle> {
    const conversationId = randomUUID();
    this.conversations.set(conversationId, {
      systemPrompt: params.systemPrompt,
      model: params.model,
      maxTokens: params.maxTokens ?? this.config.maxTokens ?? 4096,
      tools: params.toolDefinitions.map(def => ({
        type: 'function' as const,
        function: {
          name: def.name,
          description: def.description,
          parameters: def.inputSchema,
        },
      })),
      messages: [],
    });
    return { conversationId };
  }

  async sendMessage(
    conversation: ConversationHandle,
    userMessage: UserMessage,
  ): Promise<AssistantMessage> {
    const state = this.getConversationState(conversation);

    state.messages.push({ role: 'user', content: userMessage.content });

    const messages: OpenAIMessage[] = [
      { role: 'system', content: state.systemPrompt },
      ...state.messages,
    ];

    const body: Record<string, unknown> = {
      model: state.model,
      max_tokens: state.maxTokens,
      messages,
      ...(state.tools.length > 0 && { tools: state.tools }),
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      state.messages.pop();
      await this.throwApiError(response);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { role: string; content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> };
        finish_reason: string;
      }>;
    };

    const rawMsg = data.choices[0].message;
    const toolCalls: ToolCall[] = (rawMsg.tool_calls ?? []).map((tc) => ({
      toolCallId: tc.id,
      toolName: tc.function.name,
      inputs: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    state.messages.push({
      role: 'assistant',
      content: rawMsg.content ?? null,
      ...(rawMsg.tool_calls && { tool_calls: rawMsg.tool_calls }),
    });

    const assistantText = rawMsg.content ?? '';

    return {
      content: assistantText,
      text: assistantText,
      toolCalls,
      stopReason: data.choices[0].finish_reason,
    };
  }

  async sendToolResults(
    conversation: ConversationHandle,
    toolResults: ToolResult[],
  ): Promise<AssistantMessage> {
    const state = this.getConversationState(conversation);

    for (const r of toolResults) {
      state.messages.push({
        role: 'tool',
        tool_call_id: r.toolCallId,
        content: r.content,
      });
    }

    const messages: OpenAIMessage[] = [
      { role: 'system', content: state.systemPrompt },
      ...state.messages,
    ];

    const body: Record<string, unknown> = {
      model: state.model,
      max_tokens: state.maxTokens,
      messages,
      ...(state.tools.length > 0 && { tools: state.tools }),
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      state.messages.splice(state.messages.length - toolResults.length, toolResults.length);
      await this.throwApiError(response);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { role: string; content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> };
        finish_reason: string;
      }>;
    };

    const rawMsg = data.choices[0].message;
    const toolCalls: ToolCall[] = (rawMsg.tool_calls ?? []).map((tc) => ({
      toolCallId: tc.id,
      toolName: tc.function.name,
      inputs: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    state.messages.push({
      role: 'assistant',
      content: rawMsg.content ?? null,
      ...(rawMsg.tool_calls && { tool_calls: rawMsg.tool_calls }),
    });

    const assistantText = rawMsg.content ?? '';

    return {
      content: assistantText,
      text: assistantText,
      toolCalls,
      stopReason: data.choices[0].finish_reason,
    };
  }

  async closeConversation(conversation: ConversationHandle): Promise<void> {
    this.conversations.delete(conversation.conversationId);
  }

  private getConversationState(conversation: ConversationHandle): ConversationState {
    const state = this.conversations.get(conversation.conversationId);
    if (!state) {
      throw new BackendError(
        `Conversation not found: ${conversation.conversationId}`,
        'conversation_not_found',
      );
    }
    return state;
  }

  private async throwApiError(response: Response): Promise<never> {
    let errorData: { error?: { message?: string; type?: string } } = {};
    try {
      errorData = await response.json() as typeof errorData;
    } catch {
      // Ignore JSON parse failures
    }

    const message = errorData.error?.message ?? `HTTP ${response.status}`;

    if (response.status === 401) {
      throw new BackendError(message, 'auth_error', response.status);
    }
    if (response.status === 429) {
      throw new BackendError(message, 'rate_limit', response.status);
    }
    throw new BackendError(message, 'backend_error', response.status);
  }
}
