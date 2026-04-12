// Composition type checker for the Plurics workflow engine.
// Spec: docs/superpowers/specs/2026-04-12-tool-registry-phase-4-design.md §8
// Design: docs/design/type-system.md §5

import type { ParsedWorkflowYaml } from './yaml-parser.js';
import type { RegistryClient } from '../registry/registry-client.js';
import type { SchemaRegistry } from '../registry/schemas/schema-registry.js';
import { parseTypeExpr, typeExprEqual } from './type-parser.js';
import type { TypeExpr } from './type-parser.js';

// ---------- Public types ----------

export interface TypeCheckResult {
  ok: boolean;
  errors: TypeCheckError[];
  warnings: TypeWarning[];
  resolvedPlan: ResolvedWorkflowPlan;
}

export interface TypeCheckError {
  category:
    | 'tool_not_found'
    | 'schema_not_found'
    | 'type_mismatch'
    | 'missing_required_input'
    | 'preset_not_found'
    | 'invalid_reference'
    | 'invalid_backend';
  message: string;
  location: { nodeName: string; line?: number; column?: number };
  details?: Record<string, unknown>;
}

export interface TypeWarning {
  category: 'empty_category' | 'unresolved_glob' | 'unused_output' | 'validation_disabled';
  message: string;
  location: { nodeName: string };
}

export interface ResolvedWorkflowPlan {
  nodes: Map<string, ResolvedNode>;
  converterInsertions: ConverterInsertion[];
}

export interface ResolvedNode {
  kind: 'tool' | 'reasoning';
  resolvedToolName?: string;
  resolvedVersion?: number;
  resolvedToolset?: string[];
  resolvedBackend?: string;
}

export interface ConverterInsertion {
  upstreamNode: string;
  upstreamPort: string;
  downstreamNode: string;
  downstreamPort: string;
  converterTool: string;
  converterVersion: number;
}

// ---------- Supported backends ----------

const VALID_BACKENDS = new Set(['claude', 'openai-compat', 'ollama']);

// ---------- Input source parsing ----------

type InputSource =
  | { kind: 'literal'; value: unknown; schemaHint: string }
  | { kind: 'config'; key: string }
  | { kind: 'upstream'; nodeName: string; portName: string }
  | { kind: 'unknown' };

function parseInputSourceExpr(value: unknown): InputSource {
  if (typeof value === 'string') {
    // Upstream reference: ${nodeName.outputs.portName}
    const upstreamMatch = value.match(/^\$\{(\w+)\.outputs\.(\w+)\}$/);
    if (upstreamMatch) {
      return { kind: 'upstream', nodeName: upstreamMatch[1], portName: upstreamMatch[2] };
    }
    // Config substitution: {{KEY}}
    const configMatch = value.match(/^\{\{(\w+)\}\}$/);
    if (configMatch) {
      return { kind: 'config', key: configMatch[1] };
    }
    return { kind: 'literal', value, schemaHint: 'String' };
  }
  if (typeof value === 'number') {
    return { kind: 'literal', value, schemaHint: Number.isInteger(value) ? 'Integer' : 'Float' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'literal', value, schemaHint: 'Boolean' };
  }
  if (value === null) {
    return { kind: 'literal', value, schemaHint: 'Null' };
  }
  if (Array.isArray(value)) {
    return { kind: 'literal', value, schemaHint: 'JsonArray' };
  }
  if (typeof value === 'object') {
    return { kind: 'literal', value, schemaHint: 'JsonObject' };
  }
  return { kind: 'unknown' };
}

// ---------- Schema name comparison ----------

function parsePortSchema(schemaName: string): TypeExpr | undefined {
  if (schemaName.includes('[')) {
    try { return parseTypeExpr(schemaName); } catch { return undefined; }
  }
  return undefined;
}

function schemasCompatible(
  sourceSchemaName: string,
  targetSchemaName: string,
  sourceParsed: TypeExpr | undefined,
  targetParsed: TypeExpr | undefined,
): boolean {
  // Both parametrized: use structural equality
  if (sourceParsed && targetParsed) {
    return typeExprEqual(sourceParsed, targetParsed);
  }
  // Both named (the common case): string equality
  return sourceSchemaName === targetSchemaName;
}

// ---------- Error message formatters ----------

function fmtTypeMismatch(opts: {
  workflowName: string;
  nodeName: string;
  portName: string;
  toolName: string;
  targetSchema: string;
  upstreamNode: string;
  upstreamPort: string;
  sourceSchema: string;
}): string {
  return (
    `Type mismatch in workflow \`${opts.workflowName}\` at node \`${opts.nodeName}\`:\n` +
    `  The input port \`${opts.portName}\` of tool \`${opts.toolName}\` expects schema \`${opts.targetSchema}\`,\n` +
    `  but the upstream node \`${opts.upstreamNode}\` (output port \`${opts.upstreamPort}\`) produces schema \`${opts.sourceSchema}\`.\n\n` +
    `  No converter is registered for \`${opts.sourceSchema} \u2192 ${opts.targetSchema}\`.\n\n` +
    `  Possible fixes:\n` +
    `    1. Change the upstream tool's output to declare \`${opts.targetSchema}\` directly.\n` +
    `    2. Register a converter from \`${opts.sourceSchema}\` to \`${opts.targetSchema}\`.\n` +
    `    3. Insert an intermediate tool node that wraps the value.`
  );
}

function fmtToolNotFound(nodeName: string, toolName: string): string {
  return `Tool not found at node \`${nodeName}\`: no tool named \`${toolName}\` is registered in the registry.`;
}

function fmtMissingRequired(nodeName: string, toolName: string, portName: string): string {
  return `Missing required input at node \`${nodeName}\`: tool \`${toolName}\` requires port \`${portName}\` but no value was provided.`;
}

function fmtInvalidReference(nodeName: string, ref: string): string {
  return `Invalid upstream reference at node \`${nodeName}\`: \`${ref}\` does not resolve to a known node and output port.`;
}

function fmtInvalidBackend(nodeName: string, backend: string): string {
  return `Invalid backend at node \`${nodeName}\`: \`${backend}\` is not supported. Supported backends: ${[...VALID_BACKENDS].join(', ')}.`;
}

// ---------- Main checker ----------

export function checkWorkflow(
  parsed: ParsedWorkflowYaml,
  registry: RegistryClient,
  _schemas: SchemaRegistry,
): TypeCheckResult {
  const errors: TypeCheckError[] = [];
  const warnings: TypeWarning[] = [];
  const resolvedNodes = new Map<string, ResolvedNode>();
  const converterInsertions: ConverterInsertion[] = [];

  // Port schema table: nodeName → portName → { schemaName, parsed? }
  const portSchemaTable = new Map<string, Map<string, { schemaName: string; parsed?: TypeExpr }>>();

  const workflowName = parsed.name ?? '<unnamed>';
  // WorkflowConfig.nodes is Record<string, WorkflowNodeDef>
  const nodeEntries = Object.entries(parsed.nodes ?? {});
  const nodeNames = new Set(nodeEntries.map(([name]) => name));

  for (const [nodeName, node] of nodeEntries) {
    if (node.kind === 'tool') {
      // Step 1: Resolve tool
      const toolName: string = node.tool ?? '';
      const toolRecord = registry.get(toolName);
      if (!toolRecord) {
        errors.push({
          category: 'tool_not_found',
          message: fmtToolNotFound(nodeName, toolName),
          location: { nodeName },
        });
        // Record an empty output map so downstream references fail gracefully
        portSchemaTable.set(nodeName, new Map());
        continue;
      }

      resolvedNodes.set(nodeName, {
        kind: 'tool',
        resolvedToolName: toolRecord.name,
        resolvedVersion: toolRecord.version,
      });

      // Step 2 & 3: Resolve inputs and check compatibility
      // WorkflowNodeDef uses toolInputs (not inputs) for tool nodes
      const nodeInputs: Record<string, unknown> = node.toolInputs ?? {};

      for (const portSpec of toolRecord.inputs) {
        const portName = portSpec.name;
        const targetSchemaName = portSpec.schemaName;

        const rawValue = nodeInputs[portName];

        if (rawValue === undefined) {
          // Check required
          if (portSpec.required) {
            errors.push({
              category: 'missing_required_input',
              message: fmtMissingRequired(nodeName, toolName, portName),
              location: { nodeName },
            });
          }
          continue;
        }

        const source = parseInputSourceExpr(rawValue);

        let resolvedSourceSchema: string | null = null;

        if (source.kind === 'literal') {
          resolvedSourceSchema = source.schemaHint;
        } else if (source.kind === 'config') {
          // Config substitutions: infer schema from config value if present,
          // otherwise accept (cannot validate config at parse time).
          const configVal = (parsed.config as Record<string, unknown>)?.[source.key];
          if (configVal !== undefined) {
            const inner = parseInputSourceExpr(configVal);
            if (inner.kind === 'literal') {
              resolvedSourceSchema = inner.schemaHint;
            } else {
              continue;
            }
          } else {
            // Key not in config — cannot resolve; skip
            continue;
          }
        } else if (source.kind === 'upstream') {
          const upstreamPortMap = portSchemaTable.get(source.nodeName);
          const upstreamPortInfo = upstreamPortMap?.get(source.portName);
          if (!upstreamPortInfo) {
            errors.push({
              category: 'invalid_reference',
              message: fmtInvalidReference(
                nodeName,
                `\${${source.nodeName}.outputs.${source.portName}}`,
              ),
              location: { nodeName },
            });
            continue;
          }
          resolvedSourceSchema = upstreamPortInfo.schemaName;

          const sourceParsed = parsePortSchema(resolvedSourceSchema);
          const targetParsed = parsePortSchema(targetSchemaName);

          // Check compatibility
          const compatible = schemasCompatible(
            resolvedSourceSchema,
            targetSchemaName,
            sourceParsed,
            targetParsed,
          );

          if (!compatible) {
            // Try converter
            const converter = registry.findConverter(resolvedSourceSchema, targetSchemaName);
            if (converter) {
              converterInsertions.push({
                upstreamNode: source.nodeName,
                upstreamPort: source.portName,
                downstreamNode: nodeName,
                downstreamPort: portName,
                converterTool: converter.toolName,
                converterVersion: converter.toolVersion,
              });
            } else {
              errors.push({
                category: 'type_mismatch',
                message: fmtTypeMismatch({
                  workflowName,
                  nodeName,
                  portName,
                  toolName,
                  targetSchema: targetSchemaName,
                  upstreamNode: source.nodeName,
                  upstreamPort: source.portName,
                  sourceSchema: resolvedSourceSchema,
                }),
                location: { nodeName },
                details: {
                  sourceSchema: resolvedSourceSchema,
                  targetSchema: targetSchemaName,
                  upstreamNode: source.nodeName,
                  upstreamPort: source.portName,
                },
              });
            }
          }
          // Skip the generic literal compatibility check below
          continue;
        } else {
          continue; // unknown source kind
        }

        // For literals: basic schema compatibility
        if (resolvedSourceSchema && resolvedSourceSchema !== targetSchemaName) {
          const sourceParsed = parsePortSchema(resolvedSourceSchema);
          const targetParsed = parsePortSchema(targetSchemaName);
          const compatible = schemasCompatible(resolvedSourceSchema, targetSchemaName, sourceParsed, targetParsed);
          if (!compatible) {
            errors.push({
              category: 'type_mismatch',
              message: `Type mismatch at node \`${nodeName}\` port \`${portName}\`: literal value has inferred schema \`${resolvedSourceSchema}\` but tool \`${toolName}\` expects \`${targetSchemaName}\`.`,
              location: { nodeName },
            });
          }
        }
      }

      // Step 6: Record output schemas in port schema table
      const outMap = new Map<string, { schemaName: string; parsed?: TypeExpr }>();
      for (const outPortSpec of toolRecord.outputs) {
        outMap.set(outPortSpec.name, {
          schemaName: outPortSpec.schemaName,
          parsed: parsePortSchema(outPortSpec.schemaName),
        });
      }
      portSchemaTable.set(nodeName, outMap);

    } else if (node.kind === 'reasoning') {
      // Step 1: Validate backend
      const backend: string = node.backend ?? 'claude';
      if (!VALID_BACKENDS.has(backend)) {
        errors.push({
          category: 'invalid_backend',
          message: fmtInvalidBackend(nodeName, backend),
          location: { nodeName },
        });
      }

      // Step 2: Expand toolset
      const resolvedToolNames: string[] = [];
      for (const toolsetEntry of (node.toolset ?? [])) {
        if ('name' in toolsetEntry && toolsetEntry.name) {
          const t = registry.get(toolsetEntry.name);
          if (!t) {
            errors.push({
              category: 'tool_not_found',
              message: fmtToolNotFound(nodeName, toolsetEntry.name),
              location: { nodeName },
            });
          } else {
            resolvedToolNames.push(t.name);
          }
        } else if ('category' in toolsetEntry && toolsetEntry.category) {
          const tools = registry.list({ category: toolsetEntry.category });
          if (tools.length === 0) {
            warnings.push({
              category: 'empty_category',
              message: `Toolset in node \`${nodeName}\` references category \`${toolsetEntry.category}\` which has no registered tools.`,
              location: { nodeName },
            });
          } else {
            resolvedToolNames.push(...tools.map((t) => t.name));
          }
        }
      }

      resolvedNodes.set(nodeName, {
        kind: 'reasoning',
        resolvedBackend: backend,
        resolvedToolset: resolvedToolNames,
      });
    }

    // Cross-node: validate depends_on references
    for (const dep of (node.depends_on ?? [])) {
      if (!nodeNames.has(dep)) {
        errors.push({
          category: 'invalid_reference',
          message: `Node \`${nodeName}\` depends_on \`${dep}\` which is not a declared node in this workflow.`,
          location: { nodeName },
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    resolvedPlan: { nodes: resolvedNodes, converterInsertions },
  };
}
