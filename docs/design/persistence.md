# Plurics Persistence — Design Document

**Version:** 0.1 (draft)
**Status:** Mostly descriptive — filesystem layout and `plurics.db` are implemented; `registry.db` and migrations infrastructure pending TR Phase 4-6
**Scope:** Filesystem layout, SQLite schemas, run directory structure, retention, migrations, backup guidance
**Parent document:** `docs/design/overview.md` Section 9
**Related documents:** `docs/design/workflow-engine.md`, `docs/design/tool-registry.md`, `docs/design/evolutionary-pool.md`, `docs/design/node-runtimes.md`

---

## 1. Introduction and Scope

Persistence is what makes Plurics workflows recoverable, traceable, and reproducible over time. Without durable storage of workflow runs, tool registry contents, and platform metadata, every Plurics session would be ephemeral: a crash would lose hours of LLM work, a restart would erase the registry, and yesterday's findings would be inaccessible today. The persistence subsystem exists to ensure that none of this happens.

This document specifies the persistence subsystem at the level of filesystem layout, database schemas, file formats, retention policies, schema migrations, and backup guidance. It is the authoritative reference for *where* things live on disk and *how* they are organized. For *what* a particular file contains in detail (e.g., the internal structure of a signal file or a pool snapshot), this document refers to the subsystem documents that own those formats.

The persistence subsystem touches every other component of Plurics: the workflow engine writes signal files and snapshots, the node runtimes write value store entries, the evolutionary pool writes pool snapshots, the tool registry writes tool directories and database entries, the UI reads run history and current state. This document does not duplicate the format specifications for each of these — it specifies the storage layer that holds them and the conventions they all follow.

The subsystem is split across two filesystem locations and two SQLite databases:

**`~/.plurics/`** is the user-level Plurics directory, containing the platform database (`plurics.db`), the tool registry (`registry/`), and global configuration. It exists once per user.

**`{workspace}/.plurics/`** is the workspace-level directory, containing the runs for workflows executed in that workspace. It exists once per workspace, where a workspace is typically a project directory the user has been working in.

This split is deliberate: the platform database and the tool registry are global to the user (they should be available regardless of which workspace is active), while runs are local to the workspace where they were generated (they belong with the project they investigated). The split is also visible in the UI: the user can switch between workspaces, but the registry and the workspace history follow them.

## 2. Filesystem Layout

This section specifies the complete filesystem layout used by Plurics. Every file and directory the platform creates or reads has its place documented here.

### 2.1 The User-Level Directory

```
~/.plurics/
├── plurics.db                      # Main platform SQLite database
├── plurics.db.wal                  # SQLite WAL journal (transient)
├── plurics.db.shm                  # SQLite shared memory (transient)
├── config.json                     # Global Plurics configuration
├── registry/                       # Tool Registry root
│   ├── registry.db                 # Tool Registry SQLite database
│   ├── registry.db.wal
│   ├── registry.db.shm
│   ├── tools/                      # Tool storage
│   │   ├── pandas.load_csv/
│   │   │   └── v1/
│   │   │       ├── tool.yaml
│   │   │       ├── tool.py
│   │   │       ├── tests.py
│   │   │       └── README.md
│   │   ├── sklearn.pca/
│   │   │   ├── v1/...
│   │   │   └── v2/...
│   │   └── ...
│   ├── schemas/                    # Schema definitions
│   │   ├── OhlcFrame.yaml
│   │   ├── DataFrame.yaml
│   │   └── ...
│   ├── converters/                 # Converter tools (special tools)
│   │   ├── convert.DataFrame_to_NumpyArray/
│   │   │   └── v1/...
│   │   └── ...
│   ├── cache/                      # Optional invocation cache (post-MVP)
│   │   └── ...
│   └── logs/
│       ├── registration.log        # Append-only registration history
│       └── invocations.log         # Optional sampled invocation log
├── presets/                        # Global presets shared across projects
│   ├── conjecturer.md
│   ├── critic.md
│   └── ...
├── migrations/                     # Schema migration scripts
│   ├── plurics/
│   │   ├── 001_initial.sql
│   │   ├── 002_add_workflow_events.sql
│   │   └── ...
│   └── registry/
│       ├── 001_initial.sql
│       └── ...
└── logs/                           # Platform-level logs (not run-specific)
    ├── server.log
    └── errors.log
```

The user-level directory is created on first launch of Plurics. The contents are populated incrementally: `plurics.db` is created with its initial schema, `registry/` is bootstrapped with the seed tools and schemas (after TR Phase 3), and the other subdirectories are created as needed.

Most of this layout exists today in the current codebase. The portions that are pending implementation are marked in the implementation status section at the end of this document. The most significant pending pieces are the entire `registry/` subtree (TR Phase 4) and the `migrations/` directory with its versioning infrastructure.

### 2.2 The Workspace-Level Directory

A workspace is any directory where the user has used Plurics. The first time Plurics is invoked in a directory, it creates `.plurics/` inside it and registers the directory as a workspace in the user-level database. Subsequent invocations in the same directory reuse the same workspace.

```
{workspace}/.plurics/
├── runs/                           # All run records for this workspace
│   ├── run-20260420T143055-001/    # One subdirectory per run
│   │   ├── run-metadata.json
│   │   ├── workflow.yaml.snapshot  # Copy of the workflow YAML at run start
│   │   ├── plugin.ts.snapshot      # Copy of the plugin (if present)
│   │   ├── node-states.json        # DAG snapshot for resume
│   │   ├── pool-state.json         # Pool snapshot if workflow uses pool
│   │   ├── purposes/               # Generated purposes per attempt
│   │   │   ├── conjecturer-1.md
│   │   │   ├── conjecturer-2.md   # Retry
│   │   │   └── ...
│   │   ├── logs/                   # Per-node stdout/stderr captures
│   │   │   ├── conjecturer-1.log
│   │   │   ├── prover-1.log
│   │   │   └── ...
│   │   ├── signals/                # Signal files emitted by nodes
│   │   │   ├── conjecturer-root-1-a3f2.json
│   │   │   ├── prover-scope1-1-b7e1.json
│   │   │   └── ...
│   │   ├── values/                 # Value store entries (run-level)
│   │   │   ├── vs-...-load_data-df-...pkl.b64
│   │   │   └── ...
│   │   ├── findings/               # Finding documents (workflow output)
│   │   │   ├── finding-001.md
│   │   │   └── ...
│   │   ├── handoffs/               # Plugin-written handoff files
│   │   │   ├── confirmed-findings.md
│   │   │   ├── rejection-reasons.md
│   │   │   └── ...
│   │   └── plugin-state/           # Plugin's persistent state (free-form)
│   │       └── ...
│   ├── run-20260420T151210-002/
│   │   └── ...
│   └── run-20260421T093015-003/
│       └── ...
└── workspace.json                  # Workspace-level metadata
```

The workspace directory is lightweight by design: it contains only run records, with no databases of its own. Run history queries that span the workspace go through `plurics.db` (which has a `workflow_runs` table indexed by workspace), and the run directories are loaded on demand when the user wants to inspect details.

**`workspace.json`** holds workspace-level metadata: the workspace name, when it was first used, and any workspace-specific configuration overrides. It is small and updated rarely.

**`runs/`** contains all run records for the workspace. Each subdirectory is a complete record of one workflow run, named with a sortable timestamp prefix and a numeric suffix for disambiguation when multiple runs start in the same second.

### 2.3 The Run Directory

The run directory is the heart of workspace persistence. It is the unit of observability, the unit of resumability, and the unit of preservation. A run directory is self-contained: if everything else were lost, the run directory alone would be sufficient to reconstruct what happened during the run.

The contents of a run directory:

**`run-metadata.json`**: high-level run information. The schema is specified in Section 4.1. Updated at run start, on significant milestones, and at run completion.

**`workflow.yaml.snapshot`**: a copy of the workflow YAML as it was at the time the run started. This is critical for resume integrity (the run resumes against the same workflow definition it started with) and for traceability (a year from now, the user can see exactly what workflow produced these results, even if the workflow file has been edited since).

**`plugin.ts.snapshot`**: a copy of the plugin file at run start, for the same reasons as the YAML snapshot. Optional — only present if the workflow has a plugin.

**`node-states.json`**: the DAG snapshot used by the workflow engine for resume. Format specified in `docs/design/workflow-engine.md` Section 4.3 and Section 8.1. Written after every state transition.

**`pool-state.json`**: the evolutionary pool snapshot, if the workflow uses a pool. Format specified in `docs/design/evolutionary-pool.md` Section 6.1. Written after every pool modification.

**`purposes/`**: every purpose prompt generated for every node invocation. File naming `{nodeName}-{attempt}.md` for non-scoped nodes, `{nodeName}-{scope}-{attempt}.md` for scoped nodes. These are markdown files containing the full prompt as sent to the LLM, including the static preset and the plugin enrichment. Purposes are append-only — a retry creates a new file, the previous one is preserved.

**`logs/`**: stdout and stderr captures for each node invocation. File naming follows the same pattern as purposes. For tool nodes, this contains the Python subprocess output. For reasoning nodes, this contains the LLM API request/response trace and any debug output from the runtime layer.

**`signals/`**: the signal files emitted by nodes. Format specified in `docs/design/workflow-engine.md` Section 6.1. File naming `{nodeName}-{scope_or_root}-{attempt}-{shortHash}.json`. Signal files are append-only and never modified after writing.

**`values/`**: the run-level value store. Each file holds one structured value produced by a tool invocation, encoded as base64-encoded pickle (or alternative encoding declared in the tool manifest). File naming `{handle}.pkl.b64` where `handle` is the value store handle from `docs/design/node-runtimes.md` Section 5. Values are pruned according to retention policy (Section 6).

**`findings/`**: the user-visible outputs of the workflow. Format is workflow-specific (typically markdown for human readability, with a YAML front-matter for metadata). Findings are the highest-value output of a run and are preserved indefinitely.

**`handoffs/`**: files written by the plugin via `accept_with_handoff` signal decisions. These are domain-specific files that downstream nodes consume. Format and naming are workflow-specific.

**`plugin-state/`**: a free-form directory where the plugin can persist its own state. The platform does not impose structure here — the plugin reads and writes files as it needs. This is the recommended location for plugin state that needs to survive resume.

The run directory's invariant is **traceability**: every important fact about a run is captured here, in human-readable form when possible, in a stable format always. The database (`plurics.db`) holds indexes and metadata for fast queries; the filesystem holds the substance.

## 3. The Platform Database (`plurics.db`)

`plurics.db` is the SQLite database at `~/.plurics/plurics.db`. It holds platform-level state: workspaces the user has used, agent presets registered globally, workflow run metadata and history, and an audit log of workflow events. It is small, fast, and needs no administration.

The database is opened with WAL (Write-Ahead Logging) mode for concurrent read access while writes are in progress. SQLite is suitable for this use case: Plurics is single-user locally, the data volume is small (tens of thousands of rows even for active users), and the operational cost of running a real database server would dwarf any benefit.

### 3.1 Schema Overview

The database has six tables. The descriptions below specify the columns, types, and indexes; the exact CREATE TABLE statements are in `~/.plurics/migrations/plurics/001_initial.sql` (verify against current implementation).

**`schema_versions`**: tracks the current schema version for migration purposes.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `version` | INTEGER | PRIMARY KEY | Current schema version number |
| `applied_at` | TEXT | NOT NULL | ISO 8601 UTC timestamp |
| `description` | TEXT | | Human-readable description of the version |

The table contains exactly one row at any time. On startup, Plurics reads the version, compares it to the version it expects, and runs migrations if there is a mismatch (Section 7).

**`workspaces`**: registers all directories where Plurics has been used.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal ID |
| `path` | TEXT | NOT NULL UNIQUE | Absolute path to the workspace directory |
| `name` | TEXT | | Optional friendly name (defaults to basename of path) |
| `created_at` | TEXT | NOT NULL | When the workspace was first registered |
| `last_accessed` | TEXT | NOT NULL | When the workspace was last opened in Plurics |
| `is_active` | INTEGER | NOT NULL DEFAULT 1 | 0 if the workspace is hidden from the UI |

Index on `last_accessed` for the UI's "recent workspaces" list. Index on `path` for lookup by directory.

**`agent_presets`**: registers reusable preset templates that can be referenced from workflows across projects.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal ID |
| `name` | TEXT | NOT NULL UNIQUE | Preset name (e.g., "conjecturer") |
| `version` | INTEGER | NOT NULL | Preset version |
| `content` | TEXT | NOT NULL | The preset markdown |
| `description` | TEXT | | Human-readable description |
| `category` | TEXT | | Category for organization (e.g., "research", "verification") |
| `created_at` | TEXT | NOT NULL | When the preset was registered |
| `updated_at` | TEXT | NOT NULL | When the preset was last updated |

Index on `name` for lookup. Index on `category` for filtering in the UI.

The current implementation may store presets as files rather than in the database, with the database containing only references and metadata. Verify against current code.

**`workflow_runs`**: the run history. One row per run.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `run_id` | TEXT | PRIMARY KEY | Run identifier (e.g., "run-20260420T143055-001") |
| `workspace_id` | INTEGER | NOT NULL REFERENCES workspaces(id) | The workspace this run belongs to |
| `workflow_name` | TEXT | NOT NULL | The workflow that was run |
| `workflow_version` | INTEGER | NOT NULL | The workflow version at run time |
| `started_at` | TEXT | NOT NULL | When the run started |
| `completed_at` | TEXT | | When the run finished (NULL if still running or interrupted) |
| `status` | TEXT | NOT NULL | "running", "completed", "failed", "aborted", "interrupted" |
| `nodes_total` | INTEGER | | Total nodes in the workflow (set after parsing) |
| `nodes_completed` | INTEGER | NOT NULL DEFAULT 0 | Nodes in `completed` state |
| `nodes_failed` | INTEGER | NOT NULL DEFAULT 0 | Nodes in `failed` state |
| `findings_count` | INTEGER | NOT NULL DEFAULT 0 | Number of findings produced |
| `duration_seconds` | REAL | | Total duration (set on completion) |
| `run_directory` | TEXT | NOT NULL | Absolute path to the run directory |

Index on `workspace_id` for workspace-scoped queries. Index on `(workflow_name, started_at)` for "recent runs of workflow X". Index on `status` for filtering by state.

The columns are updated as the run progresses: `nodes_completed` and `nodes_failed` are incremented as state transitions happen, `findings_count` is incremented when findings are produced, `completed_at` and `duration_seconds` are set when the run terminates. The `status` field follows the workflow engine's high-level state.

**`workflow_events`**: an audit log of significant events during workflow execution. Used for diagnostics and for the UI's event timeline.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Event ID |
| `run_id` | TEXT | NOT NULL REFERENCES workflow_runs(run_id) | The run this event belongs to |
| `node_name` | TEXT | | The node involved (NULL for run-level events) |
| `scope` | TEXT | | The scope (NULL for non-scoped) |
| `event_type` | TEXT | NOT NULL | Event category (see below) |
| `event_data` | TEXT | | JSON-encoded event-specific data |
| `timestamp` | TEXT | NOT NULL | ISO 8601 UTC |

Index on `(run_id, timestamp)` for time-ordered event queries within a run. Index on `(run_id, node_name)` for node-specific event queries.

Event types include: `workflow_started`, `workflow_completed`, `workflow_failed`, `workflow_aborted`, `node_state_transition`, `signal_received`, `signal_validated`, `signal_rejected`, `tool_invoked`, `tool_failed`, `plugin_hook_invoked`, `plugin_hook_failed`, `value_stored`, `value_retrieved`, `destructive_change_detected`, `artifacts_invalidated`, `pin_updated`, `version_policy_applied`. Each type has a conventional structure for `event_data` documented in the workflow engine and other component docs.

The `destructive_change_*` and `artifacts_invalidated` events are emitted by the destructive change protocol (see `docs/design/tool-registry.md` §8.4.3) to record the automatic invalidation of findings and pool candidates in response to tool version changes. Their `event_data` includes the affected tool name, old and new versions, the number of findings and candidates invalidated, and the policy action that was applied.

The `workflow_events` table can grow large for long-running workflows. The current implementation does not enforce a size limit; the retention policy (Section 6) addresses this.

**`workflow_findings`**: an index of findings produced across all runs, for fast lookup and cross-run queries.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Finding ID |
| `run_id` | TEXT | NOT NULL REFERENCES workflow_runs(run_id) | The run that produced this finding |
| `node_name` | TEXT | NOT NULL | The node that produced it |
| `scope` | TEXT | | The scope (if applicable) |
| `verdict` | TEXT | NOT NULL | "confirmed", "falsified", "inconclusive" |
| `summary` | TEXT | | Short human-readable summary |
| `file_path` | TEXT | NOT NULL | Path to the finding file in the run directory |
| `created_at` | TEXT | NOT NULL | When the finding was produced |

Index on `(run_id)` for retrieving findings of a specific run. Index on `(verdict, created_at)` for "recent confirmed findings across all runs".

The full content of the finding lives in the file at `file_path`; the database row is just an index entry.

### 3.2 Database Operations

The database is accessed through a small data access layer (the current implementation likely uses better-sqlite3 or a similar synchronous SQLite library — verify). The operations exposed include:

- CRUD on workspaces, presets, run records
- Append-only insertion into events and findings
- Query operations for the UI: list runs by workspace, list recent runs, list findings by verdict, get event timeline for a run
- Aggregate operations: count of runs by workflow, success rate of a workflow over time

All write operations are performed in transactions for consistency. Reads are served from the WAL snapshot, allowing concurrent access from the UI while writes are in progress. The database file rarely exceeds a few megabytes for typical use even after months of activity, because the bulk of run data lives in the run directories on the filesystem.

## 4. The Run Metadata Format

`run-metadata.json` is the small file at the root of each run directory that holds the run's identifying information and aggregate state. It is read frequently (the UI reads it for every run in the workspace history) and written infrequently (only at start, on milestones, and at completion).

### 4.1 Schema

```json
{
  "schema_version": 1,
  "run_id": "run-20260420T143055-001",
  "workflow_name": "math-discovery",
  "workflow_version": 2,
  "workspace_path": "/home/alessandro/projects/eurusd-research",
  "started_at": "2026-04-20T14:30:55.123Z",
  "completed_at": "2026-04-20T17:42:18.456Z",
  "status": "completed",
  "config": {
    "data_source": "./data/eurusd_5m.parquet",
    "max_rounds": 5,
    "pool_size": 50
  },
  "resolved_tools": {
    "pandas.load_parquet": 1,
    "stats.adf_test": 1,
    "sklearn.pca": 2,
    "lean.compile": 3
  },
  "summary": {
    "nodes_total": 47,
    "nodes_completed": 47,
    "nodes_failed": 0,
    "nodes_skipped": 0,
    "findings_count": 3,
    "tool_invocations": 184,
    "total_tokens": 412580,
    "duration_seconds": 11483.0
  },
  "interruption_history": [
    {
      "interrupted_at": "2026-04-20T15:12:03.000Z",
      "resumed_at": "2026-04-20T15:14:55.000Z",
      "reason": "platform_crash"
    }
  ]
}
```

Most fields are self-explanatory. A few deserve comment:

The `interruption_history` field records every interruption and resume the run experienced. Empty for runs that completed without incident. Useful for diagnosing flaky workflows or platform issues.

The `summary` field is the running aggregate. It is updated as state transitions happen, not just at completion. A reader of this file at any point sees the current totals — useful for the UI's at-a-glance view.

The `config` field is a snapshot of the workflow YAML's `config` block at run start. This is duplicated from `workflow.yaml.snapshot` for convenience: most readers don't want to parse the full YAML just to see the config values.

The `resolved_tools` field maps tool names to their pinned version numbers for this run. It is populated at workflow parse time according to the workflow's `version_policy.resolution` setting (see `docs/design/tool-registry.md` §8.4.1). Tools declared in `version_policy.dynamic_tools` are *not* included in this map — they are resolved at dispatch time on each invocation. The `resolved_tools` map is mutable during a run only as a result of the destructive change protocol (§8.4.3), which updates individual entries when a pinned tool's version is changed due to a destructive change with `action: invalidate_and_continue`.

### 4.2 Update Frequency

`run-metadata.json` is updated at:

- Run start (initial write)
- Every state transition that changes a `summary` field (`nodes_completed`, `nodes_failed`, `findings_count`, `tool_invocations`, `total_tokens`)
- Run completion (final write with `completed_at`, `status`, final `summary`)
- Resume start and end (appending to `interruption_history`)

The writes are atomic (write to temp file, rename) for the same reasons as the workflow engine's snapshot writes (Section 4.3 of the workflow engine doc). The frequency is moderate — typically a few writes per minute during active execution — and the cost is negligible.

## 5. The Registry Database (`registry.db`)

`registry.db` is the SQLite database at `~/.plurics/registry/registry.db`. It is the index over the tool registry filesystem, providing fast lookup, search, and dependency tracking for tools, schemas, and converters.

The full schema is specified in `docs/design/tool-registry.md` Section 4 (filesystem layout) and is implemented in TR Phase 1. This section provides the schema reference in the same format as Section 3.

### 5.1 Schema

The database has six tables, plus the same `schema_versions` table as `plurics.db`.

**`tools`**: the canonical tool index.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `name` | TEXT | NOT NULL | Tool name (e.g., "sklearn.pca") |
| `version` | INTEGER | NOT NULL | Version number |
| `description` | TEXT | NOT NULL | Tool description from manifest |
| `category` | TEXT | | Category for filtering |
| `tags` | TEXT | | Comma-separated tags |
| `language` | TEXT | NOT NULL | "python" for all current tools |
| `entry_point` | TEXT | NOT NULL | Reference to the implementation entry |
| `is_converter` | INTEGER | NOT NULL DEFAULT 0 | 1 if this is a converter |
| `cacheable` | INTEGER | NOT NULL DEFAULT 0 | 1 if invocations are cacheable |
| `cost_class` | TEXT | | "fast", "medium", "slow" |
| `stability` | TEXT | NOT NULL DEFAULT 'stable' | "experimental", "stable", "deprecated", "archived" |
| `tool_hash` | TEXT | NOT NULL | SHA-256 of the tool directory contents |
| `created_at` | TEXT | NOT NULL | When this version was registered |
| `created_by` | TEXT | NOT NULL | "seed", "human", or "agent:{workflow_run_id}" |
| PRIMARY KEY | (name, version) | | |

Index on `name` for lookup of all versions of a tool. Index on `category` for category browsing. Index on `is_converter` for fast converter lookup.

**`tool_ports`**: the input and output ports of each tool.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `tool_name` | TEXT | NOT NULL | Tool name |
| `tool_version` | INTEGER | NOT NULL | Tool version |
| `port_name` | TEXT | NOT NULL | Port name |
| `direction` | TEXT | NOT NULL | "input" or "output" |
| `schema` | TEXT | NOT NULL | Schema name (from the type system) |
| `required` | INTEGER | NOT NULL DEFAULT 1 | 1 for required, 0 for optional |
| `default_value` | TEXT | | JSON-encoded default value, NULL if no default |
| `description` | TEXT | | Human-readable port description |
| `position` | INTEGER | NOT NULL | Order within the manifest |
| FOREIGN KEY | (tool_name, tool_version) REFERENCES tools | | |

Index on `(tool_name, tool_version, direction)` for retrieving all inputs or all outputs of a specific tool. Index on `schema` for `findProducers` and `findConsumers` queries.

**`schemas`**: the schema definitions.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `name` | TEXT | PRIMARY KEY | Schema name |
| `kind` | TEXT | NOT NULL | "primitive" or "structured" |
| `python_representation` | TEXT | NOT NULL | The Python type at runtime |
| `description` | TEXT | NOT NULL | Schema description |
| `validator_module` | TEXT | | Path to optional validator |
| `validator_function` | TEXT | | Function name in the validator module |
| `summarizer_module` | TEXT | | Path to optional summarizer |
| `summarizer_function` | TEXT | | Function name in the summarizer module |
| `is_builtin` | INTEGER | NOT NULL DEFAULT 0 | 1 for built-in schemas, 0 for user-defined |
| `created_at` | TEXT | NOT NULL | When the schema was registered |

Index on `kind` and `is_builtin` for filtering.

**`converters`**: the converter index, keyed by source and target schemas.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `source_schema` | TEXT | NOT NULL | Source schema name |
| `target_schema` | TEXT | NOT NULL | Target schema name |
| `tool_name` | TEXT | NOT NULL | The converter tool's name |
| `tool_version` | INTEGER | NOT NULL | The converter tool's version |
| `created_at` | TEXT | NOT NULL | When this converter was registered |
| PRIMARY KEY | (source_schema, target_schema) | | |
| FOREIGN KEY | (tool_name, tool_version) REFERENCES tools | | |

The primary key on `(source_schema, target_schema)` enforces that there is at most one converter per pair (the latest registered wins, though older converters are still in the `tools` table for archival).

**`tool_dependencies`**: tracks which schemas a tool depends on (its port schemas).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `tool_name` | TEXT | NOT NULL | Tool name |
| `tool_version` | INTEGER | NOT NULL | Tool version |
| `schema_name` | TEXT | NOT NULL | Schema this tool depends on |
| `usage` | TEXT | NOT NULL | "input" or "output" |
| FOREIGN KEY | (tool_name, tool_version) REFERENCES tools | | |
| FOREIGN KEY | (schema_name) REFERENCES schemas | | |

This table is a denormalization of `tool_ports` for fast queries like "which tools depend on schema X" — useful when a schema is being deprecated or when computing a tool's full dependency graph.

**`tool_invocations`** (optional, populated only when invocation logging is enabled): records each tool invocation.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| `tool_name` | TEXT | NOT NULL | |
| `tool_version` | INTEGER | NOT NULL | |
| `run_id` | TEXT | | The run this invocation was part of (NULL for ad-hoc invocations) |
| `node_name` | TEXT | | |
| `scope` | TEXT | | |
| `inputs_hash` | TEXT | NOT NULL | SHA-256 of the inputs (for cache lookup) |
| `outputs_hash` | TEXT | | SHA-256 of the outputs |
| `duration_ms` | INTEGER | NOT NULL | |
| `success` | INTEGER | NOT NULL | 1 for success, 0 for failure |
| `error_category` | TEXT | | If failed, the error category |
| `invoked_at` | TEXT | NOT NULL | |

Index on `(tool_name, tool_version, invoked_at)` for "recent invocations of tool X". Index on `(inputs_hash)` for cache lookup. Index on `run_id` for run-scoped queries.

This table can grow large quickly when invocation logging is enabled. The current MVP does not enable it by default; it is opt-in via configuration. When enabled, the retention policy (Section 6) applies aggressively.

The `tool_invocations` table is consulted by the destructive change protocol (see `docs/design/tool-registry.md` §8.4.3) to identify which workflow runs have invoked a tool that is receiving a destructive change. For this reason, enabling invocation logging is recommended for any Plurics installation that uses workflows with `version_policy.on_destructive_change.scope: contaminated`, because the `contaminated` scope relies on implicit dependency tracking that reads from this table. When invocation logging is disabled, the protocol falls back to scanning per-run signal files and value store metadata, which is slower but functionally equivalent.

### 5.2 Why Two Databases

The choice to keep `plurics.db` and `registry.db` separate, rather than merging them into one database, is deliberate and based on three considerations:

**Different lifecycles.** The platform database changes constantly (every run adds events, every workflow updates run metadata). The registry database changes rarely (tools are registered occasionally, and never modified once registered). Mixing these two access patterns in one database is suboptimal: the WAL grows fast for one set of writes while the other set is mostly read.

**Different sharing models.** The registry is potentially shareable across machines or users (a future export/import feature is planned). The platform database is strictly per-user-per-machine. Keeping them separate makes the registry's standalone nature explicit and simplifies any future sharing implementation.

**Different operational concerns.** The platform database is small and can be safely deleted to reset Plurics state without losing tools (the registry survives). The registry is potentially large (with hundreds of tools) and represents accumulated user investment. Recovery scenarios for the two are different.

The cost of two databases is minimal: SQLite handles them independently, the connection pool overhead is negligible, and the conceptual clarity outweighs the small operational complexity.

## 6. Retention and Cleanup

Plurics generates a lot of data over time. Without retention policies, a long-running installation would accumulate gigabytes of run directories, log files, and event records. This section specifies what gets cleaned up automatically and what is preserved indefinitely.

### 6.1 General Principle

The retention policy is **conservative**: preserve everything by default, prune only what is clearly safe to lose. The reasoning is that local disk is cheap, and Plurics is a research tool where the value of data is often discovered later. A user investigating last month's findings should not have to fight with an aggressive cleanup policy that deleted intermediate artifacts.

The policy can be tightened by user configuration. Users with limited disk space, or users running many workflows per day, can opt into more aggressive cleanup. The defaults are appropriate for typical research use.

### 6.2 Run Directories

Run directories are preserved indefinitely by default. They are the canonical record of what Plurics did, and they are the user's primary asset.

The user can configure a maximum age for run directories via `~/.plurics/config.json`:

```json
{
  "retention": {
    "run_max_age_days": 90,
    "run_max_count_per_workspace": 1000
  }
}
```

When either limit is reached, the oldest runs are pruned. The pruning is not silent: a notification appears in the UI before runs are deleted, and the user must confirm. There is no automatic deletion without confirmation.

Runs can also be manually deleted from the UI. Deletion removes the run directory and the corresponding rows from `workflow_runs`, `workflow_events`, and `workflow_findings`. The action is irreversible (no trash, no undo) but is gated behind a confirmation dialog.

### 6.3 Value Store Entries

Value store entries (the files in `runs/{runId}/values/`) are pruned more aggressively than other run artifacts because they are typically large and rarely needed after a run completes.

The default policy:

- During the run: all value store entries are kept.
- After run completion: small entries (under 1 MB each) are kept indefinitely; large entries are kept for 7 days, then pruned.
- After 30 days: all value store entries are pruned regardless of size, unless they are referenced by findings that are still active.

The pruning is performed by a periodic background task in the Plurics server. The task runs once per day and walks the run directories looking for prunable files. Prunable files are removed; their existence in the database (if any) is updated with a `pruned_at` timestamp so that downstream queries can distinguish "the file existed but was pruned" from "the file was never created."

A user who needs to recover a pruned value can re-run the workflow that produced it. The signal records and the reasoning traces are still available; only the materialized large values are gone.

### 6.4 Logs and Event Records

Per-node log files in `runs/{runId}/logs/` are preserved with the run directory. They are typically small (text output) and have high diagnostic value when debugging.

The `workflow_events` table can grow large. The default retention is:

- Events for runs with status `running` or `interrupted`: preserved indefinitely (the run might be resumed)
- Events for runs with status `completed`, `failed`, or `aborted`: preserved for 90 days, then aggregated into a summary entry and the individual events deleted

Aggregation reduces 1000+ events for a long run down to a single summary record with totals. The detailed events are gone but the high-level information is preserved.

Platform-level logs in `~/.plurics/logs/` are rotated using standard log rotation: daily rotation, 14 days of history, gzipped after rotation. This is implemented by the Node.js logger configuration, not by custom Plurics code.

### 6.5 Tool Registry

Tools, schemas, and converters in `~/.plurics/registry/` are **never automatically pruned**. Each version of each tool is preserved indefinitely. Even tools marked as `deprecated` or `archived` remain on disk and in the registry database.

The reason is the immutability invariant from `docs/design/tool-registry.md` Section 8.3: a workflow that ran a year ago against a specific tool version must be able to be re-run today against the same version. Auto-pruning would break this guarantee.

Manual cleanup of the registry is possible (the user can delete tool directories with `rm -rf` and run a registry rebuild), but the platform itself never initiates it.

The exception is the optional invocation cache in `~/.plurics/registry/cache/`. Cache entries are pure performance optimization and are pruned aggressively: entries older than 30 days are deleted, entries that reference a tool version that no longer exists are deleted, and the total cache size is capped at a configurable limit (default 1 GB) with LRU eviction.

## 7. Schema Migrations

When the SQLite schemas change between Plurics versions (new tables, new columns, modified constraints, indexes), existing user databases need to be migrated so that the stored data remains accessible under the new schema. This section specifies the migration mechanism.

#### 7.1 The Hybrid Approach

Plurics uses **forward-only incremental migrations** expressed as numbered files in a directory under the server's code. The default format is SQL, which handles the overwhelming majority of schema changes (adding tables, adding columns, creating indexes, constraint modifications). For the rare cases where a migration requires logic beyond what SQL can express — reading existing rows, transforming them in TypeScript code, writing them back — a TypeScript migration file with the same numbering convention can be used instead. Both formats coexist in the same directory and are executed by the same runner in unified numerical order.

The approach is a compromise between two extremes. A pure SQL approach (files only) is clean and inspectable but cannot handle data transformations that need procedural logic. A pure TypeScript approach (functions only) is flexible but hides the schema evolution inside code that is harder to review than standalone SQL files. The hybrid gives each change the most appropriate form: simple DDL changes stay as SQL and can be reviewed like text, while complex data migrations get the full power of TypeScript when needed.

This approach replaces the previous inline `CREATE TABLE IF NOT EXISTS` pattern that was used for the initial bootstrap and for the v1→v2 transition of `registry.db`. The inline pattern worked for the bootstrap phase but does not scale — after a handful of additions, the init code becomes a thicket of conditional statements that is hard to review and hard to trust. The file-based hybrid approach is the standard solution in the industry (Flyway, Rails ActiveRecord migrations, Alembic, Django South, Sqitch all use variants of this pattern) and it is well-understood by developers coming from other projects.

#### 7.2 Filesystem Layout

Migrations live in the server's code repository, not in the user's `~/.plurics/` directory. They are bundled with the Plurics installation and are treated as versioned source code, not as user data. The layout is:

```
packages/server/src/db/
├── migrations/
│   ├── plurics/
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_add_workflow_events.sql
│   │   ├── 003_add_findings_count.sql
│   │   └── 004_add_destructive_change_events.sql
│   └── registry/
│       ├── 001_initial_schema.sql
│       ├── 002_add_converters.sql
│       ├── 003_add_tool_invocations.sql
│       └── 004_add_change_type_field.sql
├── migrator.ts
└── schema-versions.ts
```

Each database has its own subdirectory under `migrations/`. The two databases (`plurics.db` and `registry.db`) are versioned independently — a release of Plurics may introduce migration `005` for `plurics.db` and `003` for `registry.db`, and the version numbers are not synchronized across databases.

The `migrator.ts` file contains the runner: a small module that reads a migrations directory, determines which files need to run based on the current state of `schema_versions`, and executes them in order. The `schema-versions.ts` file contains the TypeScript types and helper functions for reading and writing the version table.

Migrations are loaded from disk at startup. In development, they are read directly from the filesystem. In a packaged/bundled distribution (future), they are read from bundled resources included in the server package. The loading mechanism abstracts this difference so the runner code is independent of the deployment mode.

#### 7.3 Naming Convention

Every migration file follows a strict naming convention:

```
{three_digit_version}_{snake_case_description}.{sql|ts}
```

Three digits zero-padded for the version number (001, 002, ..., 999), an underscore separator, a descriptive name in snake_case, and the file extension. Three digits are sufficient for any foreseeable number of migrations — 999 migrations would be an extreme number that would suggest the project has other problems. The zero-padding is essential because it makes lexicographic ordering coincide with numeric ordering, so a simple directory listing produces the correct execution order.

The description should be specific enough to be meaningful in a directory listing. `003_add_findings_count.sql` is good; `003_update.sql` is not. A reviewer scrolling through the migrations directory should be able to reconstruct the schema's history from the filenames alone.

Examples of well-named migrations:

```
001_initial_schema.sql
002_add_workflow_events_table.sql
003_add_findings_count_column.sql
004_rename_agent_to_node_name.sql
005_create_tool_invocations_index.sql
006_backfill_scope_field.ts        # TypeScript for data transformation
```

#### 7.4 The `schema_versions` Table

Each database has a `schema_versions` table that records the currently-applied schema version. The table has a single row at any time:

```sql
CREATE TABLE schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT
);
```

The `version` field is the highest migration number that has been successfully applied. The `applied_at` field is an ISO 8601 UTC timestamp of when the migration completed. The `description` field is a short human-readable note, typically taken from the migration's filename or from a comment in the migration file itself.

On a fresh database, the very first migration (`001_initial_schema.sql`) creates the `schema_versions` table as part of its SQL and inserts the initial row with `version = 1`. Subsequent migrations update the row via `UPDATE schema_versions SET version = N, applied_at = datetime('now'), description = '...'`.

The existence of the `schema_versions` table is what the runner checks first to determine whether it is looking at a database managed by the new system or one from the pre-migration-system era. The transition from the old state is handled specially (§7.8).

#### 7.5 Migration File Format

**SQL migration files** are plain SQL with the expected DDL and optional DML statements. They are executed as a single script against the database. Example:

```sql
-- 003_add_findings_count.sql
-- Adds findings_count column to workflow_runs for fast aggregate queries.

ALTER TABLE workflow_runs ADD COLUMN findings_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_runs_findings_count
  ON workflow_runs(findings_count) WHERE findings_count > 0;

UPDATE schema_versions SET
  version = 3,
  applied_at = datetime('now'),
  description = 'Add findings_count column to workflow_runs';
```

The final `UPDATE schema_versions` statement is required in every SQL migration file — it is the marker that the migration has completed. The runner treats the absence of this statement as a file-format error.

SQL migration files are free to use `IF NOT EXISTS` clauses and similar idempotent constructs for defensive programming, but they are not required to. The `schema_versions` table guarantees that each migration runs at most once, so idempotency is a safety net, not a primary requirement.

**TypeScript migration files** export a default function with a specific signature:

```typescript
// 006_backfill_scope_field.ts
import type { Database } from 'better-sqlite3';

export default function migrate(db: Database): void {
  // Read rows that need the backfill
  const rows = db.prepare(`
    SELECT id, node_name FROM workflow_events WHERE scope IS NULL
  `).all() as { id: number; node_name: string }[];

  // Transform and write back
  const update = db.prepare(`UPDATE workflow_events SET scope = ? WHERE id = ?`);
  for (const row of rows) {
    const scope = inferScopeFromNodeName(row.node_name);
    update.run(scope, row.id);
  }

  // Update the version table
  db.prepare(`
    UPDATE schema_versions SET
      version = 6,
      applied_at = datetime('now'),
      description = 'Backfill scope field in workflow_events from node_name'
  `).run();
}

function inferScopeFromNodeName(name: string): string | null {
  // ... logic ...
}
```

The function receives a live database connection that is already inside a transaction (see §7.7), performs whatever operations are needed, and updates `schema_versions` at the end. The runner calls this function once per migration and treats exceptions as migration failures.

TypeScript migrations should be used sparingly. If a migration can be expressed in SQL, it should be — SQL files are simpler to review and to debug. TypeScript is the escape hatch for cases where SQL alone is insufficient: data backfills that require parsing or computation, cross-row transformations that would require complex SQL, or migrations that need to interact with the filesystem (for example, renaming a value store file when a schema field name changes).

#### 7.6 The Migration Runner

At Plurics startup, after opening each SQLite database and before any other database access, the migration runner performs the following sequence:

1. **Check for `schema_versions` table.** If the table does not exist, the database is either brand new or is in the pre-migration-system era. Handle according to §7.8.
2. **Read the current version.** Query `SELECT version FROM schema_versions` to get the single row. If there are zero rows (corruption, but theoretically possible), treat as if the version were 0 and start from migration `001`. If there are multiple rows (impossible in a well-maintained database), fail with a clear error.
3. **Enumerate available migrations.** Read the migrations directory for this database and list all files matching the naming convention. Sort them lexicographically (which, because of zero-padding, is equivalent to sorting by version number).
4. **Determine which migrations to run.** Filter the list to keep only files whose version number is greater than the current version. These are the migrations that need to run.
5. **Validate the sequence.** Check that the versions to run form a contiguous sequence starting at `currentVersion + 1`. If there is a gap (for example, the database is at version 3 and the directory contains versions 4 and 6 but not 5), fail with a clear error. Gaps indicate that the developer committing migration `006` forgot `005`, and running out of order would produce undefined results.
6. **Execute the migrations in order.** For each migration, open a transaction, execute the SQL or call the TypeScript function, verify that `schema_versions` was updated to the expected version, and commit the transaction. If any step fails, rollback the transaction and abort the runner.
7. **Report results.** Log each successfully-applied migration. If any migration failed, report the failed migration with the full error message and the database version at which processing stopped. The server does not start if migrations failed — running the application against an incompletely-migrated database would be unsafe.

After all migrations succeed, the database is at the expected version and the server proceeds with normal startup.

The runner is deliberately conservative: it never skips migrations, never reorders them, never modifies them. A migration that has been applied once cannot be re-applied and cannot be undone. If a migration needs to be fixed after it has been released, the fix is a new forward migration, not an edit to the existing file.

#### 7.7 Transactional Safety

Each migration runs in a single SQLite transaction. SQLite supports transactions around DDL statements (unlike some other databases where DDL is auto-committed), so the following behavior is guaranteed:

- If a migration's SQL or TypeScript raises an error mid-execution, the transaction is rolled back and the database is left exactly as it was before the migration started.
- If the migration completes successfully and the transaction commits, the database is advanced to the new version atomically. There is no intermediate state visible to other processes.
- If the server crashes during a migration (hardware failure, OS kill, power loss), SQLite's WAL mode recovers the database on the next open, and the failed migration's transaction is rolled back as part of recovery. The database is left at the previous version.

The transactional guarantee means that a failed migration does not leave the database in a broken state. The user can fix the migration file, restart Plurics, and the runner will retry it from a clean starting point. This is a significant improvement over the current inline approach, where a failed `ALTER TABLE` could leave the schema in a partially-migrated state that required manual cleanup.

There is one important caveat: TypeScript migrations can have side effects outside the database (filesystem writes, network calls, etc.) that are not captured by the transaction. A TypeScript migration that, say, renames files in the value store directory and then fails at the database update step has committed the filesystem changes but rolled back the schema change. For this reason, TypeScript migrations that modify external state should be written with extreme care — ideally, they should make the database change first and perform external operations only after the commit, so that a failure at the external step can be manually reconciled without schema damage.

#### 7.8 Transition from the Current State

Plurics today uses the pre-migration-system approach: the init code contains inline `CREATE TABLE IF NOT EXISTS` statements and ad-hoc `ALTER TABLE` handling for the v1→v2 transition of `registry.db`. Introducing the new migration system requires a one-time transition that brings existing user databases into the new system without losing data.

The transition is handled by the runner's "first encounter" logic:

1. **Detect the state.** When the runner opens a database, it checks for the existence of the `schema_versions` table. If the table exists, the database is already in the new system and proceeds normally (§7.6). If it does not exist, the database is from the pre-migration era and needs to be initialized into the system.

2. **Determine the current effective version.** The runner inspects the tables, columns, and indexes currently present in the database to determine which state it is in. This is feature detection: for each known migration version, the runner has a small predicate that returns true if the database matches the schema at that version. The predicates are ordered — version 4's predicate checks for columns introduced by migration 004, etc. The runner finds the highest version whose predicate matches and treats that as the current effective version.

3. **Create and populate `schema_versions`.** The runner creates the `schema_versions` table and inserts a row with the determined effective version, a current timestamp, and a description like "adopted from pre-migration-system state". From this point forward, the database is in the new system.

4. **Continue with normal migration.** After the initialization, the runner proceeds as in §7.6 with the database now at the detected version. If new migrations exist beyond this version (for example, the pre-migration database is at the equivalent of version 3 and the current Plurics release has migrations up to version 6), those migrations will be applied normally.

The feature detection in step 2 is necessarily specific to the current state of the schemas and must be written carefully. The initial version of the runner hard-codes the predicates for all migrations that exist at the time of the transition — this is the cost of introducing the system retroactively. After the transition, new migrations do not need predicates because they are always applied via the normal mechanism.

For the initial introduction of this system, the predicates to write are:

- **`plurics.db` pre-system versions**: whichever states the database may have been in during Plurics' development so far. The runner writes predicates for each, finds the match, and stamps the corresponding version in `schema_versions`.
- **`registry.db` pre-system versions**: same, with special attention to the v1 → v2 transition that introduced the `converters` table. The runner distinguishes v1 (no `converters` table) from v2 (has `converters` table).

After this one-time transition, the system is self-maintaining: every future schema change is a new migration file, the runner executes it on upgrade, and the `schema_versions` table tracks the state with no ambiguity.

#### 7.9 Forward-Only Policy

Migrations are forward-only. There are no "down migrations" for rolling back schema changes. Once a migration has been applied, the only way to undo its effects is to write a new forward migration that reverses them.

This is a deliberate choice and matches the practice of mature migration frameworks (Flyway, Sqitch, some Alembic configurations). Down migrations sound useful but in practice they are rarely correct — reversing a destructive change is often impossible (you cannot un-delete a dropped column that held unique data) and rarely used (in production, problems are fixed forward, not backward). The overhead of writing and maintaining down migrations for every forward migration is not justified by the rare case where one would actually be used.

For developers who want to experiment with a migration without committing to it permanently, the workflow is:

1. Write the migration on a branch.
2. Test it by running Plurics against a copy of a representative database (dev DB, or a backup of the real DB).
3. If the migration is wrong, discard the branch and write a new version.
4. Only commit the migration once it is verified to work correctly.

Once a migration is merged and released, it cannot be modified — doing so would break installations that have already applied the old version of the file. Fixing a bad migration after release is done via a new forward migration with a higher version number that corrects the issues introduced by the earlier one.

#### 7.10 Migration Testing

Every migration should have at least one automated test that verifies it produces the expected schema change. The test pattern is:

1. Create an in-memory SQLite database.
2. Apply all migrations up to version `N-1` using the runner.
3. Apply migration `N` specifically.
4. Verify that the resulting schema matches the expected state by querying `sqlite_master`, `PRAGMA table_info`, and so on.
5. For data migrations (typically TypeScript), additionally populate the pre-migration state with test data, run the migration, and verify that the data was transformed correctly.

Tests for migrations live alongside the migrator code, in `packages/server/src/db/migrations/__tests__/` or similar. They use the same test infrastructure as the rest of the server tests. A migration without a test is a migration that nobody has verified — it works until it doesn't.

#### 7.11 Migrations Across Databases

The two databases (`plurics.db` and `registry.db`) are migrated independently. The runner is invoked twice at startup, once for each database, with the appropriate migrations directory. Migrations in one database cannot reference migrations in the other — they are isolated namespaces.

Coordination between cross-database schema changes (for example, introducing a feature that requires new tables in both databases) is handled by releasing both sets of migrations in the same Plurics version. The two sets are applied as part of the same startup sequence, so the user sees them happen together even though they are technically independent operations.

There is one subtle case: if a feature requires data from one database to populate a new table in the other, the migration that performs this work must be a TypeScript migration (SQL cannot read cross-database) and must be in the database receiving the data. The migration opens a connection to the other database, reads the required data, and populates the new table. Testing such a migration requires setting up both databases — more work than single-database migrations, but manageable.

## 8. Backup and Disaster Recovery

Plurics is single-user local. Backup is the user's responsibility, and Plurics does not perform automatic backups. This section provides guidance for users who want to ensure their data is recoverable in case of disk failure or accidental deletion.

### 8.1 What to Back Up

The complete Plurics state lives in two locations:

1. `~/.plurics/` — user-level state including the platform database and the tool registry
2. `{workspace}/.plurics/` for each workspace — workspace-level state including all run directories

Backing up these two locations is sufficient to recover Plurics to its current state. A user with backups can:

- Restore the registry by copying `~/.plurics/registry/` back
- Restore the platform database by copying `~/.plurics/plurics.db` back (along with its WAL/SHM files if Plurics was running)
- Restore a workspace's runs by copying `{workspace}/.plurics/runs/` back

### 8.2 Critical vs Reconstructible

Not all Plurics state is equally important:

**Critical (loss is unrecoverable):**
- The tool registry (`~/.plurics/registry/`). Tools can be re-written, but accumulated workflow-specific tools and customizations are gone if lost.
- Findings (`{workspace}/.plurics/runs/*/findings/`). These are the high-value outputs of workflows.
- Workflow YAML and plugin snapshots in run directories. Without these, runs cannot be reproduced or understood.

**Important (loss is painful but recoverable):**
- `plurics.db`. The platform database holds run history, workspace registrations, presets. Losing it means losing the index over runs, but the runs themselves on the filesystem can be re-indexed by a future tool.
- `node-states.json` and `pool-state.json` in run directories. Losing these prevents resume but does not affect already-completed runs.
- Purposes and logs in run directories. Losing these makes diagnostics harder but does not affect the validity of completed findings.

**Reconstructible (loss is recoverable from other state):**
- `registry.db`. This is a cache over the filesystem-stored tool definitions. Losing it triggers a rebuild on next startup that scans the registry directory and repopulates the database.
- Value store entries (`runs/*/values/`). These can be recreated by re-running the producing tools.
- WAL and SHM files for SQLite. Lost on crash; SQLite reconstructs them.

A backup strategy that prioritizes the critical category protects the highest-value assets at the lowest cost. A complete backup of `~/.plurics/` and all `{workspace}/.plurics/runs/findings/` directories is small (typically tens of megabytes) and protects everything that matters.

### 8.3 Recommended Backup Practices

For a typical Plurics user, the recommended approach is:

1. **Include `~/.plurics/` in your normal home directory backup.** Most backup tools (Time Machine, restic, borg, rsync-based scripts) handle this automatically if your home directory is backed up.

2. **For each workspace where you run Plurics, ensure the workspace directory is backed up.** This is usually already the case if your project directories are under version control or in a backed-up location.

3. **If you generate findings you care about, copy them to a separate location.** A simple `cp -r {workspace}/.plurics/runs/{runId}/findings/ ~/research-archive/{date}/` after a successful run preserves the most valuable artifacts independently of the run directory.

4. **Do not put `.plurics/` directories under version control naively.** The run directories can grow large, and committing them to a Git repository is inefficient. If you want version control of workflows, version-control the workflow YAML and plugin files, not the run directories.

There is no Plurics-provided backup tool. The platform exposes the data in a backup-friendly form (plain files, plain JSON, plain SQLite), and standard backup tools are sufficient.

### 8.4 Disaster Recovery

If `~/.plurics/plurics.db` is lost or corrupted but the run directories are intact, Plurics has a recovery mode (planned, not yet implemented) that scans the workspace's run directories and reconstructs the platform database. The recovery is not perfect (some metadata is only in the database, not in the run directory), but it restores enough to make past runs visible in the UI again.

If the registry directory is lost but the workflows that registered tools are still available, the workflows can be re-run to re-register the tools. The registry will be rebuilt with the same tools (assuming the workflow plugins are deterministic about tool registration). This is not automatic — the user has to recognize the situation and trigger the workflows.

If a run directory is lost, the run is unrecoverable. The findings are gone, the resume snapshot is gone, and there is no way to reconstruct what happened. This is the strongest argument for backup.

## 9. Integration with Other Subsystems

This section is a cross-reference index for where the persistence subsystem touches other components.

**Workflow Engine** (`docs/design/workflow-engine.md`): the engine writes signal files to `runs/{runId}/signals/`, snapshots to `node-states.json`, run metadata to `run-metadata.json`, and workflow events to the `workflow_events` table. The engine is the largest writer to the persistence layer.

**Node Runtimes** (`docs/design/node-runtimes.md`): the runtimes write purpose files to `purposes/`, log files to `logs/`, and value store entries to `values/`. The value store specifically uses run-level persistence as documented in Section 5 of the runtimes doc.

**Tool Registry** (`docs/design/tool-registry.md`): the registry writes tool directories to `~/.plurics/registry/tools/`, schema files to `schemas/`, converter directories to `converters/`, and indexes everything in `registry.db`. Section 4 of the registry doc specifies the filesystem layout in detail.

**Evolutionary Pool** (`docs/design/evolutionary-pool.md`): the pool writes its snapshot to `pool-state.json` in the run directory after every modification. Section 6 of the pool doc specifies the format.

**Plugin SDK** (`docs/design/plugin-sdk.md`): plugins can write to `runs/{runId}/plugin-state/` for their own persistent state, and to `runs/{runId}/handoffs/` for handoff files via `accept_with_handoff` signal decisions.

**UI** (`docs/design/ui.md`, to be written): the UI reads from `plurics.db` for run history, workspace lists, and event timelines, and from run directories for displaying details of specific runs. The WebSocket protocol used by the UI for live updates is specified in the UI doc.

---

## 10. Implementation Status

**Implemented (current codebase):**
- `~/.plurics/` directory creation and basic layout
- `plurics.db` with `workspaces`, `agent_presets`, `workflow_runs`, `workflow_events` tables (verify exact schema against current code)
- Run directory creation and population during workflow execution
- `run-metadata.json` writing and updating
- `node-states.json` snapshotting (handled by workflow engine)
- Atomic file write pattern for snapshots
- WAL mode for SQLite

**Pending TR Phase 4-6:**
- `~/.plurics/registry/` directory and the entire registry storage layer
- `registry.db` with all six tables (`tools`, `tool_ports`, `schemas`, `converters`, `tool_dependencies`, `tool_invocations`)
- Seed tool loading at first startup (after Wave 1 of seed tools is written)

**Pending separate implementation:**
- The migration runner, the `migrations/` directory infrastructure, and the one-time transition from the current inline init code to the file-based migration system. The full specification is in §7; this is the implementation work that brings the spec to life. The initial batch of migration files must cover both `plurics.db` and `registry.db` current states, with feature-detection predicates in the runner for the one-time transition step. Estimated effort: 3-5 days for the runner and initial migration files, plus 1-2 days for tests.
- The `workflow_findings` table and its automatic population. May be partially implemented; verify.
- Retention policy enforcement (the periodic background task that prunes value store entries and aggregates old events).
- Disaster recovery mode (the platform DB rebuild from run directories).

**Verification needed:**
- Exact table schemas, column names, and indexes for all tables (the descriptions in this document are based on patterns and conversation history; the actual schemas may differ)
- The exact location and format of `config.json` and `workspace.json`
- Whether presets are stored as files or in the database
- Whether the current implementation uses better-sqlite3, sqlite3 (async), or another library
- Whether WAL mode is actually configured

The verification should happen during a focused pass through the persistence-related code in `packages/server/`, comparing what is documented here against what is implemented, and updating either the document or the code (or both) to match.

---

*This document is the authoritative reference for the Plurics persistence subsystem. The filesystem layout and database schemas described here are the contract that all other subsystems rely on for storing and retrieving their state. Changes to the layout or schemas should be made through versioned migrations and reflected in this document.*