/**
 * ClaudeCodeSession — AgentBackend for Claude Code running under a PTY.
 *
 * Spawns a real shell (powershell on Windows, bash elsewhere) and injects
 * `claude --dangerously-skip-permissions [--model X]` once the client reports
 * its terminal dimensions via the first resize. The deferred-command pattern
 * ensures the Claude Code TUI starts at the correct size.
 *
 * The internal `TerminalSession` class is a private implementation detail —
 * it remains for clarity of the PTY lifecycle but is not exported.
 */

import { v4 as uuidv4 } from 'uuid';
import * as pty from 'node-pty';
import * as os from 'node:os';
import type { LegacyAgentBackend, AgentConfig, AgentInfo, AgentResult, BackendType } from './agent-backend.js';

const DEFAULT_COMMAND = 'claude --dangerously-skip-permissions';
const DEFAULT_CWD = process.cwd();
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

type DataCallback = (data: string) => void;
type ExitCallback = () => void;

/**
 * Private low-level PTY wrapper. Not exported.
 * Handles the node-pty process lifecycle and the deferred-command pattern.
 */
class TerminalSession {
  readonly id: string;
  readonly name: string;
  private status: 'running' | 'exited' = 'running';
  private cols: number;
  private rows: number;
  private readonly createdAt: number;
  private readonly listeners: Set<DataCallback> = new Set();
  private readonly exitListeners: Set<ExitCallback> = new Set();
  private ptyProcess: pty.IPty | null = null;
  private commandStarted = false;
  private readonly deferredCommand: string;

  private constructor(id: string, name: string, cols: number, rows: number, deferredCommand: string) {
    this.id = id;
    this.name = name;
    this.cols = cols;
    this.rows = rows;
    this.createdAt = Date.now();
    this.deferredCommand = deferredCommand;
  }

  static create(name: string, command: string, cwd: string, cols: number, rows: number): TerminalSession {
    const id = uuidv4();
    const session = new TerminalSession(id, name, cols, rows, command);

    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    session.ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    session.ptyProcess.onData((data: string) => {
      for (const cb of session.listeners) cb(data);
    });

    session.ptyProcess.onExit(() => {
      if (session.status === 'exited') return;
      session.status = 'exited';
      for (const cb of session.exitListeners) cb();
    });

    return session;
  }

  getStatus(): 'running' | 'exited' { return this.status; }
  getCreatedAt(): number { return this.createdAt; }

  write(data: string): void {
    this.ptyProcess?.write(data);
  }

  onData(callback: DataCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onExit(callback: ExitCallback): () => void {
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.ptyProcess?.resize(cols, rows);

    // On first resize: launch the deferred claude command. This ensures the
    // TUI starts at the client's actual dimensions instead of the default.
    if (!this.commandStarted) {
      this.commandStarted = true;
      if (this.deferredCommand) {
        this.write(this.deferredCommand + '\r');
      }
    }
  }

  destroy(): void {
    const wasRunning = this.status === 'running';
    this.status = 'exited';
    this.listeners.clear();
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    if (wasRunning) {
      for (const cb of this.exitListeners) cb();
    }
    this.exitListeners.clear();
  }
}

/**
 * Public LegacyAgentBackend implementation for claude-code.
 * The PTY is internal; the interface exposes the minimal surface that the
 * DagExecutor and AgentRegistry need.
 */
export class ClaudeCodeSession implements LegacyAgentBackend {
  readonly backendType: BackendType = 'claude-code';
  private readonly session: TerminalSession;

  private constructor(session: TerminalSession) {
    this.session = session;
  }

  get id(): string { return this.session.id; }
  get name(): string { return this.session.name; }

  get info(): AgentInfo {
    return {
      id: this.session.id,
      name: this.session.name,
      backendType: 'claude-code',
      status: this.session.getStatus(),
      createdAt: this.session.getCreatedAt(),
    };
  }

  /** Create a new Claude Code session. Used by AgentRegistry. */
  static async create(config: AgentConfig): Promise<ClaudeCodeSession> {
    const session = TerminalSession.create(
      config.name,
      config.command ?? DEFAULT_COMMAND,
      config.cwd ?? DEFAULT_CWD,
      DEFAULT_COLS,
      DEFAULT_ROWS,
    );
    return new ClaudeCodeSession(session);
  }

  async start(): Promise<void> {
    // The PTY is created in the constructor — nothing to do here.
  }

  async stop(): Promise<void> {
    this.session.destroy();
  }

  isAlive(): boolean {
    return this.session.getStatus() === 'running';
  }

  async inject(content: string): Promise<void> {
    this.session.write(content);
  }

  onOutput(callback: DataCallback): () => void {
    return this.session.onData(callback);
  }

  onExit(callback: ExitCallback): () => void {
    return this.session.onExit(callback);
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.session.resize(cols, rows);
  }

  write(data: string): void {
    this.session.write(data);
  }

  /**
   * Claude-code agents write signal files directly via shell commands —
   * the platform reads those from disk through the SignalWatcher.
   */
  getResult(): AgentResult | null {
    return null;
  }
}
