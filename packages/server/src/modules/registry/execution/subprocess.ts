import { spawn } from 'node:child_process';

export interface SubprocessRequest {
  command: string;
  args: string[];
  stdin: string;
  timeoutMs: number;
  maxOutputBytes: number;
  cwd?: string;
}

export type SubprocessResult =
  | { kind: 'exit'; exitCode: number; stdout: string; stderr: string }
  | { kind: 'timeout' }
  | { kind: 'output_too_large'; stdout: string; stderr: string }
  | { kind: 'spawn_error'; message: string };

export function runSubprocess(req: SubprocessRequest): Promise<SubprocessResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(req.command, req.args, {
        cwd: req.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ kind: 'spawn_error', message: (err as Error).message });
      return;
    }

    let settled = false;
    const settle = (r: SubprocessResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > req.maxOutputBytes) {
        truncated = true;
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= req.maxOutputBytes) {
        stderrChunks.push(chunk);
      }
    });

    child.on('error', (err) => {
      settle({ kind: 'spawn_error', message: err.message });
    });

    child.on('exit', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (truncated) {
        settle({ kind: 'output_too_large', stdout, stderr });
        return;
      }
      settle({ kind: 'exit', exitCode: code ?? -1, stdout, stderr });
    });

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const hardKill = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 5_000);
      hardKill.unref();
      settle({ kind: 'timeout' });
    }, req.timeoutMs);
    timer.unref();

    child.stdin.on('error', () => { /* ignore EPIPE on early child exit */ });
    try {
      child.stdin.end(req.stdin);
    } catch {
      // Child already exited; the exit handler will settle.
    }
  });
}
