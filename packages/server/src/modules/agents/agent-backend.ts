/**
 * AgentBackend — unified interface for all agent execution backends.
 *
 * Three implementations:
 * - ClaudeCodeSession: wraps node-pty (claude CLI in a PTY terminal)
 * - ProcessSession: child_process for deterministic scripts (Lean, Python)
 * - LocalLlmSession: HTTP to OpenAI-compatible or Ollama native API
 *
 * @deprecated This interface and all three implementations are the LEGACY
 * backend system from the CAAM origin. They are kept alive in NR Phase 1
 * under the Option A compat mode. Removal is tracked as NR Phase 3 Step 0,
 * after the new AgentBackend implementations pass smoke tests on all five
 * workflows. New code should use the new AgentBackend interface (Task 3).
 */

/** @deprecated */
export type BackendType = 'claude-code' | 'process' | 'local-llm';

/** @deprecated */
export interface AgentConfig {
  name: string;
  cwd: string;
  purpose: string;
  backend: BackendType;

  // claude-code specific
  command?: string;
  effort?: 'low' | 'medium' | 'high';

  // process specific
  processCommand?: string[];
  workingDir?: string;
  env?: Record<string, string>;

  // local-llm specific
  endpoint?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** Provider API format: 'openai' (default) or 'ollama'. */
  provider?: 'openai' | 'ollama';
  /** Disable thinking mode for reasoning models (Qwen 3.5, DeepSeek-R1). Ollama-only. */
  disableThinking?: boolean;
}

/** @deprecated */
export interface AgentResult {
  success: boolean;
  output: string;
  error: string | null;
  exitCode: number | null;
  durationMs: number;
  artifacts: AgentArtifact[];
}

/** @deprecated */
export interface AgentArtifact {
  path: string;
  type: 'json' | 'lean' | 'python' | 'markdown' | 'binary';
}

/** @deprecated */
export interface AgentInfo {
  id: string;
  name: string;
  backendType: BackendType;
  status: 'running' | 'exited';
  createdAt: number;
}

/**
 * Legacy PTY/process/HTTP backend interface inherited from CAAM.
 *
 * @deprecated Replaced by the new conversation-oriented AgentBackend interface
 * in NR Phase 1. This interface will be removed in NR Phase 3 Step 0.
 */
export interface LegacyAgentBackend {
  readonly id: string;
  readonly name: string;
  readonly backendType: BackendType;
  readonly info: AgentInfo;

  /** Start the agent with the given config. */
  start(): Promise<void>;

  /** Stop the agent (kill process, close connection). */
  stop(): Promise<void>;

  /** Check if the agent is still running. */
  isAlive(): boolean;

  /** Inject content (purpose prompt for claude-code, prompt for local-llm, stdin for process). */
  inject(content: string): Promise<void>;

  /** Subscribe to output data (terminal output, stdout, LLM tokens). */
  onOutput(callback: (data: string) => void): () => void;

  /** Subscribe to exit event. */
  onExit(callback: () => void): () => void;

  /** Resize (only meaningful for claude-code PTY backend). */
  resize(cols: number, rows: number): Promise<void>;

  /** Write raw data (only meaningful for claude-code PTY backend). */
  write(data: string): void;

  /**
   * Get the result after completion (for process/local-llm backends).
   * Claude-code backends return null (they write signal files directly).
   */
  getResult(): AgentResult | null;
}
