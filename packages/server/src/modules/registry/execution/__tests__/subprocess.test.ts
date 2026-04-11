import { describe, it, expect } from 'vitest';
import { runSubprocess } from '../subprocess.js';

const NODE = process.execPath;

describe('runSubprocess', () => {
  it('returns exit=0 and captures stdout for a successful process', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'process.stdout.write("hi")'],
      stdin: '',
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('exit');
    if (result.kind !== 'exit') return;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hi');
  });

  it('forwards stdin to the child', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'let d=""; process.stdin.on("data", c=>d+=c); process.stdin.on("end", ()=>process.stdout.write(d))'],
      stdin: 'from-parent',
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('exit');
    if (result.kind !== 'exit') return;
    expect(result.stdout).toBe('from-parent');
  });

  it('captures non-zero exit codes', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'process.exit(7)'],
      stdin: '',
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('exit');
    if (result.kind !== 'exit') return;
    expect(result.exitCode).toBe(7);
  });

  it('returns timeout when the process exceeds the deadline', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      stdin: '',
      timeoutMs: 200,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('timeout');
  });

  it('truncates and fails when stdout exceeds maxOutputBytes', async () => {
    const result = await runSubprocess({
      command: NODE,
      args: ['-e', 'process.stdout.write("x".repeat(10_000))'],
      stdin: '',
      timeoutMs: 5_000,
      maxOutputBytes: 100,
    });
    expect(result.kind).toBe('output_too_large');
  });

  it('returns spawn_error when the command cannot be launched', async () => {
    const result = await runSubprocess({
      command: '/nonexistent/binary/here',
      args: [],
      stdin: '',
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.kind).toBe('spawn_error');
  });
});
