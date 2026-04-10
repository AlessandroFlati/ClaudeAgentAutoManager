export type ClientMessage =
  | { type: 'workflow:start'; yamlContent: string; workspacePath: string; yamlPath?: string; inputManifest?: import('../modules/workflow/input-types.js').InputManifest }
  | { type: 'workflow:abort'; runId: string }
  | { type: 'workflow:pause'; runId: string }
  | { type: 'workflow:resume'; runId: string }
  | { type: 'workflow:status'; runId: string }
  | { type: 'workflow:resume-run'; runId: string };

export type ServerMessage =
  | { type: 'error'; message: string }
  | { type: 'workflow:started'; runId: string; nodeCount: number; nodes: Array<{ name: string; state: string; scope: string | null }> }
  | { type: 'workflow:node-update'; runId: string; node: string; fromState: string; toState: string; event: string; terminalId?: string }
  | { type: 'workflow:completed'; runId: string; summary: { total_nodes: number; completed: number; failed: number; skipped: number; duration_seconds: number } }
  | { type: 'workflow:paused'; runId: string }
  | { type: 'workflow:resumed'; runId: string }
  | { type: 'workflow:finding'; runId: string; hypothesisId: string; content: string };
