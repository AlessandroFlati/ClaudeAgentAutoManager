export type ServerMessage =
  | { type: 'error'; message: string }
  | { type: 'workflow:started'; runId: string; nodeCount: number; nodes: Array<{ name: string; state: string; scope: string | null }> }
  | { type: 'workflow:node-update'; runId: string; node: string; fromState: string; toState: string; event: string; terminalId?: string }
  | { type: 'workflow:completed'; runId: string; summary: { total_nodes: number; completed: number; failed: number; skipped: number; duration_seconds: number } }
  | { type: 'workflow:paused'; runId: string }
  | { type: 'workflow:resumed'; runId: string }
  | { type: 'workflow:finding'; runId: string; hypothesisId: string; content: string };

// --- Input Manifest ---

export interface InputManifest {
  sources: DataSource[];
  config_overrides: Record<string, unknown>;
  scope: ScopeConstraint | null;
  description: string | null;
}

// DataSource is a pass-through to the server. The UI creates local_file sources;
// other types can be added via raw JSON or future UI extensions.
export type DataSource = Record<string, unknown> & { type: string };

export interface ScopeConstraint {
  include_columns: string[] | null;
  exclude_columns: string[] | null;
  date_range: { column: string; start: string | null; end: string | null } | null;
  row_filter: { column: string; operator: string; value: unknown } | null;
  max_rows: number | null;
  sampling_method: 'head' | 'random' | 'stratified' | null;
  stratify_column: string | null;
}

export type ClientMessage =
  | { type: 'workflow:start'; yamlContent: string; workspacePath: string; yamlPath?: string; inputManifest?: InputManifest }
  | { type: 'workflow:abort'; runId: string }
  | { type: 'workflow:pause'; runId: string }
  | { type: 'workflow:resume'; runId: string }
  | { type: 'workflow:status'; runId: string }
  | { type: 'workflow:resume-run'; runId: string };
