import { describe, it, expect } from 'vitest';
import { extractSignalBlock, parseSignal, SignalParseError } from '../signal-parser.js';

const VALID_SIGNAL = JSON.stringify({
  status: 'success',
  agent: 'test_agent',
  outputs: [],
});

describe('extractSignalBlock', () => {
  it('returns null when no signal block present', () => {
    expect(extractSignalBlock('just some text')).toBeNull();
  });

  it('extracts a single signal block', () => {
    const text = `Some text\n\`\`\`signal\n${VALID_SIGNAL}\n\`\`\`\nTrailing text`;
    expect(extractSignalBlock(text)).toBe(VALID_SIGNAL);
  });

  it('returns the LAST block when multiple are present', () => {
    const first = JSON.stringify({ status: 'failure', agent: 'a', outputs: [] });
    const last = JSON.stringify({ status: 'success', agent: 'b', outputs: [] });
    const text = `\`\`\`signal\n${first}\n\`\`\`\nMore text\n\`\`\`signal\n${last}\n\`\`\``;
    expect(extractSignalBlock(text)).toBe(last);
  });

  it('handles multiline JSON inside signal block', () => {
    const json = `{\n  "status": "success",\n  "agent": "x",\n  "outputs": []\n}`;
    const text = `\`\`\`signal\n${json}\n\`\`\``;
    expect(extractSignalBlock(text)).toBe(json);
  });
});

describe('parseSignal', () => {
  it('returns parsed SignalFile for valid JSON with required fields', () => {
    const signal = parseSignal(VALID_SIGNAL);
    expect(signal.status).toBe('success');
    expect(signal.agent).toBe('test_agent');
    expect(signal.outputs).toEqual([]);
  });

  it('throws SignalParseError for invalid JSON', () => {
    expect(() => parseSignal('not json')).toThrow(SignalParseError);
  });

  it('throws SignalParseError when required field missing', () => {
    expect(() => parseSignal('{"status":"success","agent":"x"}')).toThrow(SignalParseError);
  });

  it('throws SignalParseError when status field missing', () => {
    expect(() => parseSignal('{"agent":"x","outputs":[]}')).toThrow(SignalParseError);
  });
});
