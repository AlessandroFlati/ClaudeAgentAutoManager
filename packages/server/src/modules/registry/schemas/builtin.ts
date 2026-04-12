import type { SchemaDef } from '../types.js';

// Built-in primitive and structured schemas available to every tool without
// registration. Kept in sync with python/runner.py's PICKLE_SCHEMAS set.
//
// Spec reference: design doc §6 and §11 — this slice ships 7 primitives plus
// 2 structured schemas so the pickle output path is exercised end-to-end.

export const BUILTIN_SCHEMAS: readonly SchemaDef[] = [
  {
    name: 'Integer',
    kind: 'primitive',
    pythonRepresentation: 'int',
    encoding: 'json_literal',
    description: 'Signed integer.',
    source: 'builtin',
  },
  {
    name: 'Float',
    kind: 'primitive',
    pythonRepresentation: 'float',
    encoding: 'json_literal',
    description: 'Double-precision floating point.',
    source: 'builtin',
  },
  {
    name: 'String',
    kind: 'primitive',
    pythonRepresentation: 'str',
    encoding: 'json_literal',
    description: 'UTF-8 string.',
    source: 'builtin',
  },
  {
    name: 'Boolean',
    kind: 'primitive',
    pythonRepresentation: 'bool',
    encoding: 'json_literal',
    description: 'True or false.',
    source: 'builtin',
  },
  {
    name: 'JsonObject',
    kind: 'primitive',
    pythonRepresentation: 'dict',
    encoding: 'json_literal',
    description: 'Arbitrary JSON-serializable dict.',
    source: 'builtin',
  },
  {
    name: 'JsonArray',
    kind: 'primitive',
    pythonRepresentation: 'list',
    encoding: 'json_literal',
    description: 'Arbitrary JSON-serializable list.',
    source: 'builtin',
  },
  {
    name: 'Null',
    kind: 'primitive',
    pythonRepresentation: 'None',
    encoding: 'json_literal',
    description: 'Used to mark optional outputs.',
    source: 'builtin',
  },
  {
    name: 'NumpyArray',
    kind: 'structured',
    pythonRepresentation: 'numpy.ndarray',
    encoding: 'pickle_b64',
    description: 'Multi-dimensional numeric array.',
    source: 'builtin',
    summarizer(payload: unknown) {
      try {
        if (!payload || typeof payload !== 'object') return null;
        const p = payload as Record<string, unknown>;
        return {
          schema: 'NumpyArray',
          ndim: typeof p['ndim'] === 'number' ? p['ndim'] : undefined,
          size: typeof p['size'] === 'number' ? p['size'] : undefined,
          dtype: typeof p['dtype'] === 'string' ? p['dtype'] : undefined,
          shape: Array.isArray(p['shape']) ? (p['shape'] as [number, number]) : undefined,
          sample: Array.isArray(p['sample']) ? (p['sample'] as unknown[]) : undefined,
        };
      } catch {
        return null;
      }
    },
  },
  {
    name: 'DataFrame',
    kind: 'structured',
    pythonRepresentation: 'pandas.DataFrame',
    encoding: 'pickle_b64',
    description: 'Generic pandas DataFrame.',
    source: 'builtin',
    summarizer(payload: unknown) {
      try {
        if (!payload || typeof payload !== 'object') return null;
        const p = payload as Record<string, unknown>;
        return {
          schema: 'DataFrame',
          shape: Array.isArray(p['shape']) ? (p['shape'] as [number, number]) : undefined,
          columns: Array.isArray(p['columns']) ? (p['columns'] as string[]) : undefined,
          head: Array.isArray(p['head']) ? (p['head'] as Record<string, unknown>[]) : undefined,
          stats: p['stats'] && typeof p['stats'] === 'object'
            ? (p['stats'] as Record<string, unknown>)
            : undefined,
        };
      } catch {
        return null;
      }
    },
  },
  {
    name: 'SymbolicExpr',
    kind: 'structured',
    pythonRepresentation: 'sympy.Expr',
    encoding: 'pickle_b64',
    description: 'A symbolic mathematical expression (sympy.Expr). Encoded as pickle_b64.',
    source: 'builtin',
  },
  {
    name: 'Series',
    kind: 'structured',
    pythonRepresentation: 'pandas.Series',
    encoding: 'pickle_b64',
    description: 'Generic pandas Series (name, dtype, and values).',
    source: 'builtin',
  },
  {
    name: 'OhlcFrame',
    kind: 'structured',
    pythonRepresentation: 'pandas.DataFrame',
    encoding: 'pickle_b64',
    description: 'pandas DataFrame with open/high/low/close columns indexed by timestamp.',
    source: 'builtin',
  },
  {
    name: 'FeaturesFrame',
    kind: 'structured',
    pythonRepresentation: 'pandas.DataFrame',
    encoding: 'pickle_b64',
    description: 'pandas DataFrame of computed numeric features indexed by timestamp.',
    source: 'builtin',
  },
  {
    name: 'ReturnSeries',
    kind: 'structured',
    pythonRepresentation: 'pandas.Series',
    encoding: 'pickle_b64',
    description: 'pandas Series of log returns indexed by timestamp.',
    source: 'builtin',
  },
  {
    name: 'SignalSeries',
    kind: 'structured',
    pythonRepresentation: 'pandas.Series',
    encoding: 'pickle_b64',
    description: 'pandas Series of trading signals (±1 or 0) indexed by timestamp.',
    source: 'builtin',
  },
  {
    name: 'Statistics',
    kind: 'structured',
    pythonRepresentation: 'dict',
    encoding: 'pickle_b64',
    description: 'Dict of statistical test results (p-values, statistics, metadata).',
    source: 'builtin',
  },
  {
    name: 'RegressionModel',
    kind: 'structured',
    pythonRepresentation: 'object',
    encoding: 'pickle_b64',
    description: 'A fitted regression model (sklearn, statsmodels, or compatible).',
    source: 'builtin',
  },
  {
    name: 'ClusteringModel',
    kind: 'structured',
    pythonRepresentation: 'object',
    encoding: 'pickle_b64',
    description: 'A fitted clustering model (sklearn KMeans or compatible).',
    source: 'builtin',
  },
];

/** Schemas whose values move across the stdio boundary as pickle+base64. */
export const PICKLE_SCHEMA_NAMES: readonly string[] = BUILTIN_SCHEMAS
  .filter((s) => s.encoding === 'pickle_b64')
  .map((s) => s.name);
