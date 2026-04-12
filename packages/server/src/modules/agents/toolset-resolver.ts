/**
 * Toolset Resolver — Node Runtimes Phase 3
 *
 * Translates a workflow YAML `toolset` array into:
 *   - `ToolDefinition[]` (backend-neutral tool descriptions)
 *   - `toolNameMap` Map<underscore_name, dotted.name> for dispatch reverse lookup
 *
 * Resolution strategies:
 *   - `{ category: "name" }` → registryClient.listToolsByCategory(name)
 *   - `{ name: "exact.name" }` → registryClient.getTool(name)
 *   - `{ name: "glob.*" }` → registryClient.listTools() filtered by micromatch
 */

import micromatch from 'micromatch';
import type { ToolRecord } from '../registry/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ToolsetEntry =
  | { category: string }
  | { name: string };

export interface JsonSchemaProperty {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

export interface ToolDefinition {
  name: string;               // underscore form: "sklearn_pca"
  description: string;
  inputSchema: ToolInputSchema;
}

export interface ResolvedToolset {
  definitions: ToolDefinition[];
  toolNameMap: Map<string, string>;  // underscore_name → dotted.name
}

export type ResolverErrorCategory = 'tool_not_found' | 'toolset_empty_glob';

export class ResolverError extends Error {
  readonly category: ResolverErrorCategory;
  constructor(category: ResolverErrorCategory, message: string) {
    super(message);
    this.name = 'ResolverError';
    this.category = category;
  }
}

// ---------------------------------------------------------------------------
// Minimal interface — only the methods the resolver needs from RegistryClient
// ---------------------------------------------------------------------------

export interface RegistryLookup {
  listToolsByCategory(category: string): Promise<ToolRecord[]>;
  getTool(name: string): Promise<ToolRecord | null>;
  listTools(): Promise<ToolRecord[]>;
}

// ---------------------------------------------------------------------------
// Schema mapping
// ---------------------------------------------------------------------------

const STRUCTURED_SCHEMAS = new Set([
  'DataFrame', 'NumpyArray', 'SymbolicExpr', 'Series',
]);

const PRIMITIVE_SCHEMA_MAP: Record<string, JsonSchemaProperty['type']> = {
  Integer: 'integer',
  Float: 'number',
  Boolean: 'boolean',
  String: 'string',
  JsonValue: 'object',
  FilePath: 'string',
};

function portToJsonSchemaProperty(schemaName: string, description: string | null): JsonSchemaProperty {
  if (STRUCTURED_SCHEMAS.has(schemaName)) {
    const hint = `${schemaName}. Pass a value_ref handle from a prior tool call.`;
    return { type: 'object', description: description ? `${description} ${hint}` : hint };
  }

  const primitiveType = PRIMITIVE_SCHEMA_MAP[schemaName] ?? 'string';
  const prop: JsonSchemaProperty = { type: primitiveType };

  if (description) {
    prop.description = description;
  } else if (schemaName === 'FilePath') {
    prop.description = '(file path)';
  }

  return prop;
}

// ---------------------------------------------------------------------------
// ToolRecord → ToolDefinition
// ---------------------------------------------------------------------------

function toolRecordToDefinition(tool: ToolRecord): ToolDefinition {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const port of tool.inputs) {
    properties[port.name] = portToJsonSchemaProperty(port.schemaName, port.description);
    if (port.required) {
      required.push(port.name);
    }
  }

  return {
    name: tool.name.replace(/\./g, '_'),
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
  };
}

function hasGlob(name: string): boolean {
  return name.includes('*') || name.includes('?');
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

export async function resolveToolset(
  toolset: ToolsetEntry[],
  registry: RegistryLookup,
): Promise<ResolvedToolset> {
  if (toolset.length === 0) {
    return { definitions: [], toolNameMap: new Map() };
  }

  const seen = new Map<string, ToolRecord>();  // dotted.name → ToolRecord

  for (const entry of toolset) {
    if ('category' in entry) {
      const tools = await registry.listToolsByCategory(entry.category);
      for (const tool of tools) {
        seen.set(tool.name, tool);
      }
    } else if ('name' in entry) {
      if (hasGlob(entry.name)) {
        const all = await registry.listTools();
        const matched = all.filter(t => micromatch.isMatch(t.name, entry.name));
        if (matched.length === 0) {
          throw new ResolverError(
            'toolset_empty_glob',
            `Toolset glob pattern "${entry.name}" matched zero registered tools.`,
          );
        }
        for (const tool of matched) {
          seen.set(tool.name, tool);
        }
      } else {
        const tool = await registry.getTool(entry.name);
        if (tool === null) {
          throw new ResolverError(
            'tool_not_found',
            `Toolset entry references unknown tool "${entry.name}".`,
          );
        }
        seen.set(tool.name, tool);
      }
    }
  }

  const definitions: ToolDefinition[] = [];
  const toolNameMap = new Map<string, string>();

  for (const [dottedName, tool] of seen) {
    const def = toolRecordToDefinition(tool);
    definitions.push(def);
    toolNameMap.set(def.name, dottedName);
  }

  return { definitions, toolNameMap };
}
