# Node Runtimes — Phase 1 Implementation Spec

**Date:** 2026-04-11
**Status:** Approved for implementation
**Scope:** Full Phase 1 of the Node Runtimes design — backend refactoring, new `AgentBackend` interface, three new LLM backends, YAML `kind` field, DAG executor dispatch, and workflow migration
**Parent documents:** `docs/design/node-runtimes.md`, `HIGH_LEVEL_DESIGN.md`, `MANIFESTO.md`
**Prerequisite:** Tool Registry Phase 1+2 merged to main (commit `d594d94`) — `RegistryClient` module at `packages/server/src/modules/registry/` is the integration point for tool dispatch.

---

## 1. Context and Purpose

The Plurics Manifesto separates concerns: LLMs reason, registered tools compute. The Tool Registry Phase 1+2 delivered the tool execution half of that promise. Node Runtimes Phase 1 delivers the LLM execution half — a clean `AgentBackend` interface with three concrete implementations (`claude`, `openai-compat`, `ollama`), replacing the legacy terminal-oriented backends inherited from the CAAM origin.

The current agent backends at `packages/server/src/modules/agents/` expose a PTY-centric interface: `start/stop/inject/onOutput/isAlive`. This interface conflates process management (node-pty sessions, signal file watching) with LLM conversation semantics. The new design makes the separation explicit: reasoning nodes manage _conversations_ (start, send message, send tool results, close), not processes.

This spec also introduces the `kind` field to workflow YAML, replacing the implicit inference of node type from backend name. `kind: reasoning` means an LLM is invoked. `kind: tool` means the registry executes a registered tool directly with no LLM. This is the architectural declaration the manifesto requires.

This spec is implementation-facing: read it alongside `docs/design/node-runtimes.md`, not in place of it. Where this spec diverges from the design doc, this spec is the authoritative source for _what to build in Phase 1_.

## 2. In Scope

The following are built in this slice:

- New `AgentBackend` interface with `startConversation`, `sendMessage`, `sendToolResults`, `closeConversation` in `packages/server/src/modules/agents/agent-backend.ts` (replaces the current interface, which is renamed `LegacyAgentBackend`).
- New types file `packages/server/src/modules/agents/new-types.ts` for `ConversationHandle`, `ToolDefinition`, `UserMessage`, `AssistantMessage`, `ToolResult` — later merged into `agent-backend.ts`.
- Three new backend implementations:
  - `packages/server/src/modules/agents/claude-backend.ts` — Anthropic Messages API (direct + proxy modes)
  - `packages/server/src/modules/agents/openai-compat-backend.ts` — OpenAI-compatible Chat Completions
  - `packages/server/src/modules/agents/ollama-backend.ts` — Ollama native `/api/chat` with `think` support
- Update to `packages/server/src/modules/workflow/yaml-parser.ts`: `kind` field required on every node; valid values `reasoning` and `tool`; validation errors for missing or invalid values.
- Update to `packages/server/src/modules/workflow/dag-executor.ts`: dispatch on `kind` — `kind: tool` routes to `RegistryClient.invoke()`; `kind: reasoning` routes to the new `AgentBackend`; `kind: reasoning` + `backend: claude-code` remains on the legacy PTY path (Option A compat mode).
- Migration of all 5 workflow YAML files to add `kind: reasoning` or `kind: tool` on every node, with existing `backend: claude-code` etc. preserved.
- `agent-registry.ts` updated to instantiate new backend types alongside legacy ones.
- Unit tests per backend, YAML parser `kind` tests, DAG executor dispatch tests, workflow YAML parse smoke tests.

## 3. Out of Scope (Deferred)

These are explicitly not built in this slice. Each is tagged to its target phase.

- **Tool-calling loop** (NR Phase 3): `sendToolResults` throws `"not implemented in Phase 1"`. `toolDefinitions` is always empty. Reasoning nodes produce text-only LLM output with no registry tool calls.
- **Value store** (NR Phase 2): structured outputs from tool nodes are not stored or referenced across nodes. Tool node dispatch calls `RegistryClient.invoke()` but the result is handled naively (serialized to the signal file) rather than being placed in a value store scope.
- **Max turns enforcement, per-tool retry budget, corrective re-prompt** (NR Phase 3).
- **Removing `node-pty`, `claude-code-session.ts`, `process-session.ts`, `local-llm-session.ts`** (deferred to NR Phase 3 in Option A; see Section 5).
- **`toolset` resolution** (NR Phase 3): the `toolset` field is parsed and stored on the node definition but is not used to query the registry or generate tool definitions. It is a no-op in Phase 1.
- **Reasoning node signal parsing from LLM text** (NR Phase 3): the new backends return `AssistantMessage` objects containing the raw LLM text. The existing signal-parsing logic in `dag-executor.ts` continues to apply as it does today.
- **Upstream value references (`${node.outputs.port}`)** in tool node inputs (NR Phase 2).
- **Converter insertion on type mismatch** (Tool Registry Phase 4).

## 4. The Semantic Regression: Tool-Calling Capability Gap

### 4.1 What the Legacy Backends Provide

The current `claude-code` backend runs the `claude` CLI in a PTY terminal session. Inside that PTY, Claude Code has full access to Bash, Python, file I/O, and any other shell tool. This is not a controlled tool-calling loop — it is a general-purpose terminal. The five existing workflows exploit this extensively:

- **math-discovery**: profiler, conjecturer, critic, formalizer, strategist, counterexample, abstractor, synthesizer, backtest-designer nodes all use `backend: claude-code` and routinely call shell commands to read/write data files, run Python analysis, compute hashes, validate JSON.
- **research-swarm**: all 13 reasoning nodes use implicit `backend: claude-code` (defaulted) and follow the Signal Protocol which requires bash commands.
- **theorem-prover-mini**: conjecturer, formalizer, prover, reporter use `backend: claude-code`.
- **sequence-explorer**: profiler, conjecturer, formalizer, critic, selector, reporter use `backend: claude-code`.
- **smoke-test**: writer node uses `backend: claude-code`.

### 4.2 What Phase 1 New Backends Provide

The three new backends (`claude`, `openai-compat`, `ollama`) implement `sendMessage` as a single-turn or multi-turn plain LLM call. In Phase 1, `toolDefinitions` is always empty, so the LLM receives no tool call capability whatsoever. The LLM's response is pure text. The workflows' Signal Protocol (which requires `cat >`, `mv`, `sha256sum`, `python3 -c`) cannot execute through a pure text response.

**Consequence:** any workflow node migrated to the new backends will produce LLM text output that is not actionable. The DAG executor cannot execute Signal Protocol steps from LLM text alone. Those workflows will be non-functional for the new-backend path until NR Phase 3 adds the tool-calling loop.

### 4.3 Impact Summary

| Workflow | Nodes using claude-code | Functional after Phase 1 (new backends)? |
|---|---|---|
| math-discovery | 12 reasoning nodes | No — all depend on PTY shell access |
| research-swarm | 13 reasoning nodes | No — all depend on Signal Protocol bash |
| theorem-prover-mini | 4 reasoning nodes | No — prover requires Lean feedback loop |
| sequence-explorer | 6 reasoning nodes | No — requires file writes and bash |
| smoke-test | 1 reasoning node (writer) | No — writes signal via bash |

This is a complete capability regression for all five workflows on the new backend path. It is not a regression on the legacy path (compat mode, Option A), which is why Option A is chosen.

## 5. Option A vs Option B

### Option A: Keep Legacy Backend as Compat Mode

Legacy backends (`claude-code`, `process`, `local-llm` under `LegacyAgentBackend`) remain active. `kind: reasoning` + `backend: claude-code` continues to dispatch through the PTY path. `kind: reasoning` + `backend: claude | openai-compat | ollama` dispatches through the new interface. Tool nodes (`kind: tool`) dispatch through `RegistryClient.invoke()`.

The five workflow YAML files are migrated to add `kind: reasoning` on all LLM nodes and `kind: tool` where conceptually appropriate (in practice, all legacy computation nodes use `backend: process` which maps to a `kind: tool`-compatible path, but we preserve `kind: reasoning` + `backend: process` on the legacy route since the process backend is not yet RegistryClient-backed). New reasoning nodes written for Phase 1 onwards use `backend: claude | openai-compat | ollama` and work in degraded-but-structural mode until Phase 3.

**Pros:** No workflow breakage. The compat tag (`@deprecated`) communicates intent. The PTY layer removal is a clean, isolated task for NR Phase 3. Phase 1 delivers the interface and the new backends without disrupting running workflows.

**Cons:** The `node-pty` dependency and the legacy session files stay longer. The codebase has two parallel dispatch paths until Phase 3 cleans up.

### Option B: Remove Legacy Backend Unconditionally

Remove `claude-code-session.ts`, `local-llm-session.ts`, `process-session.ts` now. Migrate all five workflows to either tool nodes (for deterministic steps) or accept degraded text-only reasoning output. The Signal Protocol steps in existing presets would break immediately.

**Pros:** Clean, consistent with the design doc's literal instruction.

**Cons:** All five workflows are non-functional from Phase 1 through Phase 3 — a gap of ~2 weeks minimum. No way to run end-to-end tests. Breaks the project's ability to demo.

### Decision: Option A

**This spec adopts Option A.** The tool-calling regression is not a footnote — it breaks every workflow in the project. Keeping the legacy path alive behind a `@deprecated` tag costs nothing structurally and preserves operational continuity for the 2–3 week migration window until NR Phase 3 completes. The design doc's "remove PTY backend" instruction is honored by tagging the removal task explicitly in the rollout as deferred to NR Phase 3 rather than skipped.

The legacy removal task is tracked as: **NR Phase 3 Step 0 — remove `LegacyAgentBackend` and all three legacy session files once the tool-calling loop passes smoke tests on all five workflows.**

## 6. New `AgentBackend` Interface

### 6.1 Types (new-types.ts)

```typescript
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
```

### 6.2 New `AgentBackend` Interface

The old `AgentBackend` interface is renamed to `LegacyAgentBackend` in `agent-backend.ts`. The new interface takes the original name:

```typescript
export type NewBackendType = 'claude' | 'openai-compat' | 'ollama';

export interface AgentBackend {
  readonly backendType: NewBackendType;
  readonly id: string;

  /**
   * Start a new LLM conversation with the given system prompt and (in Phase 1,
   * empty) tool definitions. Returns a handle that must be passed to all
   * subsequent calls.
   */
  startConversation(params: {
    systemPrompt: string;
    toolDefinitions: ToolDefinition[];
    model: string;
    maxTokens?: number;
  }): Promise<ConversationHandle>;

  /**
   * Send a user message and receive the assistant's response.
   * In Phase 1 this is a single-turn HTTP call; the message history is
   * accumulated inside the ConversationHandle.
   */
  sendMessage(
    conversation: ConversationHandle,
    userMessage: UserMessage,
  ): Promise<AssistantMessage>;

  /**
   * Send tool results back and receive the next assistant response.
   * Phase 1: throws Error('sendToolResults: not implemented in Phase 1').
   * Phase 3: submits the tool results and continues the tool-calling loop.
   */
  sendToolResults(
    conversation: ConversationHandle,
    toolResults: ToolResult[],
  ): Promise<AssistantMessage>;

  /** Release any resources held by the conversation. */
  closeConversation(conversation: ConversationHandle): Promise<void>;
}
```

### 6.3 `ConversationHandle` Internal Shape

Each backend maintains an internal `conversations: Map<string, ConversationState>` keyed by `conversationId`. The `ConversationState` holds the accumulated message history so that `sendMessage` appends to the history rather than starting fresh. This is how multi-turn conversations are supported even though the HTTP API is stateless.

```typescript
interface ConversationState {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  messages: BackendMessage[];  // backend-specific message format
}
```

`startConversation` creates an entry and returns `{ conversationId: uuid() }`. `closeConversation` deletes the entry. Memory is bounded: the caller (DAG executor) closes every conversation after the node completes.

## 7. Per-Backend Specification

### 7.1 `claude` Backend (`claude-backend.ts`)

**Config:**

```typescript
export interface ClaudeBackendConfig {
  baseUrl: string;        // 'https://api.anthropic.com' (direct) or 'http://localhost:3456' (proxy)
  apiKey: string;         // Bearer token; ignored by proxy mode but required in config
  model: string;          // e.g. 'claude-sonnet-4-6', 'claude-opus-4-6'
  maxTokens?: number;     // default 4096
}
```

**Authentication:**

Both direct API and proxy (claude-max-api-proxy) use the same `Authorization: Bearer <apiKey>` header. The proxy at `localhost:3456` accepts this header and handles OAuth forwarding transparently. The backend code does not distinguish between the two — it sends the same request to whichever `baseUrl` is configured.

**Endpoint:** `POST {baseUrl}/v1/messages`

**Request shape (Phase 1, no tools):**

```typescript
{
  model: config.model,
  max_tokens: params.maxTokens ?? config.maxTokens ?? 4096,
  system: systemPrompt,
  messages: [
    { role: 'user', content: userMessage.content },
    // ... accumulated history for multi-turn
  ]
}
```

**Response parsing:** Extract `content[0].text` (type `text`) as `AssistantMessage.content`. `stopReason` from response `stop_reason`. `toolCalls` is always `[]` in Phase 1 (tool_use blocks are not generated when `tools` is absent from the request).

**Error handling:** HTTP non-2xx responses deserialize the Anthropic error envelope `{ type, error: { type, message } }` and throw `BackendError` with `category: 'backend_error'` and the message. Rate limit (429) and overload (529) errors should be thrown as `BackendError` with `category: 'rate_limit'` so the DAG executor can decide on retry policy.

**HTTP client:** `fetch` (Node.js 18+ built-in). No Anthropic SDK dependency. This keeps the backend dependency footprint minimal.

**Multi-turn:** The `ConversationState.messages` array accumulates alternating user/assistant message objects in the Anthropic format. `sendMessage` appends a user turn, calls the API, appends the assistant turn to the accumulated history, returns `AssistantMessage`.

**Additional required headers:**

```
anthropic-version: 2023-06-01
content-type: application/json
```

**Phase 1 limitation note:** `sendToolResults` throws immediately with `new Error('sendToolResults: not implemented in Phase 1 — tool-calling loop requires NR Phase 3')`.

### 7.2 `openai-compat` Backend (`openai-compat-backend.ts`)

**Config:**

```typescript
export interface OpenAICompatBackendConfig {
  baseUrl: string;        // e.g. 'http://localhost:8000', 'https://api.openai.com'
  apiKey?: string;        // required for OpenAI direct; optional for local servers
  model: string;          // e.g. 'gpt-4o', 'Goedel-LM/Goedel-Prover-V2-8B', 'Qwen/Qwen2.5-72B'
  maxTokens?: number;     // default 4096
}
```

**Endpoint:** `POST {baseUrl}/v1/chat/completions`

**Request shape (Phase 1, no tools):**

```typescript
{
  model: config.model,
  max_tokens: params.maxTokens ?? config.maxTokens ?? 4096,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage.content },
    // ... accumulated history
  ]
}
```

**Headers:**

```
content-type: application/json
authorization: Bearer <apiKey>   // omitted if apiKey is undefined
```

**Response parsing:** `choices[0].message.content` as `AssistantMessage.content`. `choices[0].finish_reason` as `stopReason`. `toolCalls` always `[]` in Phase 1.

**Multi-turn:** Same accumulated history pattern as claude backend. Messages alternate `user` / `assistant` roles after the initial `system` message. System message is injected once at conversation start; subsequent `sendMessage` calls append only `user` + `assistant` pairs.

**Error handling:** HTTP non-2xx responses deserialize `{ error: { message, type, code } }` and throw `BackendError`. 401 → `category: 'auth_error'`. 429 → `category: 'rate_limit'`. 5xx → `category: 'backend_error'`.

**Scope:** Covers vLLM (preferred for Phase 1 prover nodes), llama.cpp server, LM Studio, direct OpenAI GPT API. Model-specific quirks (function call format variations) are out of scope for Phase 1 since tool calling is Phase 3.

### 7.3 `ollama` Backend (`ollama-backend.ts`)

**Config:**

```typescript
export interface OllamaBackendConfig {
  baseUrl: string;        // default 'http://localhost:11434'
  model: string;          // e.g. 'qwen3.5:35b', 'hf.co/mradermacher/Goedel-Prover-V2-32B-GGUF:Q4_K_M'
  disableThinking?: boolean;  // sets think: false in request (default false)
  maxTokens?: number;     // maps to options.num_predict; default 4096
}
```

**Endpoint:** `POST {baseUrl}/api/chat`

**Request shape (Phase 1):**

```typescript
{
  model: config.model,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage.content },
    // ... accumulated history
  ],
  stream: false,
  ...(config.disableThinking ? { think: false } : {}),
  options: {
    num_predict: params.maxTokens ?? config.maxTokens ?? 4096,
  }
}
```

**Response parsing:** `message.content` as `AssistantMessage.content`. `done_reason` as `stopReason`. `toolCalls` always `[]` in Phase 1 (Ollama returns `tool_calls` in `message.tool_calls` when tools are sent; since we send no tools, this field is absent).

**`think: false` rationale:** Qwen 2.5 (reasoning variant) and DeepSeek-R1 produce reasoning content before their final answer by default. Without `think: false`, these models can exhaust their token budget on internal reasoning prose. The Ollama OpenAI-compatible endpoint (`/v1/chat/completions`) does not pass `think` to the underlying model; only the native `/api/chat` does. This is why `ollama` is a separate backend rather than a special case of `openai-compat`.

**`<think>` tag filtering:** Some Ollama models embed `<think>...</think>` blocks in their `message.content` even when `think: false` is set. The backend strips these tags from `AssistantMessage.content` before returning, preserving only the text outside the think tags. This keeps the signal parsing layer clean.

**Multi-turn:** Same accumulated history pattern. Ollama `/api/chat` accepts `messages` arrays in OpenAI format; system + alternating user/assistant.

**Error handling:** HTTP non-2xx responses use the Ollama error format `{ error: string }`. Wrapped into `BackendError` with category `backend_error`. Connection refused (network error) wrapped as `BackendError` with `category: 'backend_unavailable'` and the original `cause` attached.

## 8. YAML Parser Changes

### 8.1 New `kind` Field

`packages/server/src/modules/workflow/yaml-parser.ts` is updated to:

1. **Require `kind` on every node.** If `kind` is absent, throw `WorkflowParseError` with message `"Node '{name}': missing required field 'kind'"`.
2. **Validate `kind` value.** Accepted values are `'reasoning'` and `'tool'`. Any other value throws `WorkflowParseError` with message `"Node '{name}': invalid kind '{value}', expected 'reasoning' or 'tool'"`.
3. **Parse `toolset` on reasoning nodes.** If `kind: reasoning`, parse the optional `toolset` array (if present) into a `ToolsetEntry[]` type and store it on the `DagNode`. In Phase 1 this field is not used at runtime — it is parsed and stored only. An invalid `toolset` entry (e.g., an object with neither `name` nor `category`) throws a parse error.
4. **Validate `tool` field on tool nodes.** If `kind: tool`, the `tool` field (the registry tool reference) is required. Missing `tool` on a tool node throws `WorkflowParseError`.

### 8.2 Updated `DagNode` Type

In `packages/server/src/modules/workflow/types.ts`, `DagNode` gains:

```typescript
kind: 'reasoning' | 'tool';

// Present on kind: reasoning nodes
toolset?: ToolsetEntry[];

// Present on kind: tool nodes
tool?: string;               // e.g. 'pandas.load_csv'
toolInputs?: Record<string, unknown>;
```

The existing `backend`, `model`, `endpoint`, `provider`, `disableThinking`, `maxTokens`, `command`, `workingDir` fields remain on `DagNode` for backward compatibility during the migration window.

### 8.3 `ToolsetEntry` Type

```typescript
export type ToolsetEntry =
  | { name: string }        // exact tool name match
  | { category: string }    // all tools in category
  | { glob: string };       // glob pattern (Phase 3 only; parse but ignore in Phase 1)
```

## 9. DAG Executor Dispatch Changes

### 9.1 Dispatch Logic

In `dag-executor.ts`, the node dispatch function (currently around line 658 where backend type is read) is updated to a three-way branch on `kind`:

```
kind: tool
  → RegistryClient.invoke(toolName, toolInputs)
  → convert InvocationResult to AgentResult / signal
  (no LLM involved)

kind: reasoning + backend: claude | openai-compat | ollama
  → new AgentBackend path
  → startConversation(systemPrompt, [], model, maxTokens)
  → sendMessage(handle, { content: purpose })
  → AssistantMessage.content treated as the node's raw output
  → close conversation
  (plain text output, no tool calls)

kind: reasoning + backend: claude-code
  → existing legacy PTY path (unchanged, @deprecated)

kind: reasoning + backend: process
  → existing legacy process path (unchanged, @deprecated)

kind: reasoning + backend: local-llm
  → existing legacy HTTP path (unchanged, @deprecated)
  Note: in Phase 1, 'local-llm' workflows still route through LegacyAgentBackend.
  The ollama / openai-compat backends are new opt-in paths.
```

### 9.2 Tool Node Result Handling

When `RegistryClient.invoke()` returns an `InvocationResult`:

- On `success: true`: extract `outputs` and serialize them to a JSON file in the run directory. Write a signal file with `status: 'success'` and the output data inline (no value store in Phase 1).
- On `success: false`: map the `InvocationResult.category` to a node failure. Write a signal with `status: 'failure'` and `error.category` + `error.message`.

The `RegistryClient` singleton is imported from `app.ts` where it is already initialized. The executor accesses it through a module-level import or via a constructor parameter (preferred — passed into `DagExecutor` constructor alongside the existing `registry` and `bootstrap` dependencies).

### 9.3 Reasoning Node (New Backend) Result Handling

The `AssistantMessage.content` string returned by `sendMessage` is the node's raw output. For Phase 1, the existing signal-parsing logic in `dag-executor.ts` (which already processes raw text from agent output) is applied unchanged. The only difference is the origin of that text: previously it was streamed from a PTY; now it is returned synchronously from an HTTP response.

This means: reasoning nodes using `backend: claude | openai-compat | ollama` will attempt to parse a Signal Protocol JSON block from the LLM's text output. If the LLM (without tool access) cannot write files or compute hashes, the signal block will be absent or invalid, and the node will fail. This is expected and documented — it is the capability regression described in Section 4.

## 10. Workflow Migration Plan

All five workflow YAML files receive a mechanical annotation pass. The rule is simple:

- Nodes with `backend: claude-code`, `backend: local-llm`, or no explicit backend → add `kind: reasoning`
- Nodes with `backend: process` → add `kind: reasoning` (Note: conceptually these are tool nodes, but they are not registered in the Tool Registry and cannot be dispatched via `RegistryClient.invoke()`. They use the legacy `process` session. The correct migration is `kind: tool` + registry registration, which is deferred to a future tool onboarding pass. For Phase 1, `kind: reasoning` + `backend: process` is the safe choice to preserve existing behavior.)

No existing YAML fields are removed. No backends are changed. This is a purely additive annotation.

### math-discovery

14 nodes: `ohlc_fetch`, `profiler`, `conjecturer`, `critic`, `selector`, `formalizer`, `strategist`, `prover`, `counterexample`, `abstractor`, `synthesizer`, `backtest_designer`, `backtester`.

- `ohlc_fetch` (`backend: process`): `kind: reasoning`
- `backtester` (`backend: process`): `kind: reasoning`
- `prover` (`backend: local-llm`): `kind: reasoning`
- All others (`backend: claude-code`): `kind: reasoning`

### research-swarm

13 nodes: all implicit `backend: claude-code` (no `backend` field set, defaults to `claude-code` in the executor).

All get `kind: reasoning`.

### theorem-prover-mini

5 nodes: `conjecturer`, `formalizer`, `prover`, `lean_check`, `reporter`.

- `lean_check` (`backend: process`): `kind: reasoning`
- All others (`backend: claude-code`): `kind: reasoning`

### sequence-explorer

10 nodes: `sequence_fetch`, `profiler`, `conjecturer`, `formalizer`, `quick_filter`, `verifier`, `cross_checker`, `critic`, `selector`, `reporter`.

- `sequence_fetch` (`backend: process`): `kind: reasoning`
- `verifier` (`backend: process`): `kind: reasoning`
- `cross_checker` (`backend: process`): `kind: reasoning`
- `quick_filter` (`backend: local-llm`, `provider: ollama`): `kind: reasoning`
- All others (`backend: claude-code`): `kind: reasoning`

### smoke-test

3 nodes: `echo_node`, `writer`, `reviewer`.

- `echo_node` (`backend: process`): `kind: reasoning`
- `writer` (`backend: claude-code`): `kind: reasoning`
- `reviewer` (`backend: local-llm`, `provider: ollama`): `kind: reasoning`

### Note on `kind: tool` absence

None of the 5 workflows currently have a node that should be `kind: tool` in Phase 1, because all computation nodes use `backend: process` which calls arbitrary scripts — not named entries in the Tool Registry. The `kind: tool` path in the executor exists and is tested, but no existing workflow exercises it yet. New workflows written after NR Phase 1 can use `kind: tool` + `tool: {registry_name}` from day one.

## 11. Agent Registry Update

`packages/server/src/modules/agents/agent-registry.ts` is updated to:

1. Accept a `backendConfig` union that covers both `LegacyAgentConfig` (existing) and the new per-backend config types.
2. Expose a `createBackend(kind: NewBackendType, config: BackendConfig): AgentBackend` factory function that instantiates the correct new backend class.
3. The existing `createAgent(config: AgentConfig): LegacyAgentBackend` path remains unchanged for the legacy dispatch route.

The DAG executor, which currently calls `this.registry.createAgent(agentConfig)` for all nodes, is updated to call `createBackend` for nodes whose `backend` value is `claude | openai-compat | ollama`, and `createAgent` for the rest.

## 12. Test Plan

### 12.1 Backend Unit Tests

Each backend has a `__tests__/{backend}-backend.test.ts` using Vitest with `global.fetch` mocked via `vi.fn()`.

**claude-backend.test.ts:**
- `startConversation` stores state; `sendMessage` sends correct headers and body.
- Multi-turn: second `sendMessage` accumulates both turns in the request body.
- HTTP 401 → `BackendError` with `category: 'auth_error'`.
- HTTP 429 → `BackendError` with `category: 'rate_limit'`.
- `sendToolResults` → throws "not implemented in Phase 1".
- `closeConversation` removes state; subsequent `sendMessage` on closed handle throws.

**openai-compat-backend.test.ts:**
- `sendMessage` with no `apiKey` config → `Authorization` header absent.
- `sendMessage` with `apiKey` → correct Bearer header.
- Response with `choices[0].finish_reason: 'stop'` → `stopReason: 'stop'`.
- HTTP 500 → `BackendError`.
- Multi-turn history accumulates correctly (system message only once).

**ollama-backend.test.ts:**
- `disableThinking: true` → `think: false` in request body.
- `disableThinking: false` (default) → no `think` field in request body.
- Response content with `<think>...</think>` block → stripped from `AssistantMessage.content`.
- Network error (fetch throws) → `BackendError` with `category: 'backend_unavailable'`.
- `options.num_predict` set to `maxTokens`.

### 12.2 YAML Parser Tests

In `yaml-parser.test.ts` (new or existing):

- Node with `kind: reasoning` → parses without error.
- Node with `kind: tool` + `tool: 'test.echo_int'` → parses without error.
- Node with missing `kind` → `WorkflowParseError` containing "missing required field 'kind'".
- Node with `kind: agent` (invalid) → `WorkflowParseError` containing "invalid kind".
- Node with `kind: tool` but no `tool` field → `WorkflowParseError` containing "tool field required".
- Node with `kind: reasoning` + valid `toolset` → toolset parsed and stored.
- Node with `kind: reasoning` + invalid `toolset` entry → `WorkflowParseError`.

### 12.3 DAG Executor Dispatch Tests

In `dag-executor.test.ts` (unit, with `RegistryClient` and `AgentBackend` mocked):

- `kind: tool` node → `RegistryClient.invoke()` called with correct tool name and inputs; no `AgentBackend` instantiated.
- `kind: reasoning` + `backend: claude` → new `AgentBackend.sendMessage()` called; `RegistryClient.invoke()` not called.
- `kind: reasoning` + `backend: claude-code` → legacy PTY path invoked (mock confirms `LegacyAgentBackend.start()` called).
- `kind: tool` invocation result with `success: false` → node signal written as failure.

### 12.4 Workflow YAML Smoke Tests

In `workflow-migration.test.ts`:

- Parse all 5 workflow YAML files after migration.
- Assert all nodes have a valid `kind` field.
- Assert no `WorkflowParseError` is thrown.
- Assert the total node count per workflow matches expectations (regression guard).

Expected counts: math-discovery=14, research-swarm=13, theorem-prover-mini=5, sequence-explorer=10, smoke-test=3.

### 12.5 Integration Note

Full end-to-end integration tests with live LLM calls are not part of this slice. The smoke test in `test-data/run-smoke.js` remains the integration gate. It uses `backend: claude-code` (legacy path, unchanged) so it continues to pass after Phase 1.

## 13. Rollout Steps

Fifteen incremental, committable steps. Each has green tests before the next begins.

1. **New types file.** Create `packages/server/src/modules/agents/new-types.ts` with `ConversationHandle`, `ToolDefinition`, `UserMessage`, `AssistantMessage`, `ToolCall`, `ToolResult`, `BackendError`. No runtime code. Test: TypeScript compilation succeeds.

2. **Rename `AgentBackend` to `LegacyAgentBackend`.** In `agent-backend.ts`, rename the interface. Add `@deprecated` JSDoc comment. Update all imports in `claude-code-session.ts`, `local-llm-session.ts`, `process-session.ts`, `agent-registry.ts`, `dag-executor.ts`. Test: TypeScript compilation succeeds; no behavior change.

3. **New `AgentBackend` interface.** Add the new `AgentBackend` interface to `agent-backend.ts` using the types from Step 1. Test: TypeScript compilation succeeds.

4. **`claude-backend.ts`.** Implement `ClaudeBackend` class implementing `AgentBackend`. Mock `fetch` tests: single-turn, multi-turn, 401 error, 429 error, `sendToolResults` throws. Test: `claude-backend.test.ts` all pass.

5. **`openai-compat-backend.ts`.** Implement `OpenAICompatBackend`. Tests: no-key header absent, Bearer header present, 500 error, multi-turn accumulation. Test: `openai-compat-backend.test.ts` all pass.

6. **`ollama-backend.ts`.** Implement `OllamaBackend`. Tests: `think: false` flag, `<think>` stripping, network error wrapping. Test: `ollama-backend.test.ts` all pass.

7. **YAML parser `kind` field.** Update `yaml-parser.ts` and `types.ts` with `kind`, `toolset`, `tool`, `toolInputs`. Tests: all YAML parser `kind` unit tests pass.

8. **DAG executor dispatch.** Update `dag-executor.ts` dispatch branch. Wire `RegistryClient` through constructor. Tests: dispatch unit tests pass.

9. **Agent registry factory.** Update `agent-registry.ts` with `createBackend()` factory. TypeScript compilation succeeds.

10. **Migrate `math-discovery/workflow.yaml`.** Add `kind: reasoning` to all 14 nodes. Test: workflow parse smoke test passes.

11. **Migrate `research-swarm/workflow.yaml`.** Add `kind: reasoning` to all 13 nodes. Test: workflow parse smoke test passes.

12. **Migrate `theorem-prover-mini/workflow.yaml`.** Add `kind: reasoning` to all 5 nodes. Test: workflow parse smoke test passes.

13. **Migrate `sequence-explorer/workflow.yaml`.** Add `kind: reasoning` to all 10 nodes. Test: workflow parse smoke test passes.

14. **Migrate `smoke-test/workflow.yaml`.** Add `kind: reasoning` to all 3 nodes. Test: workflow parse smoke test passes; `run-smoke.js` still executes (exercises the legacy PTY path only, which is unchanged).

15. **Full module sweep.** Run `tsc --noEmit` on the server package. Fix any remaining type errors from the `LegacyAgentBackend` rename or new interface introduction. Confirm all unit tests pass. Run `run-smoke.js` as integration gate.

**Estimated effort:** ~1 week. Steps 1–3: 2 hours (types + rename). Steps 4–6: 2 days (backends + tests). Steps 7–9: 1 day (parser + executor + registry). Steps 10–14: 1 hour (mechanical YAML edits). Step 15: half a day (type sweep + smoke).

## 14. Open Questions Deferred

These are not blockers for this slice but should be revisited before NR Phase 3.

- **System prompt construction for new backends.** In Phase 1, `startConversation` receives the `systemPrompt` parameter from the DAG executor, which currently constructs it from the purpose template. The purpose template is designed for Claude Code (includes tool invocation instructions, Signal Protocol bash commands). For the new backends in Phase 3, the system prompt will need to describe the registered toolset and the `signal` JSON block convention. The template system will need to be backend-aware. No change needed in Phase 1 since the new backends are not used by live workflows.

- **Proxy authentication for `claude` backend.** The `claude-max-api-proxy` OAuth flow requires the user to have run `claude auth login` and have a valid token in `~/.claude/config`. The `claude` backend in Phase 1 accepts an `apiKey` in config; the proxy mode is documented but not auto-detected. Should the backend support a `mode: 'proxy'` shorthand that sets `baseUrl` to `localhost:3456` and discovers the token from the auth config? Deferred — direct API key is sufficient for Phase 1.

- **Conversation memory limit.** The `ConversationState.messages` array grows unboundedly during a reasoning node's execution. For Phase 1 this is not a problem because nodes are short-lived and Phase 1 is single-turn. Phase 3 will need a context window budget that truncates or summarizes history before the LLM's context limit is hit.

- **Fetch timeout.** The `fetch` call in the backends has no timeout configured. For Phase 1, LLM responses are expected within a few seconds to a few minutes. For Phase 3, the wall clock timeout at the node level (enforced by the DAG executor) will need to cancel the in-flight fetch via `AbortController`. Add a `timeoutMs` config field and wire `AbortSignal` in Phase 3.

- **Retry on transient backend errors.** Phase 1 backends throw immediately on 5xx errors. Phase 3 should add exponential backoff with jitter for `backend_error` and `rate_limit` categories. No retry logic in Phase 1.

- **`local-llm` backend migration.** The legacy `local-llm` backend with `provider: openai` maps to `openai-compat`; with `provider: ollama` maps to `ollama`. The YAML field names differ (`endpoint` vs `baseUrl`, `disable_thinking` vs `disableThinking`). A YAML compatibility shim should be added in the parser to translate old fields to new ones, or a migration pass should update the workflow YAML files. Deferred to NR Phase 3 since the legacy path continues to work until then.

## 15. Relationship to Subsequent Phases

### NR Phase 2 — Value Store

The value store is not built in Phase 1. Tool node dispatch (`kind: tool` → `RegistryClient.invoke()`) is wired, but the outputs are serialized naively to the signal file without going through a store. Phase 2 introduces the in-memory scope, `value_ref` handles, and the `runs/{runId}/values/` persistence layer. No interface changes in Phase 1 are expected to conflict with Phase 2 — the `InvocationResult.outputs` shape is consumed opaquely in Phase 1 and re-consumed with richer logic in Phase 2.

### NR Phase 3 — Tool-Calling Loop

Phase 3 activates `sendToolResults`, populates `toolDefinitions` from the `toolset` field, and implements the turn loop in the DAG executor. Phase 3 also removes the legacy PTY backend (`claude-code-session.ts`) after verifying all workflows pass on the new path. The `LegacyAgentBackend` rename and `@deprecated` tag introduced in Phase 1 make this removal a clean, low-risk operation. The `sendToolResults` "not implemented" stub in Phase 1 becomes the real implementation in Phase 3.

### Tool Registry Phase 3 — Seed Tools

The tool node dispatch wired in Phase 1 (`kind: tool` → `RegistryClient.invoke()`) is the integration point. When the 66 seed tools are registered in Tool Registry Phase 3, existing workflows can be updated to use `kind: tool` nodes for their deterministic computation steps (data loading, verification, etc.) without any changes to the executor. The wiring is already present.

### Tool Registry Phase 4 — Converter Insertion

Phase 1 tool node dispatch passes inputs as-is. If an input type does not match the declared port schema, `RegistryClient.invoke()` returns a `validation` error and the node fails. Phase 4 inserts converter chains automatically at the invocation layer; the executor does not need to change.

---

*Approved for implementation on 2026-04-11. Next step: hand off to the writing-plans skill to produce a step-by-step implementation plan from Section 13.*
