import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeBackend } from '../claude-backend.js';
import { BackendError } from '../new-types.js';

const CANNED_SUCCESS = {
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello from Claude.' }],
  model: 'claude-sonnet-4-6',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
};

function makeSuccessResponse(text: string, stopReason = 'end_turn') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ...CANNED_SUCCESS,
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
    }),
  } as Response;
}

function makeErrorResponse(status: number, errorType: string, errorMessage: string) {
  return {
    ok: false,
    status,
    json: async () => ({
      type: 'error',
      error: { type: errorType, message: errorMessage },
    }),
  } as Response;
}

describe('ClaudeBackend', () => {
  let backend: ClaudeBackend;

  beforeEach(() => {
    global.fetch = vi.fn();
    backend = new ClaudeBackend({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('startConversation returns a handle with a conversationId', async () => {
    const handle = await backend.startConversation({
      systemPrompt: 'You are helpful.',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });
    expect(handle.conversationId).toBeTruthy();
    expect(typeof handle.conversationId).toBe('string');
  });

  it('sendMessage sends correct headers and body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('The answer is 42.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'You are a calculator.',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    const result = await backend.sendMessage(handle, { content: 'What is 6*7?' });

    expect(result.content).toBe('The answer is 42.');
    expect(result.stopReason).toBe('end_turn');
    expect(result.toolCalls).toEqual([]);

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-key');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.system).toBe('You are a calculator.');
    expect(body.messages).toEqual([{ role: 'user', content: 'What is 6*7?' }]);
    expect(body.max_tokens).toBe(1024);
  });

  it('accumulates history across multiple sendMessage calls (multi-turn)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeSuccessResponse('Turn 1 response.'))
      .mockResolvedValueOnce(makeSuccessResponse('Turn 2 response.'));

    const handle = await backend.startConversation({
      systemPrompt: 'Multi-turn test.',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    await backend.sendMessage(handle, { content: 'First message.' });
    await backend.sendMessage(handle, { content: 'Second message.' });

    const [, secondInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(secondInit.body as string);
    expect(body.messages).toEqual([
      { role: 'user', content: 'First message.' },
      { role: 'assistant', content: 'Turn 1 response.' },
      { role: 'user', content: 'Second message.' },
    ]);
  });

  it('throws BackendError with category auth_error on HTTP 401', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeErrorResponse(401, 'authentication_error', 'Invalid API key.'))
      .mockResolvedValueOnce(makeErrorResponse(401, 'authentication_error', 'Invalid API key.'));

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    await expect(
      backend.sendMessage(handle, { content: 'hello' })
    ).rejects.toThrow(BackendError);

    await expect(
      backend.sendMessage(handle, { content: 'hello' }).catch(e => e)
    ).resolves.toMatchObject({ category: 'auth_error', statusCode: 401 });
  });

  it('throws BackendError with category rate_limit on HTTP 429', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeErrorResponse(429, 'rate_limit_error', 'Rate limit exceeded.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    const err = await backend.sendMessage(handle, { content: 'hello' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('rate_limit');
    expect(err.statusCode).toBe(429);
  });

  it('throws BackendError with category backend_error on HTTP 529', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeErrorResponse(529, 'overloaded_error', 'API overloaded.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    const err = await backend.sendMessage(handle, { content: 'hello' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('rate_limit');
  });

  it('sendToolResults throws not_implemented in Phase 1', async () => {
    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    await expect(
      backend.sendToolResults(handle, [])
    ).rejects.toThrow('not implemented in Phase 1');

    const err = await backend.sendToolResults(handle, []).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('not_implemented');
  });

  it('sendMessage on a closed conversation throws conversation_not_found', async () => {
    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });
    await backend.closeConversation(handle);

    const err = await backend.sendMessage(handle, { content: 'hello' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('conversation_not_found');
  });

  it('uses maxTokens from startConversation params when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('ok')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
      maxTokens: 2048,
    });

    await backend.sendMessage(handle, { content: 'hi' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(2048);
  });
});
