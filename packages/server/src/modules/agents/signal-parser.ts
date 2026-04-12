/**
 * Signal block parser — Node Runtimes Phase 3
 *
 * Extracts and validates fenced `signal` code blocks from LLM responses.
 * The last block wins when multiple are present.
 */

export interface SignalFile {
  status: 'success' | 'failure' | 'partial';
  agent: string;
  outputs: unknown[];
  [key: string]: unknown;
}

export class SignalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignalParseError';
  }
}

const SIGNAL_BLOCK_RE = /```signal\n([\s\S]*?)\n```/g;

/**
 * Find all fenced ```signal blocks in `text`.
 * Returns the content of the LAST block, or null if none found.
 */
export function extractSignalBlock(text: string): string | null {
  const matches = [...text.matchAll(SIGNAL_BLOCK_RE)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];
}

/**
 * Parse a signal block content string into a validated `SignalFile`.
 * Throws `SignalParseError` on malformed JSON or missing required fields.
 */
export function parseSignal(content: string): SignalFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new SignalParseError(`Signal block is not valid JSON: ${(e as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SignalParseError('Signal block must be a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;

  if (!('status' in obj)) {
    throw new SignalParseError('Signal block missing required field: "status".');
  }
  if (!('agent' in obj)) {
    throw new SignalParseError('Signal block missing required field: "agent".');
  }
  if (!('outputs' in obj)) {
    throw new SignalParseError('Signal block missing required field: "outputs".');
  }

  return obj as SignalFile;
}

/**
 * Attempt to extract and parse a signal from LLM response text.
 * Returns null if no signal block is present.
 * Throws `SignalParseError` if a block is present but invalid.
 */
export function extractAndParseSignal(text: string): SignalFile | null {
  const block = extractSignalBlock(text);
  if (block === null) return null;
  return parseSignal(block);
}
