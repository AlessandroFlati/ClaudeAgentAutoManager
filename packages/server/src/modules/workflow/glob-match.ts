import { minimatch } from 'minimatch';

/** Returns true if toolName matches any of the provided glob patterns. */
export function matchesAnyGlob(toolName: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.some(p => minimatch(toolName, p, { dot: true }));
}
