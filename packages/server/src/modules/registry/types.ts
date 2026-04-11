// Public types for the Plurics Tool Registry.
// See docs/superpowers/specs/2026-04-11-tool-registry-phase-1-2-design.md §7.

export type ToolCaller = 'seed' | 'human' | 'agent';
export type PortDirection = 'input' | 'output';
export type Stability = 'experimental' | 'stable' | 'deprecated';
export type CostClass = 'fast' | 'medium' | 'slow';
export type ToolStatus = 'active' | 'deprecated' | 'archived';
export type SchemaKind = 'primitive' | 'structured';
export type SchemaEncoding = 'json_literal' | 'pickle_b64';
export type SchemaSource = 'builtin' | 'user';

// ---------- Schemas ----------

export interface SchemaDef {
  name: string;
  kind: SchemaKind;
  pythonRepresentation: string | null;
  encoding: SchemaEncoding;
  description: string | null;
  source: SchemaSource;
}

// ---------- Tool manifests (post-parse, pre-validation) ----------

export interface ToolPortSpec {
  schema: string;
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface ToolManifest {
  name: string;
  version: number;
  description: string;
  category?: string;
  tags?: string[];
  inputs: Record<string, ToolPortSpec>;
  outputs: Record<string, ToolPortSpec>;
  implementation: {
    language: 'python';
    entryPoint: string;        // "tool.py:run"
    requires?: string[];
  };
  tests?: {
    file: string;              // "tests.py"
    required: boolean;
  };
  metadata?: {
    author?: string;
    createdAt?: string;
    stability?: Stability;
    costClass?: CostClass;
  };
}

// ---------- Tool records (resolved from the DB) ----------

export interface ResolvedPort {
  name: string;
  direction: PortDirection;
  schemaName: string;
  required: boolean;
  default: unknown;
  description: string | null;
  position: number;
}

export interface ToolRecord {
  name: string;
  version: number;
  description: string;
  category: string | null;
  tags: string[];
  inputs: ResolvedPort[];
  outputs: ResolvedPort[];
  entryPoint: string;
  language: 'python';
  requires: string[];
  stability: Stability | null;
  costClass: CostClass | null;
  author: string | null;
  createdAt: string;
  toolHash: string;
  status: ToolStatus;
  directory: string;           // absolute path to the v{N} dir
}

// ---------- Registration ----------

export interface RegistrationRequest {
  manifestPath: string;
  caller: ToolCaller;
  testsRequired?: boolean;
  workflowRunId?: string;
}

export type RegistrationError = {
  category:
    | 'manifest_parse'
    | 'manifest_validation'
    | 'schema_unknown'
    | 'entry_point_missing'
    | 'version_conflict'
    | 'test_failure'
    | 'filesystem'
    | 'database'
    | 'internal';
  message: string;
  path?: string;
};

export type RegistrationResult =
  | {
      success: true;
      toolName: string;
      version: number;
      toolHash: string;
      testsRun: number;
      testsPassed: number;
      directory: string;
    }
  | {
      success: false;
      toolName: string;
      version: number | null;
      errors: RegistrationError[];
    };

// ---------- Discovery ----------

export interface ListFilters {
  category?: string;
  tags?: string[];
  stability?: Stability;
  statusIn?: ToolStatus[];
}

// ---------- Invocation ----------

export interface InvocationRequest {
  toolName: string;
  version?: number;
  inputs: Record<string, unknown>;
  timeoutMs?: number;
  callerContext?: {
    workflowRunId: string;
    nodeName: string;
    scope: string | null;
  };
}

export type InvocationErrorCategory =
  | 'tool_not_found'
  | 'validation'
  | 'timeout'
  | 'runtime'
  | 'output_mismatch'
  | 'subprocess_crash'
  | 'python_unavailable';

export type InvocationResult =
  | {
      success: true;
      outputs: Record<string, unknown>;
      metrics: { durationMs: number };
    }
  | {
      success: false;
      error: {
        category: InvocationErrorCategory;
        message: string;
        stderr?: string;
      };
      metrics: { durationMs: number };
    };

// ---------- Client options ----------

export interface RegistryClientOptions {
  rootDir?: string;          // defaults to ~/.plurics/registry; override via PLURICS_REGISTRY_ROOT
  pythonPath?: string;       // absolute path; resolved at initialize() if omitted
}
