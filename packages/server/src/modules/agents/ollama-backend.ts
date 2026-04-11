import { randomUUID } from 'node:crypto';
import type { AgentBackend, NewBackendType } from './agent-backend.js';
import type {
  ConversationHandle,
  ToolDefinition,
  UserMessage,
  AssistantMessage,
  ToolResult,
} from './new-types.js';
import { BackendError } from './new-types.js';

export interface OllamaBackendConfig {
  baseUrl: string;             // default 'http://localhost:11434'
  model: string;               // e.g. 'qwen3.5:35b'
  disableThinking?: boolean;   // sets think: false in request (default false)
  maxTokens?: number;          // maps to options.num_predict; default 4096
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ConversationState {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Strip <think>...</think> blocks (including multi-line) from content. */
function stripThinkBlocks(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export class OllamaBackend implements AgentBackend {
  readonly backendType: NewBackendType = 'ollama';
  readonly id: string;

  private readonly config: OllamaBackendConfig;
  private readonly conversations = new Map<string, ConversationState>();

  constructor(config: OllamaBackendConfig) {
    this.config = config;
    this.id = `ollama-backend-${randomUUID()}`;
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
      turns: [],
    });
    return { conversationId };
  }

  async sendMessage(
    conversation: ConversationHandle,
    userMessage: UserMessage,
  ): Promise<AssistantMessage> {
    const state = this.getConversationState(conversation);

    state.turns.push({ role: 'user', content: userMessage.content });

    const messages: OllamaMessage[] = [
      { role: 'system', content: state.systemPrompt },
      ...state.turns,
    ];

    const body: Record<string, unknown> = {
      model: state.model,
      messages,
      stream: false,
      options: {
        num_predict: state.maxTokens,
      },
    };

    if (this.config.disableThinking) {
      body['think'] = false;
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      state.turns.pop();
      throw new BackendError(
        `Ollama unreachable at ${this.config.baseUrl}: ${(err as Error).message}`,
        'backend_unavailable',
        undefined,
        { cause: err },
      );
    }

    if (!response.ok) {
      state.turns.pop();
      await this.throwApiError(response);
    }

    const data = await response.json() as {
      message: { content: string };
      done_reason: string;
    };

    const rawContent = data.message.content;
    const cleanContent = stripThinkBlocks(rawContent);

    state.turns.push({ role: 'assistant', content: cleanContent });

    return {
      content: cleanContent,
      toolCalls: [],
      stopReason: data.done_reason,
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
    let errorMessage = `HTTP ${response.status}`;
    try {
      const data = await response.json() as { error?: string };
      if (data.error) errorMessage = data.error;
    } catch {
      // Ignore JSON parse failures
    }
    throw new BackendError(errorMessage, 'backend_error', response.status);
  }
}
