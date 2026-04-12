# Node Runtimes Phase 3 — Full Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final gap in the Plurics reasoning node runtime: wire all three backends into a real multi-turn tool-calling loop, resolve `toolset` declarations from the registry, implement `sendToolResults` in all backends, introduce scope-local `ValueStore` per reasoning node, migrate all five workflows off legacy backends, and delete the legacy PTY/process session code plus `node-pty`.

**Architecture:** Two new modules — `toolset-resolver.ts` (registry query → `ToolDefinition[]` + `toolNameMap`) and `reasoning-runtime.ts` (tool-calling loop, retry budget, max-turns, signal parsing). Each backend gets `sendToolResults` + tool wire-format translation in `startConversation`. `dag-executor.ts` replaces `dispatchNewReasoningNode` with a single `runReasoningNode(...)` call.

**Tech Stack:** TypeScript ESM (NodeNext), vitest, existing `RegistryClient`, `ValueStore`, `AgentBackend`. No new npm dependencies except possible `micromatch` for glob resolution (check if already transitive before adding).

**Source of truth:** `docs/superpowers/specs/2026-04-12-node-runtimes-phase-3-design.md`. When this plan and the spec disagree, the spec wins.

**Test discipline:** Every code task follows red-green-commit. Use `__dirname` (not `import.meta.url`) in all test files. Run `(cd packages/server && npx vitest run <path>)` to execute tests.

**Working directory for all commands:** `C:/Users/aless/PycharmProjects/ClaudeAgentAutoManager`. Server package at `packages/server`.

**Baseline:** 264 passing / 0 failing / 6 skipped on `main` after NR Phase 1+2 merge.

---

## Task 1: Toolset Resolver

**Files:**
- Create: `packages/server/src/modules/agents/toolset-resolver.ts`
- Create: `packages/server/src/modules/agents/__tests__/toolset-resolver.test.ts`

### 1.1 Write the failing test first

`packages/server/src/modules/agents/__tests__/toolset-resolver.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveToolset, ResolverError } from '../toolset-resolver.js';
import type { ToolRecord } from '../../registry/types.js';

// Minimal mock ToolRecord factory
function makeTool(name: string, category: string): ToolRecord {
  return {
    name,
    version: 1,
    description: `Tool ${name}`,
    category,
    tags: [],
    inputs: [
      { name: 'x', direction: 'input', schemaName: 'Float', required: true,
        default: undefined, description: null, position: 0 },
    ],
    outputs: [
      { name: 'result', direction: 'output', schemaName: 'Float', required: true,
        default: undefined, description: null, position: 0 },
    ],
    entryPoint: 'tool.py:run',
    language: 'python',
    requires: [],
    stability: 'stable',
    costClass: 'fast',
    author: null,
    createdAt: '2026-01-01T00:00:00Z',
    toolHash: 'abc123',
    status: 'active',
    directory: '/tmp/tools/' + name,
  };
}

const mockRegistry = {
  listToolsByCategory: vi.fn(),
  getTool: vi.fn(),
  listTools: vi.fn(),
};

describe('resolveToolset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a category entry to ToolDefinition[]', async () => {
    mockRegistry.listToolsByCategory.mockResolvedValue([
      makeTool('statistics.mean', 'descriptive_statistics'),
      makeTool('statistics.std', 'descriptive_statistics'),
      makeTool('statistics.median', 'descriptive_statistics'),
    ]);

    const { definitions, toolNameMap } = await resolveToolset(
      [{ category: 'descriptive_statistics' }],
      mockRegistry as any,
    );

    expect(definitions).toHaveLength(3);
    expect(definitions[0].name).toBe('statistics_mean');
    expect(toolNameMap.get('statistics_mean')).toBe('statistics.mean');
    expect(mockRegistry.listToolsByCategory).toHaveBeenCalledWith('descriptive_statistics');
  });

  it('resolves exact name entry', async () => {
    mockRegistry.getTool.mockResolvedValue(makeTool('sklearn.pca', 'sklearn'));

    const { definitions, toolNameMap } = await resolveToolset(
      [{ name: 'sklearn.pca' }],
      mockRegistry as any,
    );

    expect(definitions).toHaveLength(1);
    expect(definitions[0].name).toBe('sklearn_pca');
    expect(toolNameMap.get('sklearn_pca')).toBe('sklearn.pca');
  });

  it('resolves glob pattern', async () => {
    mockRegistry.listTools.mockResolvedValue([
      makeTool('statistics.mean', 'descriptive_statistics'),
      makeTool('statistics.std', 'descriptive_statistics'),
      makeTool('sklearn.pca', 'sklearn'),
    ]);

    const { definitions } = await resolveToolset(
      [{ name: 'statistics.*' }],
      mockRegistry as any,
    );

    expect(definitions).toHaveLength(2);
    expect(definitions.map(d => d.name)).toEqual(
      expect.arrayContaining(['statistics_mean', 'statistics_std']),
    );
  });

  it('deduplicates when same tool appears in multiple entries', async () => {
    mockRegistry.listToolsByCategory.mockResolvedValue([
      makeTool('statistics.mean', 'descriptive_statistics'),
    ]);
    mockRegistry.getTool.mockResolvedValue(
      makeTool('statistics.mean', 'descriptive_statistics'),
    );

    const { definitions } = await resolveToolset(
      [{ category: 'descriptive_statistics' }, { name: 'statistics.mean' }],
      mockRegistry as any,
    );

    expect(definitions).toHaveLength(1);
  });

  it('throws ResolverError(tool_not_found) for unknown exact name', async () => {
    mockRegistry.getTool.mockResolvedValue(null);

    await expect(
      resolveToolset([{ name: 'noexist.tool' }], mockRegistry as any),
    ).rejects.toThrow(ResolverError);

    await expect(
      resolveToolset([{ name: 'noexist.tool' }], mockRegistry as any),
    ).rejects.toMatchObject({ category: 'tool_not_found' });
  });

  it('throws ResolverError(toolset_empty_glob) when glob matches nothing', async () => {
    mockRegistry.listTools.mockResolvedValue([
      makeTool('statistics.mean', 'descriptive_statistics'),
    ]);

    await expect(
      resolveToolset([{ name: 'zzz.*' }], mockRegistry as any),
    ).rejects.toMatchObject({ category: 'toolset_empty_glob' });
  });

  it('maps structured schema ports to object type with description hint', async () => {
    const tool = makeTool('sklearn.pca', 'sklearn');
    tool.inputs = [
      { name: 'matrix', direction: 'input', schemaName: 'NumpyArray',
        required: true, default: undefined, description: null, position: 0 },
    ];
    mockRegistry.getTool.mockResolvedValue(tool);

    const { definitions } = await resolveToolset([{ name: 'sklearn.pca' }], mockRegistry as any);

    const prop = definitions[0].inputSchema.properties['matrix'];
    expect(prop.type).toBe('object');
    expect(prop.description).toContain('NumpyArray');
    expect(prop.description).toContain('value_ref');
  });

  it('returns empty arrays for empty toolset', async () => {
    const { definitions, toolNameMap } = await resolveToolset([], mockRegistry as any);
    expect(definitions).toHaveLength(0);
    expect(toolNameMap.size).toBe(0);
  });
});
```

- [ ] **Step 1: Run test to confirm failure**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/toolset-resolver.test.ts
```

Expected: `Cannot find module '../toolset-resolver.js'`

- [ ] **Step 2: Implement `toolset-resolver.ts`**

`packages/server/src/modules/agents/toolset-resolver.ts`:

```typescript
/**
 * Toolset Resolver — Node Runtimes Phase 3
 *
 * Translates a workflow YAML `toolset` array into:
 *   - `ToolDefinition[]` (backend-neutral tool descriptions)
 *   - `toolNameMap` Map<underscore_name, dotted.name> for dispatch reverse lookup
 *
 * Resolution strategies:
 *   - `{ category: "name" }` → registryClient.listToolsByCategory(name)
 *   - `{ name: "exact.name" }` → registryClient.getTool(name)
 *   - `{ name: "glob.*" }` → registryClient.listTools() filtered by micromatch
 */

import micromatch from 'micromatch';
import type { ToolRecord } from '../registry/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ToolsetEntry =
  | { category: string }
  | { name: string };

export interface JsonSchemaProperty {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

export interface ToolDefinition {
  name: string;               // underscore form: "sklearn_pca"
  description: string;
  inputSchema: ToolInputSchema;
}

export interface ResolvedToolset {
  definitions: ToolDefinition[];
  toolNameMap: Map<string, string>;  // underscore_name → dotted.name
}

export type ResolverErrorCategory = 'tool_not_found' | 'toolset_empty_glob';

export class ResolverError extends Error {
  readonly category: ResolverErrorCategory;
  constructor(category: ResolverErrorCategory, message: string) {
    super(message);
    this.name = 'ResolverError';
    this.category = category;
  }
}

// ---------------------------------------------------------------------------
// Minimal interface — only the methods the resolver needs from RegistryClient
// ---------------------------------------------------------------------------

export interface RegistryLookup {
  listToolsByCategory(category: string): Promise<ToolRecord[]>;
  getTool(name: string): Promise<ToolRecord | null>;
  listTools(): Promise<ToolRecord[]>;
}

// ---------------------------------------------------------------------------
// Schema mapping
// ---------------------------------------------------------------------------

const STRUCTURED_SCHEMAS = new Set([
  'DataFrame', 'NumpyArray', 'SymbolicExpr', 'Series',
]);

const PRIMITIVE_SCHEMA_MAP: Record<string, JsonSchemaProperty['type']> = {
  Integer: 'integer',
  Float: 'number',
  Boolean: 'boolean',
  String: 'string',
  JsonValue: 'object',
  FilePath: 'string',
};

function portToJsonSchemaProperty(schemaName: string, description: string | null): JsonSchemaProperty {
  if (STRUCTURED_SCHEMAS.has(schemaName)) {
    const hint = `${schemaName}. Pass a value_ref handle from a prior tool call.`;
    return { type: 'object', description: description ? `${description} ${hint}` : hint };
  }

  const primitiveType = PRIMITIVE_SCHEMA_MAP[schemaName] ?? 'string';
  const prop: JsonSchemaProperty = { type: primitiveType };

  if (description) {
    prop.description = description;
  } else if (schemaName === 'FilePath') {
    prop.description = '(file path)';
  }

  return prop;
}

// ---------------------------------------------------------------------------
// ToolRecord → ToolDefinition
// ---------------------------------------------------------------------------

function toolRecordToDefinition(tool: ToolRecord): ToolDefinition {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const port of tool.inputs) {
    properties[port.name] = portToJsonSchemaProperty(port.schemaName, port.description);
    if (port.required) {
      required.push(port.name);
    }
  }

  return {
    name: tool.name.replace(/\./g, '_'),
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
  };
}

function hasGlob(name: string): boolean {
  return name.includes('*') || name.includes('?');
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

export async function resolveToolset(
  toolset: ToolsetEntry[],
  registry: RegistryLookup,
): Promise<ResolvedToolset> {
  if (toolset.length === 0) {
    return { definitions: [], toolNameMap: new Map() };
  }

  const seen = new Map<string, ToolRecord>();  // dotted.name → ToolRecord

  for (const entry of toolset) {
    if ('category' in entry) {
      const tools = await registry.listToolsByCategory(entry.category);
      for (const tool of tools) {
        seen.set(tool.name, tool);
      }
    } else if ('name' in entry) {
      if (hasGlob(entry.name)) {
        const all = await registry.listTools();
        const matched = all.filter(t => micromatch.isMatch(t.name, entry.name));
        if (matched.length === 0) {
          throw new ResolverError(
            'toolset_empty_glob',
            `Toolset glob pattern "${entry.name}" matched zero registered tools.`,
          );
        }
        for (const tool of matched) {
          seen.set(tool.name, tool);
        }
      } else {
        const tool = await registry.getTool(entry.name);
        if (tool === null) {
          throw new ResolverError(
            'tool_not_found',
            `Toolset entry references unknown tool "${entry.name}".`,
          );
        }
        seen.set(tool.name, tool);
      }
    }
  }

  const definitions: ToolDefinition[] = [];
  const toolNameMap = new Map<string, string>();

  for (const [dottedName, tool] of seen) {
    const def = toolRecordToDefinition(tool);
    definitions.push(def);
    toolNameMap.set(def.name, dottedName);
  }

  return { definitions, toolNameMap };
}
```

- [ ] **Step 3: Check `micromatch` availability**

```bash
cd packages/server && node -e "require('micromatch')" 2>&1 || echo "NOT_FOUND"
```

If NOT_FOUND:
```bash
npm install --save micromatch && npm install --save-dev @types/micromatch
```

- [ ] **Step 4: Run tests to confirm green**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/toolset-resolver.test.ts
```

- [ ] **Step 5: Run regression gate**

```bash
cd packages/server && npx vitest run
```

Expected: 264+ passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/agents/toolset-resolver.ts \
        packages/server/src/modules/agents/__tests__/toolset-resolver.test.ts
git commit -m "agents: add toolset-resolver with category/name/glob resolution"
```

---

## Task 2: Error taxonomy extensions + `ToolDefinition` types in `new-types.ts`

**Files:**
- Modify: `packages/server/src/modules/agents/new-types.ts`

No dedicated test — tsc validates structural correctness when consumers reference these types.

- [ ] **Step 1: Add Phase 3 error categories to `BackendErrorCategory`**

Open `packages/server/src/modules/agents/new-types.ts`. Locate `BackendErrorCategory`. Append the new variants:

```typescript
  // Phase 3 additions:
  | 'tool_not_allowed'        // LLM called tool not in toolset
  | 'tool_budget_exhausted'   // same tool failed N consecutive times
  | 'max_turns_exceeded'      // loop hit maxTurns and LLM still emitted tool calls
  | 'signal_parse_error'      // no valid signal block after corrective re-prompt
  | 'wall_clock_timeout'      // node ran longer than wallClockTimeoutMs
  | 'context_exceeded'        // LLM context window full
  | 'toolset_empty_glob'      // glob in toolset matched zero tools
  | 'handle_not_found'        // LLM referenced value handle not in scope
```

- [ ] **Step 2: Add `ToolCall` and `ToolResult` types**

Append to `new-types.ts`:

```typescript
// ---------- Tool calling (Phase 3) ----------

export interface ToolCall {
  toolCallId: string;
  toolName: string;       // underscore form as returned by LLM
  inputs: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;        // JSON-encoded result or error message
  isError?: boolean;
}
```

- [ ] **Step 3: Extend `AssistantMessage` to include `toolCalls`**

Locate `AssistantMessage` in `new-types.ts` and add:

```typescript
export interface AssistantMessage {
  text: string;
  toolCalls?: ToolCall[];    // populated when backend returns tool_use blocks
  stopReason?: string;
}
```

- [ ] **Step 4: Verify**

```bash
cd packages/server && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/agents/new-types.ts
git commit -m "agents: extend new-types with Phase 3 error categories and tool call types"
```

---

## Task 3: Claude backend — tool wire format + `tool_use` parsing

**Files:**
- Modify: `packages/server/src/modules/agents/claude-backend.ts`
- Modify: `packages/server/src/modules/agents/__tests__/claude-backend.test.ts`

- [ ] **Step 1: Add failing tests for tool definition transmission and `tool_use` parsing**

Append to `packages/server/src/modules/agents/__tests__/claude-backend.test.ts`:

```typescript
describe('ClaudeBackend — tool wire format', () => {
  it('includes tools array in request body when toolDefinitions provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    global.fetch = fetchSpy as any;

    const backend = new ClaudeBackend({ apiKey: 'test-key' });
    const tools: ToolDefinition[] = [{
      name: 'statistics_mean',
      description: 'Compute mean',
      inputSchema: {
        type: 'object',
        properties: { values: { type: 'object', description: 'NumpyArray. Pass a value_ref.' } },
        required: ['values'],
      },
    }];
    const handle = await backend.startConversation('sys', tools, 'claude-3-5-haiku-20241022', 1024);
    await backend.sendMessage(handle, 'test');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('statistics_mean');
    expect(body.tools[0].input_schema.properties.values.type).toBe('object');
  });

  it('parses tool_use blocks into AssistantMessage.toolCalls', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'I will call a tool.' },
          { type: 'tool_use', id: 'tu_001', name: 'statistics_mean',
            input: { values: { _type: 'value_ref', _handle: 'vs-abc', _schema: 'NumpyArray' } } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
    });
    global.fetch = fetchSpy as any;

    const backend = new ClaudeBackend({ apiKey: 'test-key' });
    const handle = await backend.startConversation('sys', [], 'claude-3-5-haiku-20241022', 1024);
    const msg = await backend.sendMessage(handle, 'run tools');

    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].toolCallId).toBe('tu_001');
    expect(msg.toolCalls![0].toolName).toBe('statistics_mean');
    expect(msg.toolCalls![0].inputs.values).toMatchObject({ _handle: 'vs-abc' });
    expect(msg.text).toBe('I will call a tool.');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/claude-backend.test.ts
```

- [ ] **Step 3: Update `ClaudeBackend`**

In `claude-backend.ts`:

3a. Add `tools: unknown[]` to `ConversationState`.

3b. Update `startConversation` signature to accept `toolDefinitions: ToolDefinition[]` (or `unknown[]`; the backend only needs to translate them). Translate each `ToolDefinition` to Anthropic wire format and store in `state.tools`:

```typescript
state.tools = toolDefinitions.map(def => ({
  name: def.name,
  description: def.description,
  input_schema: def.inputSchema,
}));
```

3c. Include `tools: state.tools` in every API request body (in `sendMessage` and `sendToolResults`). Only include when non-empty: `...(state.tools.length > 0 && { tools: state.tools })`.

3d. Update response parsing in `sendMessage` (and later `sendToolResults`) to extract `tool_use` blocks:

```typescript
const textBlocks = data.content.filter((c: any) => c.type === 'text');
const toolUseBlocks = data.content.filter((c: any) => c.type === 'tool_use');

const assistantText = textBlocks.map((b: any) => b.text).join('');
const toolCalls: ToolCall[] = toolUseBlocks.map((b: any) => ({
  toolCallId: b.id,
  toolName: b.name,
  inputs: b.input as Record<string, unknown>,
}));

// Store full content array (preserves tool_use blocks for sendToolResults)
state.messages.push({ role: 'assistant', content: data.content });

return { text: assistantText, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
```

- [ ] **Step 4: Run tests**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/claude-backend.test.ts
```

- [ ] **Step 5: Regression gate**

```bash
cd packages/server && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/agents/claude-backend.ts \
        packages/server/src/modules/agents/__tests__/claude-backend.test.ts
git commit -m "agents: claude-backend tool wire format and tool_use response parsing"
```

---

## Task 4: `sendToolResults` — Claude backend

**Files:**
- Modify: `packages/server/src/modules/agents/claude-backend.ts`
- Modify: `packages/server/src/modules/agents/__tests__/claude-backend.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `claude-backend.test.ts`:

```typescript
describe('ClaudeBackend — sendToolResults', () => {
  it('sends tool_result user message and parses next assistant response', async () => {
    const fetchSpy = vi.fn()
      // First call: sendMessage returns tool_use
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            { type: 'tool_use', id: 'tu_001', name: 'statistics_mean', input: { values: 'v' } },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      })
      // Second call: sendToolResults returns final text
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'The mean is 42.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 30, output_tokens: 10 },
        }),
      });
    global.fetch = fetchSpy as any;

    const backend = new ClaudeBackend({ apiKey: 'test-key' });
    const handle = await backend.startConversation('sys', [], 'claude-3-5-haiku-20241022', 1024);
    await backend.sendMessage(handle, 'run it');

    const result = await backend.sendToolResults(handle, [
      { toolCallId: 'tu_001', content: '{"result": 42}', isError: false },
    ]);

    // Verify the second fetch included tool_result content
    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    const toolResultMsg = secondBody.messages.find((m: any) => m.role === 'user' &&
      Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.content[0].tool_use_id).toBe('tu_001');
    expect(toolResultMsg.content[0].content).toBe('{"result": 42}');

    expect(result.text).toBe('The mean is 42.');
    expect(result.toolCalls).toBeUndefined();
  });

  it('marks isError=true in tool_result block', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 5 },
        }),
      });
    global.fetch = fetchSpy as any;

    const backend = new ClaudeBackend({ apiKey: 'test-key' });
    const handle = await backend.startConversation('sys', [], 'claude-3-5-haiku-20241022', 1024);

    await backend.sendToolResults(handle, [
      { toolCallId: 'tu_err', content: 'Tool exploded', isError: true },
    ]);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const block = body.messages[body.messages.length - 2]?.content?.[0];
    // last user message before the call
    const userMsgs = body.messages.filter((m: any) => m.role === 'user');
    const lastUser = userMsgs[userMsgs.length - 1];
    expect(lastUser.content[0].is_error).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/claude-backend.test.ts
```

- [ ] **Step 3: Implement `sendToolResults` in `ClaudeBackend`**

Replace the `throw new BackendError('not_implemented', ...)` stub with:

```typescript
async sendToolResults(
  conversation: ConversationHandle,
  toolResults: ToolResult[],
): Promise<AssistantMessage> {
  const state = this.getConversationState(conversation);

  const toolResultBlocks = toolResults.map(r => ({
    type: 'tool_result' as const,
    tool_use_id: r.toolCallId,
    content: r.content,
    ...(r.isError && { is_error: true }),
  }));

  state.messages.push({ role: 'user', content: toolResultBlocks });

  const body = {
    model: state.model,
    max_tokens: state.maxTokens,
    system: state.systemPrompt,
    ...(state.tools.length > 0 && { tools: state.tools }),
    messages: state.messages,
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new BackendError(mapHttpStatus(response.status), err.error?.message ?? response.statusText);
  }

  const data = await response.json();
  return this.parseAnthropicResponse(state, data);
}
```

Extract the response parsing (text + tool_use) into a private `parseAnthropicResponse(state, data)` helper shared between `sendMessage` and `sendToolResults`.

- [ ] **Step 4: Run tests**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/claude-backend.test.ts
```

- [ ] **Step 5: Regression gate**

```bash
cd packages/server && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/agents/claude-backend.ts \
        packages/server/src/modules/agents/__tests__/claude-backend.test.ts
git commit -m "agents: implement sendToolResults in ClaudeBackend"
```

---

## Task 5: OpenAI-compat backend — tool wire format + `sendToolResults`

**Files:**
- Modify: `packages/server/src/modules/agents/openai-compat-backend.ts`
- Modify: `packages/server/src/modules/agents/__tests__/openai-compat-backend.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `openai-compat-backend.test.ts`:

```typescript
describe('OpenAICompatBackend — tool wire format', () => {
  it('sends tools array in OpenAI function-calling format', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'hi', tool_calls: undefined },
                     finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });
    global.fetch = fetchSpy as any;

    const backend = new OpenAICompatBackend({ endpoint: 'http://localhost:11434/v1', apiKey: 'k' });
    const tools: ToolDefinition[] = [{
      name: 'statistics_mean',
      description: 'Compute mean',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    }];
    const handle = await backend.startConversation('sys', tools, 'gpt-4o', 1024);
    await backend.sendMessage(handle, 'go');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('statistics_mean');
    expect(body.tools[0].function.parameters.properties.x.type).toBe('number');
  });

  it('parses tool_calls from assistant response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_001',
              type: 'function',
              function: { name: 'statistics_mean', arguments: '{"x": 5}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });
    global.fetch = fetchSpy as any;

    const backend = new OpenAICompatBackend({ endpoint: 'http://localhost:11434/v1', apiKey: 'k' });
    const handle = await backend.startConversation('sys', [], 'gpt-4o', 1024);
    const msg = await backend.sendMessage(handle, 'go');

    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].toolCallId).toBe('call_001');
    expect(msg.toolCalls![0].inputs.x).toBe(5);
  });

  it('sends tool results as role:tool messages', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: { role: 'assistant', content: null,
              tool_calls: [{ id: 'call_001', type: 'function',
                function: { name: 'statistics_mean', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Result is 42.' },
                      finish_reason: 'stop' }],
          usage: { prompt_tokens: 20, completion_tokens: 5 },
        }),
      });
    global.fetch = fetchSpy as any;

    const backend = new OpenAICompatBackend({ endpoint: 'http://localhost:11434/v1', apiKey: 'k' });
    const handle = await backend.startConversation('sys', [], 'gpt-4o', 1024);
    await backend.sendMessage(handle, 'go');
    await backend.sendToolResults(handle, [{ toolCallId: 'call_001', content: '42' }]);

    const body = JSON.parse(fetchSpy.mock.calls[1][1].body);
    const toolMsg = body.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe('call_001');
    expect(toolMsg.content).toBe('42');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/openai-compat-backend.test.ts
```

- [ ] **Step 3: Implement in `openai-compat-backend.ts`**

3a. Add `tools: unknown[]` to `ConversationState`.

3b. In `startConversation`, translate `ToolDefinition[]` to OpenAI format:

```typescript
state.tools = toolDefinitions.map(def => ({
  type: 'function',
  function: {
    name: def.name,
    description: def.description,
    parameters: def.inputSchema,
  },
}));
```

3c. Include `...(state.tools.length > 0 && { tools: state.tools })` in every `/v1/chat/completions` request body.

3d. Parse `tool_calls` from the assistant message:

```typescript
const rawMsg = data.choices[0].message;
const toolCalls: ToolCall[] = (rawMsg.tool_calls ?? []).map((tc: any) => ({
  toolCallId: tc.id,
  toolName: tc.function.name,
  inputs: JSON.parse(tc.function.arguments) as Record<string, unknown>,
}));
// Store assistant message with tool_calls in history
state.messages.push({ role: 'assistant', content: rawMsg.content ?? null,
  ...(rawMsg.tool_calls && { tool_calls: rawMsg.tool_calls }) });
```

3e. Implement `sendToolResults`:

```typescript
async sendToolResults(conversation, toolResults) {
  const state = this.getConversationState(conversation);

  for (const r of toolResults) {
    state.messages.push({
      role: 'tool',
      tool_call_id: r.toolCallId,
      content: r.content,
    });
  }

  const body = {
    model: state.model,
    max_tokens: state.maxTokens,
    messages: state.messages,
    ...(state.tools.length > 0 && { tools: state.tools }),
  };

  const response = await fetch(`${this.endpoint}/chat/completions`, { ... });
  // ... parse same as sendMessage
}
```

- [ ] **Step 4: Run tests + regression**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/openai-compat-backend.test.ts
cd packages/server && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/agents/openai-compat-backend.ts \
        packages/server/src/modules/agents/__tests__/openai-compat-backend.test.ts
git commit -m "agents: openai-compat-backend tool wire format and sendToolResults"
```

---

## Task 6: Ollama backend — tool wire format + `sendToolResults`

**Files:**
- Modify: `packages/server/src/modules/agents/ollama-backend.ts`
- Modify: `packages/server/src/modules/agents/__tests__/ollama-backend.test.ts`

Pattern mirrors Task 5. Key differences:

- Endpoint: `/api/chat` (not `/v1/chat/completions`).
- Ollama tool result messages use `{ role: 'tool', content: r.content }` — no `tool_call_id` field (as of Ollama 0.4.x). If the running Ollama version requires `tool_call_id`, add it; document the conditional.
- Tool wire format is identical to OpenAI function calling format.

- [ ] **Step 1: Add failing tests** — same structure as Task 5 but for `OllamaBackend`, verifying `/api/chat` body format and `role: 'tool'` (no `tool_call_id`).

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/ollama-backend.test.ts
```

- [ ] **Step 3: Implement** — same pattern as Task 5, adapting to Ollama-specific request/response shapes.

- [ ] **Step 4: Run tests + regression gate**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/ollama-backend.test.ts
cd packages/server && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/agents/ollama-backend.ts \
        packages/server/src/modules/agents/__tests__/ollama-backend.test.ts
git commit -m "agents: ollama-backend tool wire format and sendToolResults"
```

---

## Task 7: Signal block parser

**Files:**
- Create: `packages/server/src/modules/agents/signal-parser.ts`
- Create: `packages/server/src/modules/agents/__tests__/signal-parser.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/server/src/modules/agents/__tests__/signal-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractSignalBlock, parseSignal, SignalParseError } from '../signal-parser.js';

const VALID_SIGNAL = JSON.stringify({
  status: 'success',
  agent: 'test_agent',
  outputs: [],
});

describe('extractSignalBlock', () => {
  it('returns null when no signal block present', () => {
    expect(extractSignalBlock('just some text')).toBeNull();
  });

  it('extracts a single signal block', () => {
    const text = `Some text\n\`\`\`signal\n${VALID_SIGNAL}\n\`\`\`\nTrailing text`;
    expect(extractSignalBlock(text)).toBe(VALID_SIGNAL);
  });

  it('returns the LAST block when multiple are present', () => {
    const first = JSON.stringify({ status: 'failure', agent: 'a', outputs: [] });
    const last = JSON.stringify({ status: 'success', agent: 'b', outputs: [] });
    const text = `\`\`\`signal\n${first}\n\`\`\`\nMore text\n\`\`\`signal\n${last}\n\`\`\``;
    expect(extractSignalBlock(text)).toBe(last);
  });

  it('handles multiline JSON inside signal block', () => {
    const json = `{\n  "status": "success",\n  "agent": "x",\n  "outputs": []\n}`;
    const text = `\`\`\`signal\n${json}\n\`\`\``;
    expect(extractSignalBlock(text)).toBe(json);
  });
});

describe('parseSignal', () => {
  it('returns parsed SignalFile for valid JSON with required fields', () => {
    const signal = parseSignal(VALID_SIGNAL);
    expect(signal.status).toBe('success');
    expect(signal.agent).toBe('test_agent');
    expect(signal.outputs).toEqual([]);
  });

  it('throws SignalParseError for invalid JSON', () => {
    expect(() => parseSignal('not json')).toThrow(SignalParseError);
  });

  it('throws SignalParseError when required field missing', () => {
    expect(() => parseSignal('{"status":"success","agent":"x"}')).toThrow(SignalParseError);
  });

  it('throws SignalParseError when status field missing', () => {
    expect(() => parseSignal('{"agent":"x","outputs":[]}')).toThrow(SignalParseError);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/signal-parser.test.ts
```

- [ ] **Step 3: Implement `signal-parser.ts`**

`packages/server/src/modules/agents/signal-parser.ts`:

```typescript
/**
 * Signal block parser — Node Runtimes Phase 3
 *
 * Extracts and validates fenced `signal` code blocks from LLM responses.
 * The last block wins when multiple are present.
 */

export interface SignalFile {
  status: 'success' | 'failure' | 'partial';
  agent: string;
  outputs: unknown[];
  [key: string]: unknown;
}

export class SignalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignalParseError';
  }
}

const SIGNAL_BLOCK_RE = /```signal\n([\s\S]*?)\n```/g;

/**
 * Find all fenced ```signal blocks in `text`.
 * Returns the content of the LAST block, or null if none found.
 */
export function extractSignalBlock(text: string): string | null {
  const matches = [...text.matchAll(SIGNAL_BLOCK_RE)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];
}

/**
 * Parse a signal block content string into a validated `SignalFile`.
 * Throws `SignalParseError` on malformed JSON or missing required fields.
 */
export function parseSignal(content: string): SignalFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new SignalParseError(`Signal block is not valid JSON: ${(e as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SignalParseError('Signal block must be a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;

  if (!('status' in obj)) {
    throw new SignalParseError('Signal block missing required field: "status".');
  }
  if (!('agent' in obj)) {
    throw new SignalParseError('Signal block missing required field: "agent".');
  }
  if (!('outputs' in obj)) {
    throw new SignalParseError('Signal block missing required field: "outputs".');
  }

  return obj as SignalFile;
}

/**
 * Attempt to extract and parse a signal from LLM response text.
 * Returns null if no signal block is present.
 * Throws `SignalParseError` if a block is present but invalid.
 */
export function extractAndParseSignal(text: string): SignalFile | null {
  const block = extractSignalBlock(text);
  if (block === null) return null;
  return parseSignal(block);
}
```

- [ ] **Step 4: Run tests + regression gate**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/signal-parser.test.ts
cd packages/server && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/agents/signal-parser.ts \
        packages/server/src/modules/agents/__tests__/signal-parser.test.ts
git commit -m "agents: add signal-parser with regex extraction and validation"
```

---

## Task 8: Reasoning runtime — core tool-calling loop

**Files:**
- Create: `packages/server/src/modules/agents/reasoning-runtime.ts`
- Create: `packages/server/src/modules/agents/__tests__/reasoning-runtime.test.ts`

This is the CORE task. Full verbatim code provided.

- [ ] **Step 1: Write failing tests**

`packages/server/src/modules/agents/__tests__/reasoning-runtime.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReasoningNode } from '../reasoning-runtime.js';
import type { AgentBackend, AssistantMessage, ToolCall, ToolResult } from '../../agents/new-types.js';
import type { ConversationHandle } from '../../agents/new-types.js';

// ---- helpers ----

const MOCK_HANDLE = 'conv-handle-001' as unknown as ConversationHandle;

function makeSignalText(status = 'success'): string {
  return `Here is my answer.\n\`\`\`signal\n${JSON.stringify({
    status, agent: 'test_agent', outputs: [],
  })}\n\`\`\``;
}

function makeToolCallResponse(toolName: string, toolCallId: string, inputs = {}): AssistantMessage {
  return {
    text: `I will call ${toolName}.`,
    toolCalls: [{ toolCallId, toolName, inputs }],
  };
}

function makeFinalResponse(text = makeSignalText()): AssistantMessage {
  return { text, toolCalls: undefined };
}

function mockBackend(overrides: Partial<AgentBackend> = {}): AgentBackend {
  return {
    startConversation: vi.fn().mockResolvedValue(MOCK_HANDLE),
    sendMessage: vi.fn().mockResolvedValue(makeFinalResponse()),
    sendToolResults: vi.fn().mockResolvedValue(makeFinalResponse()),
    closeConversation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AgentBackend;
}

function mockRegistry(toolResult: unknown = { result: 42 }) {
  return {
    invoke: vi.fn().mockResolvedValue({ result: toolResult }),
  };
}

function mockValueStore() {
  const store = new Map<string, unknown>();
  return {
    put: vi.fn((handle: string, value: unknown) => { store.set(handle, value); }),
    get: vi.fn((handle: string) => store.get(handle)),
    has: vi.fn((handle: string) => store.has(handle)),
    adopt: vi.fn((handle: string, value: unknown) => { store.set(handle, value); }),
    generateHandle: vi.fn(() => `vs-${Date.now()}-mock`),
  };
}

const BASE_PARAMS = {
  toolDefinitions: [],
  toolNameMap: new Map<string, string>(),
  runId: 'run-001',
  nodeName: 'test_node',
  purpose: 'Test purpose.',
  systemPrompt: 'You are a test agent.',
  model: 'claude-3-5-haiku-20241022',
  maxTokens: 1024,
};

// ---- tests ----

describe('runReasoningNode — single turn (no tool calls)', () => {
  it('returns parsed signal when LLM responds with valid signal on first turn', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(makeFinalResponse()),
    });
    const runStore = mockValueStore();
    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      registryClient: mockRegistry() as any,
      valueStore: runStore as any,
    });

    expect(result.signal.status).toBe('success');
    expect(result.turnsUsed).toBe(1);
    expect(result.toolCallsTotal).toBe(0);
    expect(backend.startConversation).toHaveBeenCalledOnce();
    expect(backend.sendMessage).toHaveBeenCalledWith(MOCK_HANDLE, 'Test purpose.');
    expect(backend.closeConversation).toHaveBeenCalledOnce();
  });
});

describe('runReasoningNode — tool call round-trip', () => {
  it('dispatches tool calls, sends results, then parses signal on second turn', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        makeToolCallResponse('statistics_mean', 'tc_001', { x: 5 }),
      ),
      sendToolResults: vi.fn().mockResolvedValue(makeFinalResponse()),
    });
    const registry = mockRegistry({ mean: 3.14 });
    const runStore = mockValueStore();

    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      toolNameMap: new Map([['statistics_mean', 'statistics.mean']]),
      registryClient: registry as any,
      valueStore: runStore as any,
    });

    expect(registry.invoke).toHaveBeenCalledWith('statistics.mean', { x: 5 }, expect.anything());
    expect(backend.sendToolResults).toHaveBeenCalledOnce();
    expect(result.turnsUsed).toBe(2);
    expect(result.toolCallsTotal).toBe(1);
    expect(result.signal.status).toBe('success');
  });
});

describe('runReasoningNode — per-tool retry budget', () => {
  it('injects BUDGET_EXHAUSTED result after 3 consecutive failures and then succeeds', async () => {
    let sendToolResultsCallCount = 0;
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        makeToolCallResponse('statistics_mean', 'tc_001'),
      ),
      sendToolResults: vi.fn().mockImplementation(async () => {
        sendToolResultsCallCount++;
        if (sendToolResultsCallCount <= 3) {
          return makeToolCallResponse('statistics_mean', `tc_00${sendToolResultsCallCount + 1}`);
        }
        return makeFinalResponse();
      }),
    });
    const registry = {
      invoke: vi.fn().mockRejectedValue(new Error('Tool failed')),
    };

    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      toolNameMap: new Map([['statistics_mean', 'statistics.mean']]),
      registryClient: registry as any,
      valueStore: mockValueStore() as any,
      perToolRetryBudget: 3,
    });

    // Budget exhausted message sent on 3rd consecutive failure
    const lastToolResultsCall = (backend.sendToolResults as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: any[]) => call[1]?.[0]?.content?.includes('BUDGET_EXHAUSTED'),
    );
    expect(lastToolResultsCall).toBeDefined();
    expect(result.signal.status).toBe('success');
  });
});

describe('runReasoningNode — max turns', () => {
  it('injects budget message at maxTurns and succeeds when LLM cooperates', async () => {
    let callCount = 0;
    const backend = mockBackend({
      sendMessage: vi.fn().mockImplementation(async () => {
        callCount++;
        // First call returns tool use; subsequent sendMessage (budget) returns final answer
        if (callCount === 1) {
          return makeToolCallResponse('statistics_mean', 'tc_001');
        }
        return makeFinalResponse();
      }),
      sendToolResults: vi.fn().mockImplementation(async () => {
        return makeToolCallResponse('statistics_mean', `tc_loop_${callCount}`);
      }),
    });

    await expect(
      runReasoningNode({
        ...BASE_PARAMS,
        backend,
        toolNameMap: new Map([['statistics_mean', 'statistics.mean']]),
        registryClient: mockRegistry() as any,
        valueStore: mockValueStore() as any,
        maxTurns: 3,
      }),
    ).resolves.toMatchObject({ signal: { status: 'success' } });

    const sendMessageCalls = (backend.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    const budgetCall = sendMessageCalls.find((call: any[]) =>
      typeof call[1] === 'string' && call[1].includes('turn budget'),
    );
    expect(budgetCall).toBeDefined();
  });

  it('throws max_turns_exceeded when LLM still emits tool calls after budget message', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        makeToolCallResponse('statistics_mean', 'tc_001'),
      ),
      sendToolResults: vi.fn().mockResolvedValue(
        makeToolCallResponse('statistics_mean', 'tc_002'),
      ),
    });

    await expect(
      runReasoningNode({
        ...BASE_PARAMS,
        backend,
        toolNameMap: new Map([['statistics_mean', 'statistics.mean']]),
        registryClient: mockRegistry() as any,
        valueStore: mockValueStore() as any,
        maxTurns: 2,
      }),
    ).rejects.toMatchObject({ category: 'max_turns_exceeded' });
  });
});

describe('runReasoningNode — signal parse error', () => {
  it('sends corrective re-prompt on missing signal block', async () => {
    let sendMessageCallCount = 0;
    const backend = mockBackend({
      sendMessage: vi.fn().mockImplementation(async () => {
        sendMessageCallCount++;
        if (sendMessageCallCount === 1) {
          return { text: 'I forgot the signal block.', toolCalls: undefined };
        }
        // Second call (corrective re-prompt)
        return makeFinalResponse();
      }),
    });

    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      registryClient: mockRegistry() as any,
      valueStore: mockValueStore() as any,
    });

    expect(sendMessageCallCount).toBe(2);
    expect(result.signal.status).toBe('success');
  });

  it('throws signal_parse_error when corrective re-prompt also fails', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        { text: 'No signal here.', toolCalls: undefined },
      ),
    });

    await expect(
      runReasoningNode({
        ...BASE_PARAMS,
        backend,
        registryClient: mockRegistry() as any,
        valueStore: mockValueStore() as any,
      }),
    ).rejects.toMatchObject({ category: 'signal_parse_error' });
  });
});

describe('runReasoningNode — tool_not_allowed', () => {
  it('returns error result when LLM calls tool not in toolNameMap', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        makeToolCallResponse('unauthorized_tool', 'tc_001'),
      ),
      sendToolResults: vi.fn().mockResolvedValue(makeFinalResponse()),
    });

    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      toolNameMap: new Map(),   // empty — no tools allowed
      registryClient: mockRegistry() as any,
      valueStore: mockValueStore() as any,
    });

    const toolResultsArg = (backend.sendToolResults as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(toolResultsArg[0].isError).toBe(true);
    expect(toolResultsArg[0].content).toContain('not allowed');
    expect(result.signal.status).toBe('success');
  });
});

describe('runReasoningNode — wall clock timeout', () => {
  it('throws wall_clock_timeout when loop takes too long', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 500)),
      ),
    });

    await expect(
      runReasoningNode({
        ...BASE_PARAMS,
        backend,
        registryClient: mockRegistry() as any,
        valueStore: mockValueStore() as any,
        wallClockTimeoutMs: 50,
      }),
    ).rejects.toMatchObject({ category: 'wall_clock_timeout' });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/reasoning-runtime.test.ts
```

- [ ] **Step 3: Implement `reasoning-runtime.ts`**

`packages/server/src/modules/agents/reasoning-runtime.ts`:

```typescript
/**
 * Reasoning Runtime — Node Runtimes Phase 3
 *
 * Orchestrates the multi-turn tool-calling loop for `kind: reasoning` nodes.
 *
 * Public API:
 *   runReasoningNode(params: ReasoningNodeParams): Promise<ReasoningNodeResult>
 *
 * State machine:
 *   startConversation → sendMessage(purpose)
 *     → [no tool calls] → parseSignal → done
 *     → [tool calls]    → dispatchTools → sendToolResults → loop
 *
 * Safety mechanisms:
 *   - Per-tool consecutive failure budget (default 3)
 *   - Max turns before forced termination message (default 20)
 *   - Wall clock timeout via Promise.race (default 900s)
 *
 * Scope-local ValueStore:
 *   Created fresh per invocation. Upstream input handles pre-loaded.
 *   Declared signal outputs promoted to run-level store on completion.
 */

import type { AgentBackend, ToolCall, ToolResult } from './new-types.js';
import type { ToolDefinition } from './toolset-resolver.js';
import { extractAndParseSignal, SignalParseError } from './signal-parser.js';
import type { SignalFile } from './signal-parser.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ReasoningErrorCategory =
  | 'tool_not_allowed'
  | 'tool_budget_exhausted'
  | 'max_turns_exceeded'
  | 'signal_parse_error'
  | 'wall_clock_timeout'
  | 'context_exceeded'
  | 'handle_not_found';

export class ReasoningError extends Error {
  readonly category: ReasoningErrorCategory;
  constructor(category: ReasoningErrorCategory, message: string) {
    super(message);
    this.name = 'ReasoningError';
    this.category = category;
  }
}

// ---------------------------------------------------------------------------
// Minimal value store interface
// ---------------------------------------------------------------------------

export interface ScopeValueStore {
  put(handle: string, value: unknown): void;
  get(handle: string): unknown;
  has(handle: string): boolean;
  adopt(handle: string, value: unknown): void;
  generateHandle(nodeName: string, portName: string): string;
}

// ---------------------------------------------------------------------------
// Minimal registry interface
// ---------------------------------------------------------------------------

export interface RuntimeRegistryClient {
  invoke(toolName: string, inputs: Record<string, unknown>, opts: {
    valueStore: ScopeValueStore;
  }): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReasoningNodeParams {
  backend: AgentBackend;
  toolDefinitions: ToolDefinition[];
  toolNameMap: Map<string, string>;    // underscore_name → dotted.name
  registryClient: RuntimeRegistryClient;
  valueStore: ScopeValueStore;         // scope-local store for this node
  runId: string;
  nodeName: string;
  purpose: string;                     // resolved purpose markdown
  systemPrompt: string;
  model: string;
  maxTokens?: number;
  maxTurns?: number;                   // default 20
  perToolRetryBudget?: number;         // default 3
  wallClockTimeoutMs?: number;         // default 900_000
}

export interface ReasoningNodeResult {
  signal: SignalFile;
  reasoningTrace: string;
  turnsUsed: number;
  toolCallsTotal: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_PER_TOOL_RETRY_BUDGET = 3;
const DEFAULT_WALL_CLOCK_TIMEOUT_MS = 900_000;

const MAX_TURNS_MESSAGE =
  'You have reached your turn budget. Please produce your final answer now, ' +
  'with a properly formatted signal block at the end. Do not make any more tool calls.';

const CORRECTIVE_REPROMPT_MESSAGE =
  'Your last response did not contain a valid signal block. Please produce your ' +
  'final answer again. Your response MUST end with a properly formatted signal ' +
  'block in a fenced code block tagged `signal`, containing valid JSON with ' +
  '`status`, `agent`, and `outputs` fields.';

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function _runLoop(params: ReasoningNodeParams): Promise<ReasoningNodeResult> {
  const {
    backend,
    toolDefinitions,
    toolNameMap,
    registryClient,
    valueStore,
    nodeName,
    purpose,
    systemPrompt,
    model,
    maxTokens = 4096,
    maxTurns = DEFAULT_MAX_TURNS,
    perToolRetryBudget = DEFAULT_PER_TOOL_RETRY_BUDGET,
  } = params;

  const traceLines: string[] = [];
  let turnsUsed = 0;
  let toolCallsTotal = 0;
  let correctiveRepromptIssued = false;

  // Per-tool consecutive failure counter
  const consecutiveFailures = new Map<string, number>();

  const conversationHandle = await backend.startConversation(
    systemPrompt,
    toolDefinitions,
    model,
    maxTokens,
  );

  try {
    // --- Turn 1: send purpose ---
    let response = await backend.sendMessage(conversationHandle, purpose);
    turnsUsed++;
    traceLines.push(`[turn ${turnsUsed}] ${response.text}`);

    // --- Loop ---
    while (true) {
      const hasToolCalls = (response.toolCalls ?? []).length > 0;

      if (!hasToolCalls) {
        // Try to parse signal
        const signal = extractAndParseSignal(response.text);

        if (signal !== null) {
          return {
            signal,
            reasoningTrace: traceLines.join('\n\n'),
            turnsUsed,
            toolCallsTotal,
          };
        }

        // No signal block — corrective re-prompt
        if (correctiveRepromptIssued) {
          throw new ReasoningError(
            'signal_parse_error',
            `Node "${nodeName}" failed to produce a valid signal block after corrective re-prompt.`,
          );
        }

        correctiveRepromptIssued = true;
        traceLines.push('[corrective re-prompt issued]');
        response = await backend.sendMessage(conversationHandle, CORRECTIVE_REPROMPT_MESSAGE);
        turnsUsed++;
        traceLines.push(`[turn ${turnsUsed} corrective] ${response.text}`);
        continue;
      }

      // Has tool calls — check turn budget
      if (turnsUsed >= maxTurns) {
        traceLines.push('[max turns budget injected]');
        response = await backend.sendMessage(conversationHandle, MAX_TURNS_MESSAGE);
        turnsUsed++;
        traceLines.push(`[turn ${turnsUsed} budget] ${response.text}`);

        if ((response.toolCalls ?? []).length > 0) {
          throw new ReasoningError(
            'max_turns_exceeded',
            `Node "${nodeName}" exceeded max turns (${maxTurns}) and LLM still emitted tool calls.`,
          );
        }
        // Fall through to signal parsing at top of loop
        continue;
      }

      // --- Dispatch tool calls ---
      const toolResults: ToolResult[] = [];

      for (const toolCall of response.toolCalls!) {
        toolCallsTotal++;
        const result = await dispatchToolCall(
          toolCall,
          toolNameMap,
          registryClient,
          valueStore,
          nodeName,
          consecutiveFailures,
          perToolRetryBudget,
        );
        toolResults.push(result);
      }

      // Send results back to LLM
      response = await backend.sendToolResults(conversationHandle, toolResults);
      turnsUsed++;
      traceLines.push(`[turn ${turnsUsed} tool results] ${response.text}`);
    }
  } finally {
    await backend.closeConversation(conversationHandle);
  }
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

async function dispatchToolCall(
  toolCall: ToolCall,
  toolNameMap: Map<string, string>,
  registryClient: RuntimeRegistryClient,
  valueStore: ScopeValueStore,
  nodeName: string,
  consecutiveFailures: Map<string, number>,
  perToolRetryBudget: number,
): Promise<ToolResult> {
  const dottedName = toolNameMap.get(toolCall.toolName);

  if (dottedName === undefined) {
    return {
      toolCallId: toolCall.toolCallId,
      content: `ERROR: Tool "${toolCall.toolName}" is not allowed in this node's toolset. ` +
               `Only these tools are available: [${[...toolNameMap.keys()].join(', ')}].`,
      isError: true,
    };
  }

  // Check if this tool's budget is already exhausted
  const failCount = consecutiveFailures.get(dottedName) ?? 0;
  if (failCount >= perToolRetryBudget) {
    return {
      toolCallId: toolCall.toolCallId,
      content: `BUDGET_EXHAUSTED: This tool has failed ${perToolRetryBudget} consecutive times. ` +
               `Do not call it again in this session. Try a different approach or proceed without this tool's output.`,
      isError: true,
    };
  }

  // Resolve inputs (pass through value_ref handles as-is; registry resolves them)
  const inputs = toolCall.inputs as Record<string, unknown>;

  try {
    const output = await registryClient.invoke(dottedName, inputs, { valueStore });

    // Success: reset consecutive failure count
    consecutiveFailures.set(dottedName, 0);

    const content = typeof output === 'string' ? output : JSON.stringify(output);
    return {
      toolCallId: toolCall.toolCallId,
      content,
      isError: false,
    };
  } catch (err) {
    const newFailCount = failCount + 1;
    consecutiveFailures.set(dottedName, newFailCount);

    const errorMessage = err instanceof Error ? err.message : String(err);

    if (newFailCount >= perToolRetryBudget) {
      return {
        toolCallId: toolCall.toolCallId,
        content: `BUDGET_EXHAUSTED: This tool has failed ${perToolRetryBudget} consecutive times. ` +
                 `Do not call it again in this session. Try a different approach or proceed without this tool's output.`,
        isError: true,
      };
    }

    return {
      toolCallId: toolCall.toolCallId,
      content: `ERROR: ${errorMessage}`,
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runReasoningNode(
  params: ReasoningNodeParams,
): Promise<ReasoningNodeResult> {
  const wallClockTimeoutMs = params.wallClockTimeoutMs ?? DEFAULT_WALL_CLOCK_TIMEOUT_MS;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new ReasoningError(
        'wall_clock_timeout',
        `Node "${params.nodeName}" exceeded wall clock timeout of ${wallClockTimeoutMs}ms.`,
      )),
      wallClockTimeoutMs,
    ),
  );

  return Promise.race([_runLoop(params), timeoutPromise]);
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/reasoning-runtime.test.ts
```

All tests should pass. If the wall clock timeout test is flaky (CI timing), increase the timeout margin in the test.

- [ ] **Step 5: Regression gate**

```bash
cd packages/server && npx vitest run
```

Expected: 264+ passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/agents/reasoning-runtime.ts \
        packages/server/src/modules/agents/__tests__/reasoning-runtime.test.ts
git commit -m "agents: add reasoning-runtime with tool-calling loop, retry budget, signal parsing"
```

---

## Task 9: Scope-local `ValueStore` lifecycle

**Files:**
- Modify: `packages/server/src/modules/registry/execution/value-store.ts`
- Modify: `packages/server/src/modules/agents/reasoning-runtime.ts`

- [ ] **Step 1: Add `adopt` method to `ValueStore`**

Read `packages/server/src/modules/registry/execution/value-store.ts` to confirm current API. Add:

```typescript
/**
 * Import a value envelope from an external (scope-local) store into this store.
 * Used when promoting scope-local outputs to the run-level store at node completion.
 */
adopt(handle: string, envelope: ValueEnvelope): void {
  this.store.set(handle, envelope);
}
```

If `ValueStore` already has a similar method, adapt accordingly.

- [ ] **Step 2: Add failing test for scope-local lifecycle**

Append to `reasoning-runtime.test.ts`:

```typescript
describe('runReasoningNode — scope-local ValueStore lifecycle', () => {
  it('pre-loads upstream handles into scope store before loop starts', async () => {
    const scopeStore = mockValueStore();
    const upstreamHandle = 'vs-upstream-001';
    const upstreamEnvelope = { _type: 'value_ref', _handle: upstreamHandle, _schema: 'Float' };

    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(makeFinalResponse()),
    });

    await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      registryClient: mockRegistry() as any,
      valueStore: scopeStore as any,
      upstreamHandles: [[upstreamHandle, upstreamEnvelope]] as any,
    });

    expect(scopeStore.put).toHaveBeenCalledWith(upstreamHandle, upstreamEnvelope);
  });
});
```

- [ ] **Step 3: Add `upstreamHandles` to `ReasoningNodeParams` and pre-load them**

In `reasoning-runtime.ts`, extend `ReasoningNodeParams`:

```typescript
export interface ReasoningNodeParams {
  // ... existing fields ...
  upstreamHandles?: Array<[string, unknown]>;  // [handle, envelope] pairs to pre-load
  runLevelStore?: ScopeValueStore;             // run-level store for output promotion
}
```

At the start of `_runLoop`, before `startConversation`, pre-load upstream handles:

```typescript
if (params.upstreamHandles) {
  for (const [handle, envelope] of params.upstreamHandles) {
    valueStore.put(handle, envelope);
  }
}
```

- [ ] **Step 4: Promote declared outputs after signal parsed**

After `signal` is successfully parsed in `_runLoop`, before returning:

```typescript
// Promote declared outputs from scope-local store to run-level store
if (params.runLevelStore && signal.outputs && Array.isArray(signal.outputs)) {
  for (const output of signal.outputs) {
    if (typeof output === 'object' && output !== null) {
      const ref = output as Record<string, unknown>;
      if (typeof ref.value_ref === 'string' && valueStore.has(ref.value_ref as string)) {
        const envelope = valueStore.get(ref.value_ref as string);
        params.runLevelStore.adopt(ref.value_ref as string, envelope as any);
      }
    }
  }
}
```

- [ ] **Step 5: Run tests + regression gate**

```bash
cd packages/server && npx vitest run src/modules/agents/__tests__/reasoning-runtime.test.ts
cd packages/server && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/registry/execution/value-store.ts \
        packages/server/src/modules/agents/reasoning-runtime.ts \
        packages/server/src/modules/agents/__tests__/reasoning-runtime.test.ts
git commit -m "agents: scope-local ValueStore lifecycle with upstream handle pre-loading and output promotion"
```

---

## Task 10: DAG executor integration

**Files:**
- Modify: `packages/server/src/modules/workflow/dag-executor.ts`

- [ ] **Step 1: Read current `dag-executor.ts`** to understand `dispatchNewReasoningNode` signature, how backend is selected, and how ValueStore is threaded.

- [ ] **Step 2: Replace `dispatchNewReasoningNode` with `runReasoningNode` call**

In `dag-executor.ts`:

2a. Import:
```typescript
import { runReasoningNode } from '../agents/reasoning-runtime.js';
import { resolveToolset } from '../agents/toolset-resolver.js';
```

2b. Delete `dispatchNewReasoningNode` function.

2c. In the DAG node dispatch switch/if for `kind: reasoning`, replace the call to `dispatchNewReasoningNode(...)` with:

```typescript
// Resolve toolset from registry
const { definitions: toolDefinitions, toolNameMap } = await resolveToolset(
  node.toolset ?? [],
  registryClient,
);

// Create scope-local ValueStore for this node
const scopeStore = new ValueStore();

// Collect upstream handles (values from prior nodes passed as inputs to this node)
const upstreamHandles: Array<[string, unknown]> = [];
for (const [inputName, inputHandle] of Object.entries(resolvedInputs ?? {})) {
  if (typeof inputHandle === 'object' && inputHandle !== null &&
      '_type' in inputHandle && (inputHandle as any)._type === 'value_ref') {
    const handle = (inputHandle as any)._handle as string;
    const envelope = runLevelStore.get(handle);
    if (envelope !== undefined) {
      upstreamHandles.push([handle, envelope]);
    }
  }
}

const reasoningResult = await runReasoningNode({
  backend: selectedBackend,
  toolDefinitions,
  toolNameMap,
  registryClient,
  valueStore: scopeStore,
  runLevelStore,
  upstreamHandles,
  runId,
  nodeName: node.name,
  purpose: resolvedPurpose,
  systemPrompt: resolvedSystemPrompt,
  model: node.model ?? defaultModel,
  maxTokens: node.max_tokens,
  maxTurns: node.max_turns,
  wallClockTimeoutMs: (node.timeout_seconds ?? 900) * 1000,
});

// reasoningResult.signal is the parsed SignalFile; emit it as node output
```

Note: Variable names (`resolvedInputs`, `runLevelStore`, `selectedBackend`, `registryClient`, etc.) must match what currently exists in `dag-executor.ts`. Read the file carefully before making changes.

- [ ] **Step 3: Run regression gate**

```bash
cd packages/server && npx vitest run
```

Expected: 264+ passing, 0 failing.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/workflow/dag-executor.ts
git commit -m "workflow: replace dispatchNewReasoningNode with runReasoningNode from reasoning-runtime"
```

---

## Task 11: Migrate `smoke-test` and `math-discovery` workflows

**Abbreviated task.**

- [ ] Read `workflows/smoke-test/workflow.yaml` and `workflows/math-discovery/workflow.yaml` (or `workflows/presets/` if nested).
- [ ] For each `backend: claude-code` node: change to `backend: claude`. Add `model: claude-haiku-3-5` (or `claude-3-5-haiku-20241022`). Add `toolset: []` or appropriate category entries.
- [ ] For each `backend: process` node (e.g., `echo_node`): change to `backend: claude`, `toolset: []`.
- [ ] Verify no YAML parse errors: `cd packages/server && npx tsc --noEmit`.
- [ ] Commit: `git commit -m "workflows: migrate smoke-test and math-discovery to new backends"`.

---

## Task 12: Migrate `sequence-explorer` workflow

**Abbreviated task.**

- [ ] Read `workflows/sequence-explorer/workflow.yaml` (or `workflows/presets/sequence-explorer/workflow.yaml`).
- [ ] Apply same migration rules as Task 11: `backend: claude-code` → `backend: claude` + explicit `toolset`.
- [ ] Verify: `npx tsc --noEmit`.
- [ ] Commit: `git commit -m "workflows: migrate sequence-explorer to new backends"`.

---

## Task 13: Migrate `research-swarm` workflow

**Abbreviated task.**

- [ ] Read `workflows/research-swarm/workflow.yaml`.
- [ ] For all 14 nodes, add `backend: claude`, `model: claude-sonnet-4-6` (or `claude-3-5-sonnet-20241022`).
- [ ] Apply toolset declarations per spec §11.2:
  - `ingestor`, `profiler`: `toolset: [{category: pandas}, {category: descriptive_statistics}]`
  - `hypothesist`, `adversary`, `judge`, `falsifier`: `toolset: [{category: statistics}, {category: hypothesis_testing}]`
  - `architect`, `coder`, `executor`: `toolset: [{category: pandas}, {category: sklearn}]`
  - `generalizer`, `reporter`, `meta_analyst`, `fixer`, `auditor`: `toolset: []`
- [ ] Verify: `npx tsc --noEmit`.
- [ ] Commit: `git commit -m "workflows: migrate research-swarm (14 nodes) to new backends"`.

---

## Task 14: Migrate `theorem-prover-mini` workflow

**Abbreviated task.**

- [ ] Read `workflows/theorem-prover-mini/workflow.yaml`.
- [ ] Before migrating, verify `lean-checker` preset produces valid signal without tool calls (inspect the preset YAML). Document finding in commit message.
- [ ] `conjecturer`, `formalizer`, `prover`, `reporter` → `backend: claude`, `model: claude-haiku-3-5`, `toolset: []` (or appropriate).
- [ ] `lean_check` → `backend: claude`, `model: claude-haiku-3-5`, `toolset: []`.
- [ ] Verify: `npx tsc --noEmit`.
- [ ] Commit: `git commit -m "workflows: migrate theorem-prover-mini including lean_check with empty toolset"`.

---

## Task 15: Legacy removal — delete session files + `LegacyAgentBackend`

**Abbreviated task.**

- [ ] Verify all five workflows pass (smoke test run or at minimum `tsc --noEmit` clean) before proceeding.
- [ ] Delete the three legacy session files:
  ```bash
  rm packages/server/src/modules/agents/claude-code-session.ts
  rm packages/server/src/modules/agents/process-session.ts
  rm packages/server/src/modules/agents/local-llm-session.ts
  ```
- [ ] In `packages/server/src/modules/agents/agent-backend.ts`, remove:
  - `BackendType` type alias
  - `AgentConfig`, `AgentResult`, `AgentArtifact`, `AgentInfo` interfaces
  - `LegacyAgentBackend` interface
  - All `@deprecated` JSDoc blocks and any `export` of the above
- [ ] Run `npx tsc --noEmit` to find all import errors caused by deletion. Fix each.
- [ ] Run `npx vitest run` — 264+ passing.
- [ ] Commit: `git commit -m "agents: delete legacy session files and LegacyAgentBackend interface"`.

---

## Task 16: Legacy removal — remove node-pty

**Abbreviated task.**

- [ ] Read `packages/server/package.json` and `package.json` (root). Locate `node-pty` in `dependencies`.
- [ ] Remove `"node-pty": "..."` from `dependencies`.
- [ ] Check for any rebuild scripts referencing `node-pty` in `scripts` block — remove them.
- [ ] Run `npm install` (or `pnpm install`) from the repo root to update the lockfile.
- [ ] Verify build: `cd packages/server && npx tsc --noEmit`.
- [ ] Commit: `git commit -m "deps: remove node-pty from dependencies"`.

---

## Task 17: Legacy sweep — clean remaining references

**Abbreviated task.**

- [ ] Grep for remaining references:
  ```bash
  grep -r "LegacyAgentBackend\|claude-code-session\|process-session\|local-llm-session\|node-pty" \
    packages/server/src/ --include="*.ts"
  ```
- [ ] For each hit: remove the import/reference or update to use the new backend API.
- [ ] Grep for `backend: 'claude-code'` or `'process'` or `'local-llm'` string literals in TypeScript source (not YAML). Remove or update.
- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit: `git commit -m "agents: sweep remaining legacy backend references"`.

---

## Task 18: Full module sweep — final regression gate

**Abbreviated task.**

- [ ] Run the full test suite:
  ```bash
  cd packages/server && npx vitest run
  ```
  Expected: 264+ passing, 0 failing, 6 skipped (or better).

- [ ] Run `tsc --noEmit`:
  ```bash
  cd packages/server && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] Update `HIGH_LEVEL_DESIGN.md`: mark Phase 3 as complete; update the status table if present.

- [ ] Final commit:
  ```bash
  git commit -m "docs: mark Node Runtimes Phase 3 complete in HIGH_LEVEL_DESIGN"
  ```

---

## Open Questions (Deferred, from Spec §16)

**Q1 — `tool_choice`:** `"auto"` (or omitted) is the default. Add node-level `force_tool_use: true` only if a workflow requires it.

**Q2 — Token counting for tool results:** Consider adding `maxToolResultTokens?: number` (default 4000) to `ReasoningNodeParams`. Truncate with `[truncated]` suffix. Implement if a tool produces excessively long output during testing.

**Q3 — Ollama `tool_call_id` compatibility:** Track Ollama changelog. The current implementation omits `tool_call_id` in tool result messages for Ollama.

**Q4 — `research-swarm` toolset coverage:** Coordinate TR Phase 3 full merge timing. If TR Phase 3 full is not yet merged, `research-swarm` migration (Task 13) may need partial toolsets or a deferred `toolset: []` placeholder.

**Q5 — Scope-local store complexity:** If Task 9 proves complex, stub with run-level alias (Phase 2 behavior) and defer to Phase 3b. Tasks 7-8 (tool-calling loop) are independent and must not be blocked.

**Q6 — `lean_check` empty toolset:** Verify `lean-checker` preset before Task 14. If the preset cannot produce a valid signal without tool calls, add a `filesystem.*` or similar tool that can read the Lake build output from disk.
