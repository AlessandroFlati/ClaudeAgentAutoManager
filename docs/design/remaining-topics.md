# Plurics — Remaining Topics, Open Questions, and Architectural Decisions

**Date:** 2026-04-12
**Scope:** Comprehensive inventory of deferred features, open design questions, cross-document inconsistencies, undocumented decisions, missing documentation, and known gaps across the entire Plurics project
**Status:** Living document — update as items are resolved or new ones are discovered
**Audience:** Contributors, maintainers, future design sessions

---

## 1. Explicitly Deferred Features

Items that are described in design documents but deliberately excluded from the current implementation. Each is tagged with its source document and target phase.

### 1.1 Tool Registry

| Feature | Source | Target | Description |
|---|---|---|---|
| Multi-hop converter path finding | `tool-registry.md` §12 | Post-MVP | Single-hop conversion only. Multi-hop search through the converter graph deferred due to combinatorial risk and ambiguous path selection. Workaround: register a direct converter or insert an intermediate tool node. |
| Automatic regression testing | `tool-registry.md` §12 | Post-MVP | Registering a new tool does not re-run tests of dependent tools. A regression in tool B caused by updating tool A is not caught automatically. |
| Shared registries | `tool-registry.md` §12 | Post-MVP | Each Plurics installation has its own registry. No git-sync, export/import, or hosted registry. Teams share tools by copying directories. |
| Dynamic virtualenv management | `tool-registry.md` §12 | Post-MVP | Tools declare `requires` but the user installs dependencies manually. No automatic `pip install`, no per-tool virtualenv isolation. |
| MCP server bridge | `tool-registry.md` §12 | Post-MVP | Registry tools are not exposed via the Model Context Protocol. A thin MCP adapter over the registry API is architecturally straightforward but unbuilt. |
| Tool-authoring UI | `tool-registry.md` §12 | Phase 7 | No browser-based interface for writing, testing, or registering tools. All authoring is file-based or programmatic. |
| Invocation cache | `tool-registry.md` §9.4 | Post-MVP | Every `invoke()` runs the tool fresh. Caching by `(name, version, inputs_hash)` is designed but unimplemented. The cache directory exists in the layout spec but is empty. |
| Agent test runner | `tool-registry.md` §3.3 | Phase 6 | `RegistryClient.register({caller: 'agent', testsRequired: true})` returns a stub error. The code path exists but the test execution subprocess is not wired. The `onToolProposal` plugin hook depends on this for safe agent-generated tool registration. |
| Full-text search | `tool-registry.md` §5.2 | Unscheduled | `RegistryClient.search("fourier transform")` is not implemented. Discovery is limited to `get`, `list`, `findProducers`, `findConsumers`. |

### 1.2 Type System

| Feature | Source | Target | Description |
|---|---|---|---|
| Structural subtyping | `type-system.md` §1 | Rejected | Nominal typing is a permanent architectural commitment, not a deferral. Two schemas with identical structure but different names are distinct types. |
| Parametrized structured types | `type-system.md` §3.2 | Post-MVP | `List[OhlcFrame]` is not allowed. Only `List[T]` where T is a primitive schema. Supporting structured type parameters would require recursive type checking. |
| Schema versioning | `type-system.md` §2.3 | Rejected | Schemas are immutable identities. A new schema version means a new name (`OhlcFrameV2`). This is deliberate, not a gap. |

### 1.3 Node Runtimes

| Feature | Source | Target | Description |
|---|---|---|---|
| Context window compaction | `node-runtimes.md` §4.2 | Post-MVP | When a reasoning node's LLM context fills up, the runtime fails with `context_exceeded`. No automatic summarization or context pruning. |
| Value handle signing | `node-runtimes.md` §5.4 | Future (multi-user) | Handles are opaque strings with no cryptographic protection. Acceptable in single-user local mode; needs signed tokens if Plurics becomes multi-user. |
| Scope-local ValueStore isolation | `node-runtimes.md` §5.3 | Phase 3b | Scope-local store is aliased to run-level store. The API surface distinguishes them but the runtime behavior is identical. True isolation (scope created at reasoning node start, destroyed at end) is deferred. |

### 1.4 Evolutionary Pool

| Feature | Source | Target | Description |
|---|---|---|---|
| Multi-population (island model) | `evolutionary-pool.md` §10 | Post-MVP | Single population per workflow run. No migration between populations, no parallel evolution. |
| Cross-run pool sharing | `evolutionary-pool.md` §10 | Post-MVP | No export/import of pool snapshots across runs. Each run starts with an empty pool (or one restored from its own interrupted snapshot). |
| Pool size limits and eviction | `evolutionary-pool.md` §10 | Post-MVP | No configurable maximum population size. No automatic eviction of low-fitness candidates. Pool grows unbounded within a run. |
| Generation boundary events | `evolutionary-pool.md` §10 | Post-MVP | No workflow-level event when a generation N ends and generation N+1 begins. Plugins track generation boundaries manually. |

### 1.5 Plugin SDK

| Feature | Source | Target | Description |
|---|---|---|---|
| Plugin sandboxing | `plugin-sdk.md` §8 | Future (multi-user) | Plugins run in the same Node.js process with full system access. No isolation, no capability restriction. Acceptable for single-user local; needs worker threads or separate processes for multi-user. |
| `onToolRegression` live wiring | `plugin-sdk.md` §7.3 | Post-MVP | The hook is defined and the type exists, but the regression testing engine that would invoke it does not exist. The hook is a commented-out stub. |

### 1.6 UI and Observability

| Feature | Source | Target | Description |
|---|---|---|---|
| Tool registry browser | `tool-registry.md` Phase 7 | Phase 7 | No REST/WebSocket endpoints for the registry. No React component for browsing, searching, or inspecting tools. |
| Converter graph visualization | `type-system.md` Phase 4e | Post-MVP | Inserted converters are tracked in the run trace but not displayed as ghost nodes in the DAG visualizer. |
| Workflow findings dashboard | `HIGH_LEVEL_DESIGN.md` §10 | Unscheduled | Findings panel exists in the frontend but aggregation, filtering, and cross-run comparison are not specified. |

---

## 2. Open Design Questions

Questions raised in design documents that have not been answered. Each requires a design decision before implementation can proceed.

### 2.1 Tool Registry

**Q1. Tool versioning propagation.** When a new version of a tool is registered while a workflow is running, does the running workflow pick up the new version immediately, or does it continue with the version it resolved at start time? Three options: (a) pin at start, (b) always-latest, (c) pin per node. Inclination is (a) but the policy is not enforced. Source: `HIGH_LEVEL_DESIGN.md` §12.

**Q2. Cross-language tool support.** Should Plurics commit to Python-only tools, or design for polyglot (Python + TypeScript + compiled binaries)? The runner protocol (`stdin JSON → subprocess → stdout JSON`) is language-agnostic in principle, but the `pickle_b64` encoding and the `PICKLE_SCHEMAS` set are Python-specific. Source: `HIGH_LEVEL_DESIGN.md` §12.

**Q3. System tools vs. workflow tools.** Some tools are universally useful (data I/O, basic stats) and should be available to every workflow. Others are domain-specific and should be opt-in. How to formalize this distinction? Currently all 80 seed tools are always available. Source: `HIGH_LEVEL_DESIGN.md` §12.

**Q4. Automatic dependency installation.** Should `RegistryClient.register()` inspect a tool's `requires` field and offer to install missing packages? Or should the registry remain dependency-agnostic and leave installation to the user? Current behavior: `requires` is informational only. Source: `tool-registry.md` §12.

### 2.2 Multi-User and Deployment

**Q5. Concurrent workflow execution.** Plurics currently assumes one workflow runs at a time. What happens if a user starts two workflows concurrently? SQLite locking, registry contention, port conflicts on localhost:11001, and signal directory races are all unaddressed. Source: `HIGH_LEVEL_DESIGN.md` §12.

**Q6. Multi-user access.** If Plurics becomes a team tool (shared server, multiple users), every trust assumption changes: plugins need sandboxing, registries need ACLs, value handles need signing, run directories need isolation. No design exists for this transition. Source: `HIGH_LEVEL_DESIGN.md` §12.

### 2.3 Persistence

**Q7. Database migration strategy.** The registry DB migrated from schema v1 to v2 (added `converters` table) using an inline `ALTER TABLE` approach. As the schema evolves further, should Plurics adopt a migration framework (e.g., numbered SQL files in a `migrations/` directory), or continue with inline migration code? Source: `persistence.md` §6.1.

**Q8. Run directory retention policy.** The design doc mentions 7-day default retention for run-level values, but no cleanup mechanism is implemented. Who deletes old runs? A cron job? A startup sweep? A manual command? Source: `node-runtimes.md` §5.3.

---

## 3. Cross-Document Inconsistencies

Places where two design documents describe the same concept differently, or where the implementation diverged from the spec without reconciliation.

### 3.1 Tool Node YAML Syntax

- **`workflow-engine.md` and `node-runtimes.md`** specify `kind: tool` nodes with a `tool: name` field and an `inputs:` block mapping port names to literal values or upstream references (`${node.outputs.port}`).
- **Current implementation** has `kind: tool` parsed by the YAML parser and dispatched by the DAG executor, but tool nodes are rare in practice. The five existing workflows use only `kind: reasoning` nodes. No real workflow exercises the `kind: tool` path end-to-end with upstream value references.
- **Impact:** The tool-node dispatch path is implemented but under-exercised. The type checker validates tool nodes at parse time, but the DAG executor's `resolveUpstreamRefs` for tool node inputs has only been tested with one integration test.

### 3.2 Signal Schema Evolution

- **`workflow-engine.md` §6.1** defines signal v1 with `outputs` as an array of `{path, sha256, size_bytes}`.
- **`node-runtimes.md` §3.3** redefines signal outputs for tool nodes as `{port, schema, value_ref, sha256, size_bytes}` — adding `port`, `schema`, and `value_ref` while deprecating `path`.
- **Current implementation** uses a hybrid: tool node signals written by the DAG executor include `value_ref` and `summary` fields; legacy reasoning node signals still use the `path`-based format.
- **Impact:** Signal consumers (the UI, the signal validator, the resume logic) must handle both formats. The `signal-validator.ts` was updated to accept both, but the design docs should be reconciled to specify a single v2 format.

### 3.3 Naming of Selection Strategies

- **`evolutionary-pool.md` §4.1** names the strategies: `top-k`, `tournament`, `roulette-wheel`, `random`.
- **Implementation** uses: `top-k`, `tournament`, `roulette`, `random` (without `-wheel` suffix).
- **Impact:** Minor naming inconsistency. The design doc should be updated to match the implementation.

### 3.4 stats.describe Output Schema

- **`seed-tools.md`** specifies `stats.describe` output as `stats: DataFrame`.
- **`tool-registry.md` §11** (original design) says the seed tool outputs `Statistics` (a dict-like schema).
- **Implementation** returns `stats: DataFrame` (matching the seed-tools.md spec).
- **Impact:** The `tool-registry.md` §11 example is outdated. The seed-tools.md spec takes precedence.

---

## 4. Undocumented Architectural Decisions

Implementation choices made during development that are not recorded in any design document but are load-bearing for the codebase's behavior.

### 4.1 CJS/ESM Compatibility via `__dirname`

**Decision:** All TypeScript source files use `__dirname` (a CommonJS global) instead of `import.meta.url` (an ESM construct) for path resolution.

**Rationale:** The `packages/server/package.json` does not declare `"type": "module"`, so `tsc` compiles to CommonJS. `import.meta.url` is invalid in CJS output and causes `tsc --noEmit` errors. However, vitest (the test runner) uses `tsx`/esbuild which compiles as ESM and provides a `__dirname` shim. Using `__dirname` satisfies both the build tool (tsc, CJS) and the test runner (vitest, ESM-shimmed).

**Impact:** If `"type": "module"` is ever added to `package.json`, `__dirname` will need to be replaced with `import.meta.url` throughout (or a polyfill). This is the reverse of the typical ESM migration path.

### 4.2 Python Interpreter Probing

**Decision:** At `RegistryClient.initialize()`, the system probes for a Python interpreter in order: `python3`, `python` (Unix) or `python`, `py` (Windows). The first that responds to `--version` is cached. For the Windows `py` launcher, `-3` is prepended to all subsequent spawn arguments.

**Rationale:** Windows does not guarantee `python` is in PATH. The `py` launcher (installed with Python from python.org) is the standard way to invoke Python on Windows. The `-3` flag selects Python 3 explicitly.

**Impact:** Tools that spawn Python subprocesses outside the registry (e.g., the runner, the test fixtures) must use the same resolved interpreter path. A mismatch could cause tools to run under a different Python version than the one the registry was initialized with.

### 4.3 Synchronous SQLite via `better-sqlite3`

**Decision:** The registry database uses `better-sqlite3`, which provides a synchronous API, rather than an async driver like `better-sqlite3/async` or `sql.js`.

**Rationale:** All registry discovery operations (`get`, `list`, `findProducers`, `findConsumers`) are fast lookups against a local SQLite file. Making them async would add complexity (promises, error handling) without performance benefit — the queries complete in microseconds. Only `register()` and `invoke()` are async (they do filesystem and subprocess I/O).

**Impact:** The synchronous API blocks the Node.js event loop during queries. For a single-user local server with tiny databases (hundreds of rows), this is undetectable. If the registry grows to thousands of tools or serves concurrent requests, the sync API could become a bottleneck.

### 4.4 Signal Files as Source of Truth

**Decision:** Node completion signals are written as JSON files to `{runDir}/signals/{signalId}.done.json`. The filesystem is the source of truth for run state; the SQLite database is a cache/index.

**Rationale:** File-based signals are inspectable with standard tools (`cat`, `jq`), survive database corruption, and make resume trivial (re-scan the signals directory). The database accelerates queries but can be reconstructed from the files.

**Impact:** Signal files accumulate in the run directory. A long-running workflow with many scoped nodes could produce thousands of signal files. No cleanup or archival mechanism exists within a run.

### 4.5 Pickle as Structured Value Transport

**Decision:** Structured values (NumpyArray, DataFrame, SymbolicExpr, etc.) are serialized as Python pickle objects, base64-encoded, and wrapped in a JSON envelope for transport between the Node.js server and Python tool subprocesses.

**Rationale:** Pickle is the only Python serialization format that handles arbitrary objects (trained models, SymPy expressions, sparse matrices) without requiring per-type serializers. JSON cannot represent these; Arrow/Parquet are too narrow; Protocol Buffers would require schema definitions for every type.

**Impact:** Pickle is inherently insecure against untrusted data (arbitrary code execution on deserialization). The threat model assumes tools are trusted (authored by the user or from seed). If tools from untrusted sources enter the registry, pickle deserialization becomes a security risk. Pickle also ties the registry to CPython (other Python implementations may not pickle-compatible).

### 4.6 Run-Level ValueStore as In-Memory Map

**Decision:** The value store holds structured values in a Node.js `Map<string, StoredValue>` in the server process's memory. Values are flushed to disk (`runs/{runId}/values/{handle}.json`) on node completion and loaded on demand during resume.

**Rationale:** In-memory storage avoids the latency of reading large pickle blobs from disk on every tool call within a reasoning node's loop. The flush-on-completion design ensures durability for resume without impacting hot-path performance.

**Impact:** Memory consumption grows with the number of structured values produced during a run. A workflow that produces hundreds of large DataFrames could exhaust server memory. No eviction policy exists.

---

## 5. Missing Design Documents

Documents referenced in existing design docs but not yet written.

| Document | Referenced by | Purpose |
|---|---|---|
| `docs/design/overview.md` | Every design doc's "Parent document" field | System-level architecture overview. Currently `HIGH_LEVEL_DESIGN.md` serves this role, but some docs reference `overview.md` by name. Decide whether to rename `HIGH_LEVEL_DESIGN.md` to `overview.md` or update references. |
| `docs/design/ui.md` | `HIGH_LEVEL_DESIGN.md` §10, `persistence.md` | Frontend architecture: React component tree, WebSocket protocol, REST API surface, DAG visualizer, findings panel, tool browser, workflow controls. |
| `docs/guides/writing-workflows.md` | `HIGH_LEVEL_DESIGN.md` §13 | User-facing tutorial: how to write a workflow YAML, define presets, write a plugin, run and debug. |
| `docs/guides/building-tools.md` | `HIGH_LEVEL_DESIGN.md` §13 | User-facing tutorial: how to write a tool.yaml + tool.py, register it, test it, use it from a workflow. |

---

## 6. Technical Debt

No `TODO`, `FIXME`, `HACK`, or `XXX` comments were found in the TypeScript or Python source code. Technical debt is tracked implicitly through the deferred features listed above rather than through inline code markers.

Known structural debt (not marked in code):

- **Five workflow plugin files** reference the old `backend: claude-code` in their YAML but have migrated plugin.ts files. The YAML files should be audited to confirm all `backend:` values are updated to the new backend names.
- **`docs/architecture.md`** is a legacy file from the CAAM origin. It predates all current design docs and may contain outdated or contradictory information. It should be either deleted or marked as historical.
- **`package-lock.json` in worktrees** — Windows file locks from `better-sqlite3` native bindings prevent clean worktree removal. The orphaned `.worktrees/` directories require manual cleanup after the locking process exits.

---

## 7. Test Coverage Analysis

| Area | Unit Tests | Integration Tests | E2E Tests | Notes |
|---|---|---|---|---|
| Registry core (manifest, storage, schemas) | Strong | Strong | N/A | 102+ tests |
| Executor (subprocess, encoding, value store) | Strong | Strong (with Python) | N/A | Exercises all error categories |
| Seed tools | Per-tool `tests.py` (77 files) | Category-level integration | N/A | tests.py uses `invoke_tool` convention; not wired to automated runner |
| Type system (parser, checker, converters) | Strong | Converter insertion e2e | N/A | 28 type-parser + 17 checker + converter tests |
| Agent backends (claude, openai-compat, ollama) | Mocked fetch | N/A | N/A | No real LLM calls in tests |
| Reasoning runtime (tool-calling loop) | Fully mocked | N/A | N/A | 9+ tests covering loop, retry budget, max turns, signal parsing |
| Plugin SDK | 17 tests | N/A | N/A | Covers declareTools, onToolProposal, error handling |
| Evolutionary pool | 50 tests | N/A | N/A | Covers all 8 compliance items |
| Workflow engine (DAG executor) | Moderate | Tool-node chain | N/A | State machine transitions under-tested; fan-out under-tested |
| Resume protocol | Minimal | N/A | N/A | No test creates a run, interrupts it, and resumes |
| Frontend (React) | Unknown | Unknown | Unknown | Not audited in this session |

**Key gap:** No end-to-end test that starts a real workflow with a real LLM backend, reasoning nodes calling registered tools, and produces a signal-based outcome. All reasoning tests use mocked backends.

---

## 8. Operational Gaps

### Deployment

- **No containerization.** No Dockerfile, no docker-compose, no container registry. Plurics runs directly on the host OS.
- **No process management.** No systemd unit, no PM2 config, no supervisor script. The server is started via `npm run dev` or `tsx watch`.
- **No upgrade path.** No migration guide for moving from one Plurics version to the next. Database schema migrations are inline code, not versioned migration files.

### CI/CD

- **No GitHub Actions workflow.** Tests are run locally. No automated CI pipeline validates PRs, runs the test suite, or checks `tsc --noEmit`.
- **No seed tool validation pipeline.** The 80 seed tools are registered at startup but their Python tests (`tests.py`) are never run automatically. The `invoke_tool` convention requires a test runner that does not exist.

### Monitoring

- **No structured logging standard.** The plugin SDK writes JSONL to `plugin-log.jsonl`, but the server itself uses `console.log`. No unified logging format, no log rotation, no log aggregation.
- **No metrics.** No Prometheus/StatsD/OpenTelemetry integration. No counters for tool invocations, LLM calls, signal latency, or pool operations.
- **No health check beyond `/api/health`.** The health endpoint returns `{status: 'ok'}` but does not verify registry availability, Python interpreter health, or database connectivity.

---

## 9. Relationship Between Design Docs and Implementation Phases

For reference, here is the mapping from design docs to implementation phases as executed in this session:

| Design Document | Implementation Phases | Status |
|---|---|---|
| `tool-registry.md` | TR Phase 1-2 (core), TR Phase 3 (seeds), TR Phase 4 (type system) | Done |
| `node-runtimes.md` | NR Phase 1 (backends), NR Phase 2 (value store), NR Phase 3 (tool-calling) | Done |
| `type-system.md` | TR Phase 4a-4e | Done |
| `seed-tools.md` | TR Phase 3 pilot + full + compliance | Done |
| `plugin-sdk.md` | Plugin SDK compliance (refactor + 3 new hooks) | Done |
| `workflow-engine.md` | Pre-existing (core engine), verified in audit | Done (~90%) |
| `evolutionary-pool.md` | Evo pool compliance (8 gaps fixed) | Done (~95%) |
| `persistence.md` | Partially pre-existing, partially deferred | Partial |
| `HIGH_LEVEL_DESIGN.md` | Overarching — no single phase | Reference |
| `MANIFESTO.md` | Architectural commitment — verified operationally | Reference |

---

*This document is the authoritative inventory of what remains to be done in Plurics. It should be updated whenever a deferred feature is implemented, an open question is resolved, or a new gap is discovered. The next reader of this document should be able to reconstruct the full state of the project's outstanding work from this file alone.*
