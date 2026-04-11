# Node Runtimes — Phase 2 Implementation Spec

**Date:** 2026-04-11
**Status:** Approved for implementation
**Scope:** The Value Store — in-memory structured-value store, handle generation, schema summarizers, handle resolution in tool node dispatch, run-level persistence
**Parent documents:** `docs/design/node-runtimes.md` §5, `HIGH_LEVEL_DESIGN.md`, `MANIFESTO.md`
**Prerequisites:** Tool Registry Phase 1+2 merged (commit `d594d94`), Tool Registry Phase 3 pilot merged (10 seed tools loaded), Node Runtimes Phase 1 merged — `AgentBackend` interface, `kind` field in YAML, DAG executor dispatch on `kind`.

---

## 1. Context and Purpose

Node Runtimes Phase 1 established the architectural division between reasoning nodes (LLM backends) and tool nodes (direct registry dispatch). It left a known gap: tool nodes whose outputs carry structured Python values (`DataFrame`, `NumpyArray`) produce opaque pickle envelopes that have nowhere to live between nodes, and the four seed tools that accept such values as inputs are rejected at `encodeInputs` with `"pickle input schemas not supported in phase 1+2"`.

This spec closes that gap by introducing the **Value Store** — the in-memory, per-run object store described in `docs/design/node-runtimes.md` §5. The value store gives every structured tool output a stable string handle, keeps the actual pickle envelope in memory on the Node server, and resolves handles back into envelopes when downstream tool nodes need them as inputs. It also adds **schema summarizers** so that when a structured value is returned to the workflow (or eventually to an LLM in Phase 3), a compact informative JSON summary accompanies the handle instead of raw opaque bytes.

At the end of this slice:

- Tool node A can produce a `DataFrame` output; the handle `vs-...` is stored in the run-level value store and written into A's signal.
- Tool node B can declare `inputs: { df: "${A.outputs.df}" }`; the DAG executor resolves the handle, locates the envelope in the value store, and forwards it inline to the Python subprocess — the runner receives a real DataFrame, not a handle string.
- The `encodeInputs` rejection for pickle schemas is lifted for handle-typed inputs.
- Every `DataFrame` and `NumpyArray` envelope is accompanied by a pre-computed summary (`shape`, `dtype`, `columns`, `head`, `stats`) stored alongside the envelope in the value store. This summary is surfaced in signals and logs; it will be the LLM's view of the value in Phase 3.

This spec is implementation-facing: read it alongside `docs/design/node-runtimes.md` §5, not in place of it. Where this spec diverges from the design doc, this spec is the authoritative source for what to build in Phase 2.

## 2. In Scope

The following are built in this slice:

- `packages/server/src/modules/registry/execution/value-store.ts` — `ValueStore` class with scope-local and run-level tiers, handle generation, envelope storage, summary storage, handle resolution.
- Extension to `packages/server/src/modules/registry/types.ts` — `ValueRef`, `ValueEnvelope`, `ValueSummary`, `StoredValue` types.
- Extension to `packages/server/src/modules/registry/schemas/builtin.ts` — `summarizer` field on `SchemaDef` for `NumpyArray` and `DataFrame`; summarizer implementation as a TypeScript function that parses a pre-computed summary payload from the runner output.
- Extension to `packages/server/src/modules/registry/schemas/schema-registry.ts` — `getSummarizer(schemaName)` method.
- Extension to `packages/server/src/modules/registry/execution/encoding.ts`:
  - `encodeInputs`: lift the blanket rejection for `pickle_b64` schemas; instead, if the input value is a `ValueRef` (`{_type: "value_ref", _handle: "vs-..."}`) look it up in the value store and forward the envelope inline. If the input is a raw JS value for a `pickle_b64` schema (not a handle), keep rejecting with `"raw pickle inputs not supported — use a value handle"`.
  - `decodeOutputs`: when decoding a `pickle_b64` output, extract the optional `_summary` field emitted by the runner, register the envelope + summary in the value store under a new handle, and return a `ValueRef` (not the raw envelope) to the caller.
- Extension to `packages/server/src/modules/registry/execution/executor.ts` — `invoke()` now accepts an optional `valueStore` parameter and threads it through `encodeInputs`/`decodeOutputs`. If omitted, behavior is unchanged (backward compatible for callers that do not use the value store).
- Extension to `packages/server/src/modules/workflow/dag-executor.ts`:
  - Instantiate a single `ValueStore` per workflow run.
  - Pass the `ValueStore` instance to every `RegistryClient.invoke()` call made for `kind: tool` nodes.
  - When resolving `${upstream.outputs.port}` references in tool node inputs: if the upstream signal carries a `value_ref`, convert it to a `{_type: "value_ref", _handle: "..."}` object before passing to `invoke()`.
  - After a tool node completes, write the `value_ref` handles (not envelopes) into the node's signal file. Write the summary alongside the handle so logs and the UI can display it without re-reading the pickle.
- Run-level persistence: after each successful tool-node invocation, serialize each new handle's envelope to `runs/{runId}/values/{handle}.pkl.b64` using the same pickle-base64 encoding already in use. On server restart or workflow resume, `ValueStore.loadRunLevel(runId)` reads these files back into the in-memory map. Only envelopes are persisted to disk; summaries are recomputed from the envelope at load time if absent (lazy recomputation is acceptable; persisting the summary JSON as a sidecar `.summary.json` is the preferred path).
- Runner protocol extension: the runner's output envelope gains an optional `_summary` field on `pickle_b64` outputs. The runner computes this summary using a small inline Python helper (`_make_summary(schema, value)` inside `runner.py`) that produces a dict with `shape`, `dtype`, `columns` (DataFrame), `head` (first 5 rows as list-of-dicts), `stats` (describe() as dict). The runner does not generate handles — handle generation is the TypeScript side's responsibility.
- Unit and integration tests as detailed in Section 11.
- `ValueStore` instantiation in `packages/server/src/app.ts` is not needed at the module level; it is created per-run by the DAG executor. No global singleton.

## 3. Out of Scope (Deferred)

- **Tool-calling loop in reasoning nodes** (NR Phase 3): reasoning nodes do not invoke tools in Phase 2. The value store scope for reasoning nodes exists in the design doc but is stubbed — the scope-local tier is created but is equivalent to the run-level tier in Phase 2 (no distinction is made between scope-local and run-level within a single reasoning node).
- **Converter-based type coercion for mismatched schemas** (Tool Registry Phase 4): if a downstream tool expects `Float` but gets a `ValueRef` whose schema is `NumpyArray`, that is a type mismatch and fails with `type_mismatch`. No converter lookup.
- **Multi-user handle signing and cryptographic tokens** (future multi-user mode).
- **Cross-run value sharing**: handles are scoped to a single run. A handle from run A cannot be resolved in run B.
- **Symbolic schema support** (SymPy `SymbolicExpr`): deferred to Tool Registry Phase 3 full.
- **Run-level store cleanup and retention policy** (7-day default per design doc): Phase 2 creates values; cleanup is deferred.
- **UI display of value summaries** in the WorkflowPanel: the summary is written to the signal file and is available to the UI, but no new UI components are added in this slice.
- **Converter-inferred summaries**: if the Python environment cannot produce a summary (e.g., numpy not installed), the summary is omitted silently; the handle still works.

## 4. Design Decision Resolutions

**A — Value store location: option (a1), in-process JS store.**
The value store is a JavaScript object on the Node server that holds opaque pickle envelopes. Handles are strings. When a downstream tool node resolves a handle, the TypeScript executor looks up the envelope in the in-memory map and forwards it inline to the Python subprocess as a `value_refs` map in the runner envelope. No separate process, no disk round-trip at resolution time. This matches the design doc's description, is the simplest correct implementation, and avoids inter-process coordination overhead.

**B — Scope isolation: run-level equals scope-local in Phase 2.**
Tool nodes (no LLM in the loop) write directly to the run-level store. Reasoning nodes receive a scope-local map that in Phase 2 is aliased to the run-level store — the distinction is plumbed in the type system but has no behavioral difference until Phase 3 adds the tool-calling loop. This keeps Phase 2 minimal without closing off Phase 3.

**C — Summarizers: TypeScript functions receiving a runner-computed payload.**
Each built-in structured schema declares a `summarizer: (payload: unknown) => ValueSummary` function in `schemas/builtin.ts`. The runner computes a small dict (shape, dtype, columns, head, stats) and emits it as `_summary` on pickle outputs. The TypeScript summarizer receives this dict and validates/reshapes it into the canonical `ValueSummary` type. No Python summarizer code lives on the TypeScript side — the Python side does the extraction, TypeScript does the typing. This keeps the runner the single source of Python introspection and keeps TypeScript free of pickle parsing.

**D — Runner protocol: minimal, stateless; handles generated in TypeScript.**
The runner outputs `{ok, outputs}` where each `pickle_b64` output entry gains an optional `_summary` field. The runner does NOT generate handles. TypeScript generates handles (`vs-{timestamp}-{nodeName}-{portName}-{shortHash}`), stores the envelope, and returns a `ValueRef` to the caller. The `value_refs` map (handle → envelope) is passed alongside inputs in the runner envelope so the runner can resolve incoming handles inline without a round-trip or a separate process. This keeps the runner fully stateless and the protocol minimal.

**E — Reasoning node value store scope: stubbed as run-level alias in Phase 2.**
Reasoning nodes do not invoke tools in Phase 2. The `ValueStore` is created per run by the DAG executor. Reasoning node scope creation/destruction is stubbed as a no-op that returns the run-level store. This unblocks Phase 3 without requiring placeholder implementations.

**F — File layout: extend existing execution/ and schemas/ modules; add value-store.ts.**
New file `execution/value-store.ts`. Extended `execution/encoding.ts` and `execution/executor.ts`. Extended `schemas/builtin.ts` and `schemas/schema-registry.ts`. New types in `types.ts`. Tests in `execution/__tests__/`. No new top-level directories.

## 5. Architecture and Module Changes

```
packages/server/src/modules/registry/
├── types.ts                         # + ValueRef, ValueEnvelope, ValueSummary, StoredValue
├── schemas/
│   ├── builtin.ts                   # + summarizer field on NumpyArray, DataFrame SchemaDef
│   └── schema-registry.ts          # + getSummarizer(name): Summarizer | null
├── execution/
│   ├── value-store.ts               # NEW — ValueStore class
│   ├── encoding.ts                  # extend encodeInputs, decodeOutputs
│   └── executor.ts                  # + optional valueStore: ValueStore param on invoke()

packages/server/src/modules/workflow/
└── dag-executor.ts                  # + ValueStore instantiation per run, handle threading

packages/server/src/modules/registry/python/
└── runner.py                        # + _make_summary() helper, _summary in pickle outputs
```

**Dependency boundaries (unchanged from Phase 1+2):**

- `execution/value-store.ts` depends on `types.ts` only. No dependency on `schemas/` or `storage/`. The value store is schema-agnostic — it holds envelopes by handle regardless of their schema.
- `execution/encoding.ts` gains a soft dependency on `value-store.ts` (receives a `ValueStore | null` parameter; null means no handle resolution available, which restores Phase 1+2 behavior for callers that opt out).
- `execution/executor.ts` remains the only internal caller of `encoding.ts`. It threads the `ValueStore` through.
- `dag-executor.ts` creates `ValueStore` instances and passes them to `RegistryClient.invoke()`. The DAG executor is the only component that has the full run context needed to instantiate a store.
- `schemas/` has no dependency on `execution/`. The `summarizer` field is a pure function `(payload: unknown) => ValueSummary | null`.

## 6. New Types

```typescript
// types.ts additions

/** An opaque reference to a value in the value store. */
export interface ValueRef {
  _type: 'value_ref';
  _handle: string;        // "vs-{timestamp}-{nodeName}-{portName}-{shortHash}"
  _schema: string;        // schema name, e.g. "DataFrame"
}

/** The raw pickle envelope as emitted by the runner. */
export interface ValueEnvelope {
  _schema: string;
  _encoding: 'pickle_b64';
  _data: string;          // base64-encoded pickle bytes
}

/** Summary computed by the runner and stored alongside the envelope. */
export interface ValueSummary {
  schema: string;
  // DataFrame-specific
  shape?: [number, number];
  dtype?: string;
  columns?: string[];
  head?: Record<string, unknown>[];
  stats?: Record<string, unknown>;
  // NumpyArray-specific
  ndim?: number;
  size?: number;
  sample?: unknown[];
}

/** A stored value: envelope + optional summary. */
export interface StoredValue {
  handle: string;
  envelope: ValueEnvelope;
  summary: ValueSummary | null;
  schema: string;
  createdAt: string;       // ISO timestamp
  nodeName: string;
  portName: string;
}
```

`ValueRef` is the type that flows through the TypeScript workflow runtime. Callers never see `ValueEnvelope` outside the execution layer.

## 7. ValueStore Class

```typescript
// execution/value-store.ts

export class ValueStore {
  constructor(private readonly runId: string, private readonly runsDir: string) {}

  /** Store an envelope under a new handle. Returns the handle. */
  store(
    envelope: ValueEnvelope,
    summary: ValueSummary | null,
    nodeName: string,
    portName: string,
  ): string;

  /** Resolve a handle to its envelope. Returns null if not found. */
  resolve(handle: string): StoredValue | null;

  /** True if the handle exists in this store. */
  has(handle: string): boolean;

  /** Persist all in-memory envelopes to disk in the run-level values directory. */
  flush(): Promise<void>;

  /** Load previously-flushed envelopes from disk into memory. */
  loadRunLevel(): Promise<void>;

  /** Return all handles currently in the store. */
  handles(): string[];
}
```

**Handle generation** (inside `store()`):

```
vs-{yyyyMMddTHHmmss}-{nodeName}-{portName}-{shortHash}
```

where `shortHash` is the first 8 hex characters of a SHA-256 over the envelope `_data` string. `nodeName` and `portName` are sanitized to `[a-z0-9_]` (dots become underscores, other non-alphanumeric become underscores, truncated to 20 chars each) before embedding in the handle. The timestamp is the UTC time of the `store()` call.

**Storage tiers in Phase 2:**

The store maintains a single `Map<string, StoredValue>` in memory. All values, whether produced by reasoning nodes (stub) or tool nodes, go into this map. There is no in-Phase-2 distinction between scope-local and run-level at runtime — the architectural distinction is preserved in the API surface (`store()` vs. a future `storeRunLevel()`) but both write to the same map. The `flush()` method serializes the full map to disk for persistence across restarts.

**Disk layout:**

```
runs/{runId}/values/
├── {handle}.pkl.b64           # JSON file: { envelope, createdAt, nodeName, portName }
└── {handle}.summary.json      # JSON file: ValueSummary (written if summary is non-null)
```

`loadRunLevel()` reads all `.pkl.b64` files in the directory and populates the in-memory map. It then reads any `.summary.json` sidecar for the same handle and attaches the summary. Files with malformed JSON are skipped with a warning log; they do not abort loading.

## 8. Runner Protocol Extension

The current runner stdout protocol (success):

```json
{
  "ok": true,
  "outputs": {
    "result": { "_schema": "NumpyArray", "_encoding": "pickle_b64", "_data": "..." }
  }
}
```

Extended protocol — runner adds `_summary` when the schema has a summarizable type:

```json
{
  "ok": true,
  "outputs": {
    "result": {
      "_schema": "NumpyArray",
      "_encoding": "pickle_b64",
      "_data": "...",
      "_summary": {
        "shape": [100000, 20],
        "dtype": "float64",
        "ndim": 2,
        "size": 2000000,
        "sample": [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
      }
    }
  }
}
```

The runner adds `_summary` only for `NumpyArray` and `DataFrame` schemas. For all other schemas the field is absent and the TypeScript side handles the absence gracefully (summary is null).

Extended protocol — inputs with value references. The runner envelope gains a `value_refs` top-level field:

```json
{
  "inputs": {
    "matrix": { "_type": "value_ref", "_handle": "vs-..." }
  },
  "input_schemas": { "matrix": "NumpyArray" },
  "output_schemas": { "result": "NumpyArray" },
  "value_refs": {
    "vs-...": { "_schema": "NumpyArray", "_encoding": "pickle_b64", "_data": "..." }
  }
}
```

The runner, on receiving an input whose value is `{_type: "value_ref", _handle: "..."}`, looks up the handle in `value_refs` and substitutes the full envelope before invoking the tool function. If the handle is not found in `value_refs`, the runner exits with code 2 and writes `handle_not_found: {handle}` to stderr.

**Python runner changes** (`runner.py`):

- At startup, parse the optional `value_refs` field from the stdin envelope (default to `{}`).
- Before calling the tool function, walk `inputs` and replace any `{_type: value_ref, _handle: ...}` entries with the decoded Python object from `value_refs`. Decoding follows the existing `pickle_b64` path.
- After calling the tool function, for each output port with `pickle_b64` encoding, call `_make_summary(schema_name, value)` and attach the result as `_summary` if it returns a non-None dict.
- `_make_summary` is a small inline function in `runner.py`:
  - For `DataFrame`: calls `df.shape`, `str(df.dtypes.to_dict())`, `list(df.columns)`, `df.head(5).to_dict('records')`, `df.describe().to_dict()`.
  - For `NumpyArray`: calls `arr.shape`, `str(arr.dtype)`, `arr.ndim`, `arr.size`, `arr[:5].tolist()`.
  - Wraps all extraction in a try/except; returns None on any failure so that a summary failure does not fail the tool invocation.

## 9. Encoding Changes

**`encodeInputs` (encoding.ts):**

Current behavior for `pickle_b64` inputs: raise `validation` error unconditionally.

New behavior:

```
if (inputValue is ValueRef) {
  // forward as-is; the value_refs map will be populated by the executor
  return inputValue;  // { _type: "value_ref", _handle: "..." }
}
// raw JS value for a pickle schema: still rejected
throw validation error "raw pickle inputs not supported — use a value handle"
```

The `encodeInputs` function gains an optional `valueStore: ValueStore | null` parameter. If `valueStore` is non-null, `encodeInputs` also builds the `value_refs` map: for each `ValueRef` in the inputs, it calls `valueStore.resolve(handle)` and adds `{ handle → envelope }` to the map. The resulting `value_refs` object is returned alongside the encoded inputs so `executor.ts` can include it in the runner envelope.

If `valueStore` is null (legacy callers), the behavior is identical to Phase 1+2: `pickle_b64` inputs from raw JS values are rejected; `ValueRef` objects are also rejected (not a valid input type without a store).

**`decodeOutputs` (encoding.ts):**

Current behavior for `pickle_b64` outputs: return the envelope object as-is to the caller.

New behavior: if `valueStore` is non-null and the output entry contains a `pickle_b64` envelope:

1. Extract the optional `_summary` field from the envelope dict.
2. Call `valueStore.store(envelope, summary, nodeName, portName)` to get a handle.
3. Return a `ValueRef` (`{_type: "value_ref", _handle, _schema}`) instead of the raw envelope.

If `valueStore` is null, behavior is unchanged: the envelope is returned as-is (backward compatibility for direct `RegistryClient.invoke()` callers without a run context).

## 10. DAG Executor Changes

```typescript
// dag-executor.ts (additions)

// Per-run value store, created when the run starts
const valueStore = new ValueStore(runId, runsDir);
await valueStore.loadRunLevel();  // no-op on first run, loads on resume

// When dispatching a kind: tool node
const resolvedInputs = resolveUpstreamRefs(nodeInputs, upstreamSignals, valueStore);
const result = await registryClient.invoke({
  ...invocationRequest,
  valueStore,           // threaded to executor → encoding
});

// After tool node completion
await valueStore.flush();  // persist new envelopes to disk
```

**`resolveUpstreamRefs`** is a new helper in `dag-executor.ts`. For each input in the node's `inputs` block:

- Literal values: pass through unchanged.
- `{{CONFIG}}` substitutions: resolve from workflow config.
- `${upstream.outputs.port}` references: read the upstream node's signal. If the signal's output for that port has a `value_ref` field, return the corresponding `{_type: "value_ref", _handle: ..., _schema: ...}` object. If the signal's output is a raw JSON value (primitive types), return it directly.

This function is the junction point that converts signal file references into `ValueRef` objects that `encodeInputs` can resolve.

**Signal writing** — after a tool node succeeds, the DAG executor writes the signal file. For outputs that are `ValueRef` objects, the signal stores:

```json
{
  "port": "df",
  "schema": "DataFrame",
  "value_ref": "vs-20260420T143055-load_data-df-b7e1",
  "summary": { "shape": [100000, 20], "dtype": "mixed", "columns": [...], ... }
}
```

The summary is included in the signal so that downstream nodes (and the UI) can read it without touching the value store.

## 11. Test Plan

**New unit tests** (no Python required):

- `execution/value-store.test.ts`:
  - `store()` generates a handle matching the `vs-{timestamp}-{node}-{port}-{hash}` pattern.
  - `resolve()` returns the stored value.
  - `has()` returns false for unknown handles.
  - `store()` with duplicate nodeName+portName on the same millisecond generates distinct handles (hash differs if data differs, timestamp differs if data is same).
  - `flush()` writes `.pkl.b64` and `.summary.json` files to a tmpdir.
  - `loadRunLevel()` reads them back and restores the map.
  - `loadRunLevel()` skips malformed files without throwing.

- `execution/encoding.test.ts` additions:
  - `encodeInputs` with a `ValueRef` input and a populated `ValueStore` — returns the ref and builds the `value_refs` map.
  - `encodeInputs` with a `ValueRef` input and `valueStore: null` — throws validation error.
  - `encodeInputs` with a raw JS value for a `pickle_b64` schema — throws validation error (unchanged).
  - `decodeOutputs` with a `pickle_b64` envelope and a `ValueStore` — returns a `ValueRef`, envelope is in the store.
  - `decodeOutputs` with a `pickle_b64` envelope and `valueStore: null` — returns raw envelope (unchanged).
  - `decodeOutputs` with a summary field in the envelope — summary is stored in the `ValueStore`.

- `schemas/builtin.test.ts` additions:
  - `getSummarizer("DataFrame")` returns a function.
  - `getSummarizer("NumpyArray")` returns a function.
  - `getSummarizer("Float")` returns null.
  - DataFrame summarizer called with a valid payload produces a `ValueSummary` with `shape`, `columns`, `head`.
  - DataFrame summarizer called with a partial payload (missing `stats`) returns a partial summary without throwing.

**Integration tests** (Python required, `describe.skipIf(!pythonAvailable)`):

- `execution/value-store.integration.test.ts`:
  - Invoke a tool with `NumpyArray` output (`test.numpy_sum`), verify the result is a `ValueRef`.
  - Resolve the `ValueRef` from the store, verify the envelope round-trips through Python.
  - Invoke a second tool that accepts the `ValueRef` as input (requires a new fixture `test.numpy_identity/v1` — accepts `NumpyArray`, returns the same array). Verify end-to-end handle resolution.
  - `flush()` then construct a new `ValueStore` with the same `runId`, call `loadRunLevel()`, verify the handle is resolved.

- New test fixture: `test.numpy_identity/v1` — `NumpyArray` in, `NumpyArray` out. Passes the input through unchanged. This is the minimal fixture that exercises the full pickle input → handle resolution → pickle output round-trip.

- `execution/executor.integration.test.ts` additions (extend existing file):
  - Invoke `test.numpy_sum` with a `ValueStore` — result is a `ValueRef`, not an envelope.
  - Invoke `test.numpy_identity` with the `ValueRef` from `test.numpy_sum` — succeeds and returns a new `ValueRef`.
  - Invoke `test.numpy_identity` with a raw JS value for the `NumpyArray` port — fails with `validation` error.
  - Invoke with a handle that is not in the `ValueStore` — fails with `validation` error `handle_not_found`.

**DAG executor test:**

- `workflow/dag-executor.test.ts` additions:
  - Two-node workflow: `kind: tool` node A (`test.numpy_sum`) → `kind: tool` node B (`test.numpy_identity`) with `inputs: { arr: "${A.outputs.result}" }`. Verify B runs and produces a `ValueRef` output.
  - Signal file after B contains `value_ref` and `summary` fields.

## 12. Rollout Steps

Five incremental, committable steps. Each has tests that must pass before the next step begins.

1. **Types + ValueStore core.** Add `ValueRef`, `ValueEnvelope`, `ValueSummary`, `StoredValue` to `types.ts`. Implement `execution/value-store.ts` with full in-memory map, handle generation, `flush()`/`loadRunLevel()` disk I/O. Test: `value-store.test.ts` unit tests (no Python).

2. **Schema summarizers.** Extend `SchemaDef` in `schemas/builtin.ts` with `summarizer?: (payload: unknown) => ValueSummary | null`. Implement summarizers for `NumpyArray` and `DataFrame`. Add `getSummarizer()` to `schema-registry.ts`. Test: `builtin.test.ts` summarizer unit tests (no Python).

3. **Encoding layer extension.** Extend `encodeInputs` and `decodeOutputs` in `execution/encoding.ts` to thread a `ValueStore | null`. Lift the blanket pickle rejection for `ValueRef` inputs. Build the `value_refs` map in `encodeInputs`. Emit `ValueRef` instead of raw envelope in `decodeOutputs`. Test: encoding unit tests.

4. **Runner protocol extension.** Update `python/runner.py` to accept `value_refs`, resolve handles before tool invocation, and emit `_summary` on pickle outputs. Update `execution/executor.ts` to pass `valueStore` through. Test: integration tests (`value-store.integration.test.ts`, `executor.integration.test.ts` additions) with `test.numpy_identity` fixture.

5. **DAG executor wiring.** Extend `dag-executor.ts` with `ValueStore` instantiation per run, `resolveUpstreamRefs`, `flush()` after each tool node, and summary in signal files. Test: DAG executor two-node workflow test.

Each step is independently committable. Steps 1-3 require no Python and no change to existing behavior. Steps 4-5 are the integration seam and are the ones most likely to require iteration.

**Estimated effort:** ~1 week. Steps 1-3 ≈ 2 days (pure TypeScript); step 4 ≈ 2 days (subprocess protocol + Python runner); step 5 ≈ 1 day (wiring + signal format).

## 13. Error Additions to the Existing Error Matrix

Two new error conditions are added. Both surface as category `validation` in `InvocationResult`:

| Category | New condition |
|---|---|
| `validation` | `pickle_b64` input is a raw JS value (not a `ValueRef`): `"raw pickle inputs not supported — use a value handle"` |
| `validation` | `ValueRef` input handle not found in the provided `ValueStore`: `"handle_not_found: {handle}"` |

The runner-side `handle_not_found` (exit code 2, stderr) is mapped to `subprocess_crash` by the existing exit-code dispatch unless the TypeScript side validates all handles before spawning. The implementation should validate all handles in `encodeInputs` before spawning the subprocess so that the error surfaces as `validation` (cheaper, earlier) rather than `subprocess_crash` (later, after spawn overhead).

## 14. Backward Compatibility

All changes are backward compatible with existing callers of `RegistryClient.invoke()`:

- `valueStore` parameter on `invoke()` is optional. If absent, `encodeInputs` behaves exactly as in Phase 1+2: `pickle_b64` inputs are rejected, `pickle_b64` outputs are returned as raw envelopes.
- The runner gains a new optional `value_refs` field in its input envelope. If absent (old callers spawning the runner directly), the runner defaults to `{}` and the existing behavior is preserved.
- The runner gains a new optional `_summary` field in its output envelopes. Existing callers that parse the output dict and encounter `_summary` must ignore unknown fields — this is already true because the runner may add debug keys. If any caller explicitly validates that no unknown keys exist, it will need to be updated.
- Signal files gain optional `value_ref` and `summary` fields on output entries. Existing consumers that read signals must tolerate new fields.

## 15. Open Questions Deferred

- **Summary size cap.** The `head` (5 rows × 20 columns) and `stats` dict in a DataFrame summary can be non-trivial. A cap of ~8 KB per summary seems reasonable but is not enforced in Phase 2. Phase 3 (LLM consumption of summaries) will impose a budget.
- **NumpyArray sample strategy for high-dimensional arrays.** `arr[:5].tolist()` is fine for 1D/2D but produces nested lists for 3D+. Phase 2 flattens silently; Phase 3 should define a proper sampling strategy.
- **Run directory location.** Phase 2 uses `runs/{runId}/values/` relative to the server's working directory. The exact root should be consolidated with the existing `runs/` layout from the workflow engine before Phase 3.
- **Memory pressure for large envelopes.** The in-memory map holds all envelopes for the run. For workflows that produce many large DataFrames, this could exhaust Node heap. An eviction policy (LRU, or explicit eviction after a node completes and its outputs are flushed) is deferred to Phase 3. Phase 2 is single-user and workflows are short; memory pressure is not expected in practice.

## 16. Relationship to Subsequent Slices

This slice unblocks:

- **Node Runtimes Phase 3** — the tool-calling loop in reasoning nodes. The value store scope infrastructure built here (minus the scope-local/run-level distinction stub) is what Phase 3 will use to hand values between tool calls within a reasoning node. Phase 3 removes the stub and makes the scope-local tier distinct from the run-level tier.
- **Tool Registry Phase 4** — converter insertion. When a type mismatch is detected during handle resolution (the handle's schema does not match the port's schema), Phase 4 can insert a converter tool invocation between the two nodes. The value store is the mechanism that makes converter chaining efficient — the converter's output is a new handle, not a serialized value.
- **The 4 currently-non-invokable seed tools** (`pandas.describe`, `pandas.filter_rows`, `pandas.select_columns`, `sklearn.pca`) become invokable end-to-end once Phase 2 lands. No changes to those tools are required.

Nothing in this slice locks design decisions that would make Phase 3 or Phase 4 harder.

---

*Approved for implementation on 2026-04-11. Next step: hand off to the writing-plans skill to produce a concrete step-by-step implementation plan.*
