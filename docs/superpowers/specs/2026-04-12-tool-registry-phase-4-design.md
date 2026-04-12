# Tool Registry — Phase 4 (Type System Completion) Design Spec

**Date:** 2026-04-12
**Status:** Approved for implementation
**Scope:** Converter registry, composition type checker, runtime validators, parametrized type parsing, converter runtime insertion
**Parent documents:** `docs/design/type-system.md`, `docs/design/tool-registry.md`, `MANIFESTO.md`
**Estimated effort:** ~11 days across 5 sub-phases

---

## 1. Context and Prerequisites

### 1.1 What is implemented

TR Phases 1–3 and NR Phases 1–3 are complete. At the start of this slice:

- **RegistryClient** with SQLite backing (`registry.db`, schema v1), `initialize()`, `register()`, `get()`, `list()`, `invoke()`, `findProducers()`, `findConsumers()`.
- **66 seed tools** across 10 categories, idempotently loaded at startup via `loadSeedTools`.
- **10 built-in schemas**: 7 primitives (`Integer`, `Float`, `String`, `Boolean`, `Null`, `JsonObject`, `JsonArray`) plus 3 structured (`NumpyArray`, `DataFrame`, `SymbolicExpr`).
- **Value store**: in-memory `ValueStore` with `store()`/`retrieve()`, pickle envelopes, per-handle summaries, disk flush.
- **AgentBackend interface** with 3 concrete backends (`ClaudeBackend`, `OpenAICompatBackend`, `OllamaBackend`).
- **Tool-calling loop** in `reasoning-runtime.ts`, signal parser, toolset resolver.
- **DAG executor** with scheduling, tool node execution via subprocess, reasoning node execution via agent backends.
- **335/335 tests passing, 0 skipped, 0 failing.**

### 1.2 What is missing

The type system (design doc `docs/design/type-system.md`) is partially implemented: schema storage, basic schema lookup, and the `SchemaRegistry` class exist. What is pending for TR Phase 4:

1. New structured schemas (`Series`, `OhlcFrame`, `FeaturesFrame`, `ReturnSeries`, `SignalSeries`, `Statistics`, `RegressionModel`, `ClusteringModel`) not yet in `builtin.ts`.
2. Converter registry: `converters` SQL table, `findConverter()`, built-in converter tools, `is_converter` handling in manifest parser.
3. Composition type checker: `checkWorkflow()` function, error types, wiring into `dag-executor.ts`.
4. Runtime validators: `validator` field in schema definitions, validator loading, invocation on value retrieval.
5. Parametrized type parser: `List[T]`, `Dict[K,V]`, `Optional[T]`, `Tuple[T1,T2,...]`.
6. Converter runtime insertion: DAG executor materializes converter invocations at runtime when the type checker has flagged a connection.

### 1.3 Design authority

`docs/design/type-system.md` is the authoritative design for the type system. This spec does not re-derive the design — it locks in scope boundaries, resolves ambiguities, fixes the file layout, and defines the rollout task structure. Read the design doc before reading this spec.

---

## 2. In Scope

- All 5 sub-phases (4a through 4e) as described in design doc §7.
- New built-in structured schemas: `Series`, `OhlcFrame`, `FeaturesFrame`, `ReturnSeries`, `SignalSeries`, `Statistics`, `RegressionModel`, `ClusteringModel` — added to `builtin.ts`.
- Converter registry: SQL table, registration flow, `RegistryClient.findConverter()`, 3 built-in converter tools.
- `TypeCheckResult` / `TypeError` / `ResolvedWorkflowPlan` types in a new `type-checker.ts` module.
- `checkWorkflow()` wired into `dag-executor.ts` after YAML parse, before scheduling.
- Runtime validators for 4 schemas: `OhlcFrame`, `FeaturesFrame`, `NumpyArray`, `SymbolicExpr`.
- Parametrized type expression parser (`List[T]`, `Dict[K,V]`, `Optional[T]`, `Tuple[...T]`).
- Converter tool invocation at runtime via existing `invoke()` path; converter steps recorded in run trace.

---

## 3. Out of Scope

- Multi-hop converter path finding (design doc §4.3 explicitly defers this post-MVP).
- Converter graph UI visualization.
- Automatic "missing converter" suggestion generation (the error message lists the fix; the system does not create the converter tool).
- Schema versioning (design doc §2.3 explicitly rejects it).
- Structural subtyping or generic type inference beyond simple parametrized primitives.
- Changing existing seed tool port declarations from `JsonArray` → `List[Float]` (decision D-E below; deferred to avoid breaking existing tests).
- DAG visualizer ghost-node display for inserted converters (UI toggle deferred, UX cost too high for this slice; trace records are sufficient).
- Per-workflow schema scoping (design doc §3.4: schemas are global).

---

## 4. Design Decisions

These decisions resolve ambiguities not fully settled by the design doc.

**D-A: New structured schemas added in 4a.** `Series`, `OhlcFrame`, `FeaturesFrame`, `ReturnSeries`, `SignalSeries`, `Statistics`, `RegressionModel`, `ClusteringModel` are added to `packages/server/src/modules/registry/schemas/builtin.ts` as part of sub-phase 4a (alongside the converter registry), not as a separate schema-only sub-phase. The reason: the built-in converters (`DataFrame → NumpyArray`, etc.) reference these schemas by name; both must land together or the converter registration will fail the `schema_unknown` check.

**D-B: Type checker lives in `workflow/`, not `registry/`.** `type-checker.ts` belongs in `packages/server/src/modules/workflow/` because it operates on parsed workflow YAML and cross-cuts both the registry (for tool/schema lookup) and the workflow representation. It imports from `registry/` but is not a registry module.

**D-C: Converter tools stored in `~/.plurics/registry/tools/convert.{Source}_to_{Target}/v1/`.** They are first-class tools with `metadata.is_converter: true` in their manifest. The converter table in SQLite is an index over these tools, not separate storage. Built-in converters are seeded via `loadSeedTools` alongside the 66 existing seed tools.

**D-D: Validator invocation happens at value retrieval, not value storage.** When `ValueStore.retrieve(handle, schemaName)` is called, the store invokes the schema's validator (if present) before returning the envelope. This is consistent with design doc §6.1: the consumer validates the value it is about to receive, not the producer when it stores. Rationale: a producer can emit a valid generic `DataFrame` and a downstream consumer expecting `OhlcFrame` gets the validation error at the right point (after any converter has been applied).

**D-E: Parametrized types and existing seed tools — no backfill.** `JsonArray` in existing tool manifests is left as-is. The parametrized parser handles both `JsonArray` (as a named primitive lookup) and `List[Float]` (as a parametrized expression) — the two are distinct types, not unified. New tools may declare `List[Integer]` for precision. This avoids touching 66 tool manifests and breaking 335 passing tests.

**D-F: Checker wiring point.** `checkWorkflow()` is called inside `DagExecutor.start()` immediately after `parseWorkflow()` returns, before the run directory is created and before any node transitions. If `result.ok === false`, `start()` throws an error whose message is the formatted checker output; the caller (WebSocket handler) catches this and relays errors to the client. No run ID is allocated for a rejected workflow.

**D-G: DB schema version bump.** Adding the `converters` table requires bumping `EXPECTED_SCHEMA_VERSION` in `db.ts` from 1 → 2 and providing a migration path (DROP + re-CREATE for dev; a proper ALTER for existing registries). The migration strategy is: if version < 2, run the `converters` DDL addition and update the version. Existing data is not affected (no column removals).

**D-H: `SchemaDef` extended with `validatorModule` / `validatorFunction` fields.** The TypeScript `SchemaDef` type in `types.ts` gains two optional string fields: `validatorModule?: string` and `validatorFunction?: string`. When present, the executor loads this Python module reference and calls it on value retrieval. The validator is Python-side only; the TypeScript side stores the module path and dispatches via subprocess (same mechanism as tool invocation).

**D-I: `ToolManifest` extended with `is_converter`, `source_schema`, `target_schema`.** The `metadata` block in `types.ts` gains three optional fields: `isConverter?: boolean`, `sourceSchema?: string`, `targetSchema?: string`. The manifest parser in `parser.ts` reads `metadata.is_converter`, `metadata.source_schema`, `metadata.target_schema` from YAML and maps them to these fields. The `RegistryDb` reads these during tool registration to populate the `converters` table.

---

## 5. File Layout

### 5.1 New files

```
packages/server/src/modules/workflow/type-checker.ts
    — checkWorkflow(), TypeCheckResult, TypeError, TypeWarning,
      ResolvedWorkflowPlan, ConverterInsertion types
    — parseInputSourceExpr(), resolveSourceSchema(), checkCompatibility()

packages/server/src/modules/workflow/type-parser.ts
    — parseTypeExpr(): tokenizer + recursive descent parser
    — TypeExpr, Primitive, Parametrized types
    — typeExprEqual() structural equality

packages/server/src/modules/workflow/__tests__/type-checker.test.ts
packages/server/src/modules/workflow/__tests__/type-parser.test.ts

packages/server/src/modules/registry/seeds/tools/convert.DataFrame_to_NumpyArray/v1/tool.yaml
packages/server/src/modules/registry/seeds/tools/convert.DataFrame_to_NumpyArray/v1/tool.py
packages/server/src/modules/registry/seeds/tools/convert.NumpyArray_to_DataFrame/v1/tool.yaml
packages/server/src/modules/registry/seeds/tools/convert.NumpyArray_to_DataFrame/v1/tool.py
packages/server/src/modules/registry/seeds/tools/convert.OhlcFrame_to_ReturnSeries/v1/tool.yaml
packages/server/src/modules/registry/seeds/tools/convert.OhlcFrame_to_ReturnSeries/v1/tool.py

packages/server/src/modules/registry/schemas/validators/ohlc_frame.py
packages/server/src/modules/registry/schemas/validators/features_frame.py
packages/server/src/modules/registry/schemas/validators/numpy_array.py
packages/server/src/modules/registry/schemas/validators/symbolic_expr.py

packages/server/src/modules/registry/__tests__/converter-registry.test.ts
```

### 5.2 Modified files

```
packages/server/src/modules/registry/schemas/builtin.ts
    — Add 8 new structured schemas (D-A)

packages/server/src/modules/registry/types.ts
    — SchemaDef: add validatorModule?, validatorFunction? (D-H)
    — ToolManifest.metadata: add isConverter?, sourceSchema?, targetSchema? (D-I)
    — Add TypeExpr, TypeCheckResult, TypeError, TypeWarning,
      ResolvedWorkflowPlan, ConverterInsertion to public types

packages/server/src/modules/registry/storage/db.ts
    — Bump EXPECTED_SCHEMA_VERSION 1 → 2
    — Add converters DDL to SCHEMA_V2 migration block
    — Add insertConverter(), findConverter() DB methods

packages/server/src/modules/registry/registry-client.ts
    — Add findConverter(source: string, target: string): ConverterRecord | null

packages/server/src/modules/registry/manifest/parser.ts
    — Read metadata.is_converter, metadata.source_schema, metadata.target_schema

packages/server/src/modules/registry/seeds/manifest.ts
    — Add 3 SeedToolDef entries for the built-in converter tools

packages/server/src/modules/registry/seeds/loader.ts
    — Update expected seed tool count (66 → 69)

packages/server/src/modules/registry/execution/value-store.ts
    — retrieve(): invoke validator if schema has validatorModule (D-D)
    — Add global validation toggle (read from env PLURICS_DISABLE_VALIDATION)

packages/server/src/modules/workflow/dag-executor.ts
    — DagExecutor.start(): call checkWorkflow() before scheduling (D-F)
    — Tool node execution: materialize ConverterInsertions before invoking target tool (4e)

packages/server/src/modules/workflow/yaml-parser.ts
    — ParsedWorkflowYaml type export (currently WorkflowConfig — expose or alias
      as ParsedWorkflowYaml so type-checker.ts can import it cleanly)
```

---

## 6. New Built-in Schemas

All 8 schemas are added to `BUILTIN_SCHEMAS` in `builtin.ts`. All are `kind: 'structured'` and `encoding: 'pickle_b64'`. Summarizers are included where useful; validators are wired in 4c.

| Schema | `pythonRepresentation` | Summarizer | Validator |
|---|---|---|---|
| `Series` | `pandas.Series` | yes (name, dtype, length, sample) | no |
| `OhlcFrame` | `pandas.DataFrame` | yes (shape, columns, date range) | yes (4c) |
| `FeaturesFrame` | `pandas.DataFrame` | yes (shape, feature columns) | yes (4c) |
| `ReturnSeries` | `pandas.Series` | yes (length, mean, std) | no |
| `SignalSeries` | `pandas.Series` | yes (length, unique values, counts) | no |
| `Statistics` | `dict` | yes (key list, selected values) | no |
| `RegressionModel` | `object` | no | no |
| `ClusteringModel` | `object` | no | no |

`RegressionModel` and `ClusteringModel` ship without summarizers because the Python object representation is too varied across libraries (sklearn, statsmodels, etc.) to produce a stable summary. They also have no validators for the same reason.

`PICKLE_SCHEMA_NAMES` (the filter over `encoding: 'pickle_b64'`) automatically includes all 8 new schemas because they share the `pickle_b64` encoding. No separate change needed in `runner.py`'s `PICKLE_SCHEMAS` set — this set is generated from the registered schema list at runtime, not hardcoded (verify this assumption against `runner.py` before 4a lands; if hardcoded, update it).

---

## 7. Converter Registry (4a)

### 7.1 SQL additions

The `SCHEMA_V2` migration block in `db.ts` adds:

```sql
CREATE TABLE IF NOT EXISTS converters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_schema    TEXT NOT NULL,
  target_schema    TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  tool_version     INTEGER NOT NULL,
  registered_at    TEXT NOT NULL,
  UNIQUE(source_schema, target_schema)
);

CREATE INDEX IF NOT EXISTS idx_converters_pair ON converters(source_schema, target_schema);
```

`UNIQUE(source_schema, target_schema)` enforces at most one converter per pair. Attempting to register a second converter for the same pair uses `INSERT OR REPLACE` — the latest registration wins (design doc §4.2).

### 7.2 Registration flow changes

In `RegistryDb`, the existing `insertTool()` method gains a step: after writing to the `tools` table, if `manifest.metadata.isConverter === true`, call `insertConverter(sourceSchema, targetSchema, toolName, version)` which executes the `INSERT OR REPLACE INTO converters` statement.

The manifest validator in `validator.ts` adds a check: if `metadata.is_converter` is true, then `metadata.source_schema` and `metadata.target_schema` must both be non-empty strings and must each match the input/output port schemas respectively. This prevents manifests that declare `is_converter: true` but have mis-matching port/metadata schemas.

### 7.3 `RegistryClient.findConverter()`

```typescript
interface ConverterRecord {
  sourceSchema: string;
  targetSchema: string;
  toolName: string;
  toolVersion: number;
}

// Returns null when no converter is registered for the pair.
// Returns the converter record when one exists.
// The identity case (source === target) is NOT handled here —
// the type checker special-cases it without calling findConverter().
findConverter(source: string, target: string): ConverterRecord | null;
```

This is a synchronous method (same as all other `RegistryDb` reads). It executes:

```sql
SELECT source_schema, target_schema, tool_name, tool_version
FROM converters
WHERE source_schema = ? AND target_schema = ?
LIMIT 1;
```

### 7.4 Built-in converter tools

Three converter tools are seeded. They follow the naming convention `convert.{Source}_to_{Target}`.

**`convert.DataFrame_to_NumpyArray`** — `tool.py:run` extracts `.values` from a pandas DataFrame and returns the NumPy array. Manifests `source_schema: DataFrame`, `target_schema: NumpyArray`.

**`convert.NumpyArray_to_DataFrame`** — wraps a NumPy array into a pandas DataFrame with default integer column names. Manifests `source_schema: NumpyArray`, `target_schema: DataFrame`.

**`convert.OhlcFrame_to_ReturnSeries`** — computes log returns from the `close` column and returns a `ReturnSeries`. Implementation: `np.log(df['close']).diff().dropna()`. Manifests `source_schema: OhlcFrame`, `target_schema: ReturnSeries`.

Each converter's `tool.yaml` declares:
- `inputs.source.schema` matching `metadata.source_schema`
- `outputs.target.schema` matching `metadata.target_schema`
- `category: converter`
- `metadata.is_converter: true`
- `tests.required: true` with a `tests.py` file that covers the happy path and one edge case

---

## 8. Composition Type Checker (4b)

### 8.1 Module interface

New file `packages/server/src/modules/workflow/type-checker.ts` exports:

```typescript
export interface TypeCheckResult {
  ok: boolean;
  errors: TypeError[];
  warnings: TypeWarning[];
  resolvedPlan: ResolvedWorkflowPlan;
}

export interface TypeError {
  category:
    | 'tool_not_found'
    | 'schema_not_found'
    | 'type_mismatch'
    | 'missing_required_input'
    | 'preset_not_found'
    | 'invalid_reference'
    | 'invalid_backend';
  message: string;
  location: { nodeName: string; line?: number; column?: number };
  details?: Record<string, unknown>;
}

export interface TypeWarning {
  category: 'empty_category' | 'unresolved_glob' | 'unused_output' | 'validation_disabled';
  message: string;
  location: { nodeName: string };
}

export interface ResolvedWorkflowPlan {
  nodes: Map<string, ResolvedNode>;
  converterInsertions: ConverterInsertion[];
}

export interface ResolvedNode {
  kind: 'tool' | 'reasoning';
  // tool nodes
  resolvedToolName?: string;
  resolvedVersion?: number;
  // reasoning nodes
  resolvedToolset?: string[];   // expanded list of tool names
  resolvedBackend?: string;
}

export interface ConverterInsertion {
  upstreamNode: string;
  upstreamPort: string;
  downstreamNode: string;
  downstreamPort: string;
  converterTool: string;
  converterVersion: number;
}

export function checkWorkflow(
  parsed: ParsedWorkflowYaml,
  registry: RegistryClient,
  schemas: SchemaRegistry,
): TypeCheckResult;
```

`ParsedWorkflowYaml` is the existing `WorkflowConfig` type (re-exported from `yaml-parser.ts` under the new alias so `type-checker.ts` has a stable import).

### 8.2 Algorithm

The checker runs in a single pass over the node list in topological order (guaranteed acyclic by the existing `validateNodeGraph` in `yaml-parser.ts`).

**Port schema table:** Before the node pass, the checker builds a `Map<string, Map<string, string>>` mapping `nodeName → portName → schemaName`. This is populated as tool nodes are resolved; downstream nodes consult it when resolving upstream references.

**Tool node checks (design doc §5.2):**

1. Look up the tool by name in `registry`. Not found → `tool_not_found` error. Found → record `resolvedToolName` + `resolvedVersion`.
2. For each input in the node's `inputs` block, parse the source expression:
   - Literal → infer schema from the port's declared schema and validate literal type.
   - Config substitution `{{KEY}}` → resolve from `workflow.config`, then treat as literal.
   - Upstream reference `${node.outputs.port}` → look up schema in the port schema table; if the node or port does not exist in the table, emit `invalid_reference`.
3. For each input port in the tool manifest, check compatibility between resolved source schema and declared port schema:
   - Equal → ok.
   - `registry.findConverter(source, declared)` returns a record → record a `ConverterInsertion`, mark ok.
   - Neither → `type_mismatch` error with the full template from design doc §5.6.
4. Check required ports: every `required: true` input port with no value in the `inputs` block → `missing_required_input`.
5. Record output schemas in the port schema table for downstream nodes.

**Reasoning node checks (design doc §5.3):**

1. Validate `backend` ∈ `{ 'claude', 'openai-compat', 'ollama' }`. Invalid → `invalid_backend` error.
2. Expand `toolset` entries against the registry. Missing tools → `tool_not_found`. Empty categories → `TypeWarning('empty_category')`.
3. Validate `preset` reference via `PresetRepository`. Missing → `preset_not_found`.
4. No composition checking on the LLM's internal tool calls (design doc §5.3, step 4).

**Cross-node dependencies (design doc §5.4):** Every `depends_on` entry is verified against the known node names. Invalid → `invalid_reference`. Cycle detection is skipped (already done by `validateNodeGraph`).

**Accumulation:** All errors and warnings are accumulated before returning; the checker never throws on a type error. `result.ok = result.errors.length === 0`.

### 8.3 Error message template

Error messages follow design doc §5.6. The formatter receives the structured `TypeError` fields and produces the multi-line user-facing string. Example for `type_mismatch`:

```
Type mismatch in workflow `{workflowName}` at node `{nodeName}`:
  The input port `{portName}` of tool `{toolName}` expects schema `{targetSchema}`,
  but the upstream node `{upstreamNode}` (output port `{upstreamPort}`) produces schema `{sourceSchema}`.

  No converter is registered for `{sourceSchema} → {targetSchema}`.

  Possible fixes:
    1. Change the upstream tool's output to declare `{targetSchema}` directly.
    2. Register a converter from `{sourceSchema}` to `{targetSchema}`.
    3. Insert an intermediate tool node that wraps the value.
```

The `message` field in `TypeError` stores the pre-formatted multi-line string; callers display it verbatim.

### 8.4 Wiring in `dag-executor.ts`

`DagExecutor.start()` gains, immediately after `const workflow = parseWorkflow(yamlContent)`:

```typescript
const typeCheckResult = checkWorkflow(workflow, this.registryClient, this.schemas);
if (!typeCheckResult.ok) {
  throw new Error(
    `Workflow type check failed:\n` +
    typeCheckResult.errors.map(e => e.message).join('\n\n')
  );
}
this.resolvedPlan = typeCheckResult.resolvedPlan;
```

`this.resolvedPlan` is a new private field on `DagExecutor` of type `ResolvedWorkflowPlan | null`, initialized to `null`. It is used in 4e for converter insertion.

The WebSocket handler that calls `executor.start()` already wraps in try/catch and relays errors to the client; no handler changes are needed.

---

## 9. Runtime Validators (4c)

### 9.1 SchemaDef extension

`types.ts` gains two optional fields on `SchemaDef`:

```typescript
validatorModule?: string;    // e.g. "schemas/validators/ohlc_frame.py"
validatorFunction?: string;  // defaults to "validate" if module is set but function is omitted
```

These are set in `builtin.ts` for the 4 schemas that ship validators. They are also read from user-registered schema YAML files if the YAML declares a `validator:` block.

### 9.2 Validator Python signature

```python
def validate(value: object, schema_metadata: dict) -> tuple[bool, str | None]:
    """
    Returns (True, None) if valid.
    Returns (False, error_message) if invalid.
    Must complete in < 1 ms for typical inputs.
    Must not traverse full content of large structures.
    """
```

`schema_metadata` contains the schema's `name`, `kind`, `python_representation`, and any structural fields declared in the schema YAML (`required_columns`, etc.). It is passed as a JSON-serializable dict.

### 9.3 Invocation mechanism

Validators run Python-side. The validator invocation piggybacks on the existing subprocess execution machinery in `executor.ts`. When `ValueStore.retrieve()` is called with a `schemaName` that has a `validatorModule`, the store does not invoke the validator itself (TypeScript cannot run Python inline). Instead, it records the validator request and the executor calls the validator before passing the value to the tool.

Concretely: `invokeTool()` in `executor.ts` gains an optional pre-invocation step: if the input schema has a validator, the runner script runs the validator function against the deserialized value before calling the tool entry point. The runner raises `SchemaValidationError` if validation fails, which the executor maps to an `InvocationResult` with `success: false` and `error.category: 'schema_validation_failed'`.

This approach avoids a separate subprocess per validation and reuses the existing runner protocol.

### 9.4 Global disable switch

`PLURICS_DISABLE_VALIDATION=1` environment variable suppresses all validator invocations. The runner checks this variable at startup. When disabled, the runner emits a `validation_disabled` warning in the run log JSON. `DagExecutor` reads the run log and converts this into a `TypeWarning` in the final run summary.

### 9.5 Built-in validators

Four Python files under `packages/server/src/modules/registry/schemas/validators/`:

- **`ohlc_frame.py`**: checks `isinstance(value, pd.DataFrame)`, required columns (`open`, `high`, `low`, `close`) exist, column dtypes are numeric, index is `DatetimeTZDtype` or `datetime64`, index is monotonically increasing.
- **`features_frame.py`**: checks `isinstance`, at least one column, index is datetime-like, all columns are numeric.
- **`numpy_array.py`**: `isinstance(value, np.ndarray)` only (one line). Quick enough that no further restriction is needed.
- **`symbolic_expr.py`**: `isinstance(value, sympy.Basic)`.

All four avoid row-level iteration. Column checks use `df.dtypes` and `pd.api.types.*` predicates which operate on metadata only.

---

## 10. Parametrized Type Parser (4d)

### 10.1 New file: `type-parser.ts`

```typescript
// Supported type expression forms:
//   Primitive names:        Integer, Float, String, Boolean, Null, JsonObject, JsonArray
//   Named structured:       NumpyArray, DataFrame, OhlcFrame, ...
//   Parametrized:           List[T], Dict[K, V], Optional[T], Tuple[T1, T2, ...]
//   Nested (primitives only): List[List[Integer]], Optional[List[Float]]

export type TypeExpr =
  | { kind: 'named'; name: string }
  | { kind: 'parametrized'; outer: string; params: TypeExpr[] };

export function parseTypeExpr(input: string): TypeExpr;
export function typeExprEqual(a: TypeExpr, b: TypeExpr): boolean;
export function typeExprToString(e: TypeExpr): string;
```

**Parser:** Recursive descent. Tokenizer splits on `[`, `]`, `,`, and whitespace. `parseTypeExpr` reads a name token, then if followed by `[` recursively reads comma-separated `TypeExpr` children until `]`. Error on malformed input.

**Equality:** Structural. `named` nodes equal iff names are identical. `parametrized` nodes equal iff `outer` strings are identical and `params` arrays have the same length with pairwise equal elements.

**Restrictions enforced at parse time:**
- Structured schemas (`NumpyArray`, `DataFrame`, and all others not in the 7 primitive set) may not appear as type parameters. The parser checks: if a `named` TypeExpr is used as a parameter to `List`, `Dict`, `Optional`, or `Tuple`, and its name is not one of the 7 primitives, it throws a `ParseError`. This enforces design doc §3.2's restriction against `List[OhlcFrame]`.

**Integration with schema lookup:** When the manifest parser reads a port's `schema` string, it first tries a direct name lookup in the schema registry. If the name contains `[`, it parses the string as a `TypeExpr` and stores the parsed tree in the `ToolPortSpec`. The type checker then uses `typeExprEqual()` instead of string equality when comparing parametrized types. Named types continue to use string equality (no change to existing behavior).

### 10.2 No backfill of existing tools (D-E)

`JsonArray` in existing manifests is a named type and is looked up as `named('JsonArray')`. `List[Float]` is a parametrized type and is looked up as `parametrized('List', [named('Float')])`. The two are distinct and are not automatically compatible. This is correct: `JsonArray` is the untyped escape hatch; `List[Float]` is the precise form.

---

## 11. Converter Insertion at Runtime (4e)

### 11.1 Converter materialization

`DagExecutor` holds `this.resolvedPlan: ResolvedWorkflowPlan | null` (set in 4b wiring). When executing a tool node, before invoking the target tool, the executor consults `resolvedPlan.converterInsertions` for any entries matching `(downstreamNode = currentNode)`.

For each matching `ConverterInsertion`:

1. Retrieve the upstream value handle from the value store (`upstreamNode.upstreamPort`).
2. Invoke the converter tool via `registryClient.invoke({ toolName: converterTool, version: converterVersion, inputs: { source: handle } })`.
3. Store the converter's `target` output in the value store under a synthetic handle named `"converter-{upstreamNode}-{upstreamPort}-{downstreamNode}-{downstreamPort}"`.
4. Replace the input reference in the tool invocation call: the downstream tool receives the converter's output handle instead of the raw upstream handle.

This is transparent to the downstream tool. It receives a value of the correct schema without knowing a conversion happened.

### 11.2 Trace recording

`DagExecutor`'s event log gains a new entry type `'converter_inserted'` with fields:

```typescript
{
  type: 'converter_inserted';
  converterTool: string;
  converterVersion: number;
  upstreamNode: string;
  upstreamPort: string;
  downstreamNode: string;
  downstreamPort: string;
  convertedHandle: string;
  durationMs: number;
}
```

This entry is appended to `this.eventLog` immediately after the converter invocation completes. It appears in the run snapshot and in the logs. The frontend can render it as a synthetic step in the timeline (currently displays as a plain log entry; UI enhancement deferred).

### 11.3 Resume support

The `RunSnapshot` (written by `DagExecutor` on each state change) includes the full event log. On resume, the executor re-reads the event log and skips converter re-invocations for connections already in the log. This reuses the existing idempotent skip logic already present for tool nodes.

---

## 12. Test Strategy

### 12.1 Unit tests

- **`type-parser.test.ts`**: parse round-trips for all 4 parametrized forms; equality checks; error cases (structured types as params, malformed strings, empty params, trailing garbage).
- **`type-checker.test.ts`**: happy path (well-typed workflow, no converters needed); converter inserted (source and target schemas differ, converter exists); type mismatch (no converter, error message template verified verbatim); missing required input; tool not found; invalid backend; invalid upstream reference; cross-node deps (missing `depends_on`).
- **`converter-registry.test.ts`**: `findConverter()` returns null before insertion, returns record after; `INSERT OR REPLACE` semantics (second registration for same pair wins); converter table populated during `register()` for `is_converter: true` manifests; manifest validator rejects `is_converter: true` with mismatched port/metadata schemas.

### 12.2 Integration tests

- **Converter tool tests** (`tests.py` in each converter's directory): invoked as part of the existing seed registration flow when `libsAvailable(['pandas', 'numpy'])`.
- **Validator tests** (inline in the validator `.py` files or a separate `test_validators.py`): each validator's happy path and at least one failure case; runs as part of the seed loader integration test suite.
- **End-to-end type check test** in `dag-executor-tool-nodes.test.ts`: a minimal 2-node workflow with mismatched schemas fails `start()` with the expected error message; a 2-node workflow with a registered converter succeeds.

### 12.3 Test count target

Current: 335 tests. TR Phase 4 adds approximately 60–80 new tests across the three new test files plus additions to existing files. Target: ≥ 395 passing, 0 skipped, 0 failing, after all 5 sub-phases.

---

## 13. Rollout Tasks

### Sub-phase 4a — Converter registry (~2 days)

1. Add 8 new `SchemaDef` entries to `builtin.ts` (`Series`, `OhlcFrame`, `FeaturesFrame`, `ReturnSeries`, `SignalSeries`, `Statistics`, `RegressionModel`, `ClusteringModel`). Verify `builtin.test.ts` still passes with new count.
2. Extend `SchemaDef` in `types.ts` with `validatorModule?` and `validatorFunction?`. Extend `ToolManifest.metadata` with `isConverter?`, `sourceSchema?`, `targetSchema?`.
3. Add `converters` table DDL to `db.ts`; bump schema version 1 → 2; add version migration block; add `insertConverter()` and `findConverter()` methods.
4. Update `parser.ts` to read `metadata.is_converter`, `metadata.source_schema`, `metadata.target_schema` from YAML.
5. Update `validator.ts` to check converter manifest constraints (is_converter requires source/target schema match ports).
6. Update `RegistryDb.insertTool()` to call `insertConverter()` when `isConverter === true`. Update `RegistryClient` to expose `findConverter()`.
7. Write `convert.DataFrame_to_NumpyArray` (tool.yaml + tool.py + tests.py). Add to `manifest.ts`.
8. Write `convert.NumpyArray_to_DataFrame` (tool.yaml + tool.py + tests.py). Add to `manifest.ts`.
9. Write `convert.OhlcFrame_to_ReturnSeries` (tool.yaml + tool.py + tests.py). Add to `manifest.ts`.
10. Write `converter-registry.test.ts`. All tests green; seed count 66 → 69.

### Sub-phase 4b — Composition type checker (~4 days)

11. Export `ParsedWorkflowYaml` alias from `yaml-parser.ts`.
12. Implement `type-checker.ts`: types, `parseInputSourceExpr()`, `resolveSourceSchema()`, `checkCompatibility()`, `checkWorkflow()`. Implement error message formatter.
13. Wire `checkWorkflow()` into `DagExecutor.start()` (D-F). Add `resolvedPlan` field.
14. Write `type-checker.test.ts` covering all error categories and the happy path.
15. Add end-to-end type check test to `dag-executor-tool-nodes.test.ts`.

### Sub-phase 4d — Parametrized type parsing (~1 day)

16. Implement `type-parser.ts`: `parseTypeExpr()`, `typeExprEqual()`, `typeExprToString()`.
17. Wire parser into manifest `parser.ts`: port schema strings containing `[` are parsed into `TypeExpr`; stored in `ToolPortSpec` as `parsedTypeExpr?`.
18. Update `checkCompatibility()` in `type-checker.ts` to use `typeExprEqual()` when either side is a parametrized type.
19. Write `type-parser.test.ts`.

### Sub-phase 4c — Runtime validators (~2 days)

20. Write 4 Python validator files (`ohlc_frame.py`, `features_frame.py`, `numpy_array.py`, `symbolic_expr.py`) under `schemas/validators/`.
21. Add `validatorModule` and `validatorFunction` to the relevant `SchemaDef` entries in `builtin.ts`.
22. Update `runner.py` to check for and invoke schema validators on input deserialization; raise `SchemaValidationError` on failure; respect `PLURICS_DISABLE_VALIDATION`.
23. Update `executor.ts` to map `SchemaValidationError` runner output to `InvocationResult` with `error.category: 'schema_validation_failed'`.
24. Add `PLURICS_DISABLE_VALIDATION` handling and `validation_disabled` log entry. Verify `validation_disabled` TypeWarning appears in run summary.

### Sub-phase 4e — Converter insertion at runtime (~2 days)

25. Implement converter materialization in `DagExecutor`'s tool node execution path (Section 11.1).
26. Add `converter_inserted` event log entry type to `types.ts` and event log append in `DagExecutor`.
27. Add resume-path skip logic for already-completed converter insertions.
28. Write integration test: 2-node workflow with `OhlcFrame → ReturnSeries` converter inserted; verify converter event appears in event log; verify downstream tool receives value of `ReturnSeries` schema.

**Total tasks: 28** across 5 sub-phases.

---

## 14. Parallelism and Sequencing

The 5 sub-phases have the following dependency structure:

```
4a (converter registry)   ──┐
4d (parametrized parser)  ──┼── 4b (type checker) ── 4c (validators) ── 4e (converter runtime)
```

- **4a and 4d are independent** and can be developed in parallel.
- **4b requires 4a** (to call `findConverter()`) and **requires 4d** (for parametrized type equality in `checkCompatibility()`). In practice, 4b can stub `findConverter()` until 4a lands and stub `typeExprEqual()` until 4d lands — but the cleanest sequence is 4a + 4d first, then 4b.
- **4c is independent of 4b** at the implementation level but logically follows: validators fire at runtime, not at type-check time. Can be parallelized with 4b.
- **4e requires 4b** because it consumes `resolvedPlan.converterInsertions`.

Recommended sequence: `4a + 4d` → `4b + 4c` → `4e`.

---

## 15. Relationship to Subsequent Work

TR Phase 4 completes the type system. Work that becomes unblocked after this slice:

- **Workflow authoring UX**: the type checker's structured `TypeCheckResult` can be returned to the frontend over WebSocket for inline error highlighting in the workflow YAML editor.
- **Multi-hop converter paths** (design doc §4.3): post-MVP. Can be added without breaking single-hop behavior. Requires a graph search over the `converters` table.
- **Schema browser UI**: the schema registry now has 18+ schemas with structured documentation fields; a frontend view becomes useful.
- **Seed tool precision upgrades**: once the parametrized parser is in place, individual seed tool manifests can be upgraded from `JsonArray` → `List[Float]` on a tool-by-tool basis without a forced flag day.
- **Reasoning node output validation**: design doc §5.3 step 5 validates preset-declared output port schemas; a full runtime check (validating the LLM actually produced a value matching the declared schema) would use the same validator infrastructure added in 4c.
- **Auto-generated converter stubs**: the error message in 4b tells the user what converter to write; a future CLI command could scaffold the tool.yaml + tool.py stub automatically.

---

*Spec generated 2026-04-12 07:14 UTC. Authoritative design: `docs/design/type-system.md`.*
