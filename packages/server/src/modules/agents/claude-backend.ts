import { randomUUID } from 'node:crypto';
import type {
  AgentBackend,
  NewBackendType,
} from './agent-backend.js';
import type {
  ConversationHandle,
  ToolDefinition,
  UserMessage,
  AssistantMessage,
  ToolResult,
} from './new-types.js';
import { BackendError } from './new-types.js';

export interface ClaudeBackendConfig {
  baseUrl: string;        // 'https://api.anthropic.com' or 'http://localhost:3456'
  apiKey: string;         // Bearer token
  model: string;          // default model for conversations that don't specify one
  maxTokens?: number;     // default 4096
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationState {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  messages: AnthropicMessage[];
}

export class ClaudeBackend implements AgentBackend {
  readonly backendType: NewBackendType = 'claude';
  readonly id: string;

  private readonly config: ClaudeBackendConfig;
  private readonly conversations = new Map<string, ConversationState>();

  constructor(config: ClaudeBackendConfig) {
    this.config = config;
    this.id = `claude-backend-${randomUUID()}`;
  }

  async startConversation(params: {
    systemPrompt: string;
    toolDefinitions: ToolDefinition[];
    model: string;
    maxTokens?: number;
  }): Promise<ConversationHandle> {
    const conversationId = randomUUID();
    const state: ConversationState = {
      systemPrompt: params.systemPrompt,
      model: params.model,
      maxTokens: params.maxTokens ?? this.config.maxTokens ?? 4096,
      messages: [],
    };
    this.conversations.set(conversationId, state);
    return { conversationId };
  }

  async sendMessage(
    conversation: ConversationHandle,
    userMessage: UserMessage,
  ): Promise<AssistantMessage> {
    const state = this.getConversationState(conversation);

    state.messages.push({ role: 'user', content: userMessage.content });

    const body = {
      model: state.model,
      max_tokens: state.maxTokens,
      system: state.systemPrompt,
      messages: state.messages,
    };

    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.config.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Remove the user message we just appended (undo optimistic append)
      state.messages.pop();
      await this.throwApiError(response);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
      stop_reason: string;
    };

    const textContent = data.content.find(c => c.type === 'text');
    const assistantText = textContent?.text ?? '';

    state.messages.push({ role: 'assistant', content: assistantText });

    return {
      content: assistantText,
      text: assistantText,
      toolCalls: [],
      stopReason: data.stop_reason,
    };
  }

  async sendToolResults(
    _conversation: ConversationHandle,
    _toolResults: ToolResult[],
  ): Promise<AssistantMessage> {
    throw new BackendError(
      'sendToolResults: not implemented in Phase 1 — tool-calling loop requires NR Phase 3',
      'not_implemented',
    );
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
    let errorData: { error?: { type?: string; message?: string } } = {};
    try {
      errorData = await response.json() as typeof errorData;
    } catch {
      // Ignore JSON parse failures — use status code alone
    }

    const message = errorData.error?.message ?? `HTTP ${response.status}`;

    if (response.status === 401) {
      throw new BackendError(message, 'auth_error', response.status);
    }
    if (response.status === 429 || response.status === 529) {
      throw new BackendError(message, 'rate_limit', response.status);
    }
    throw new BackendError(message, 'backend_error', response.status);
  }
}
