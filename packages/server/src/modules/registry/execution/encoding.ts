import type { SchemaRegistry } from '../schemas/schema-registry.js';

export class EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodingError';
  }
}

export function encodeInputs(
  values: Record<string, unknown>,
  inputSchemas: Record<string, string>,
  schemas: SchemaRegistry,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const schemaName = inputSchemas[name];
    if (!schemaName) {
      throw new EncodingError(`input "${name}" has no declared schema`);
    }
    if (!schemas.has(schemaName)) {
      throw new EncodingError(`unknown schema "${schemaName}" on input "${name}"`);
    }
    if (schemas.encodingOf(schemaName) === 'pickle_b64') {
      throw new EncodingError(
        `pickle input schemas are not supported in phase 1+2 (input "${name}" has schema "${schemaName}")`,
      );
    }
    out[name] = value;
  }
  return out;
}

export function decodeOutputs(
  raw: Record<string, unknown>,
  outputSchemas: Record<string, string>,
  schemas: SchemaRegistry,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const schemaName = outputSchemas[name] ?? 'JsonObject';
    if (schemas.has(schemaName) && schemas.encodingOf(schemaName) === 'pickle_b64') {
      // Opaque passthrough — caller treats the envelope as a sealed handle.
      out[name] = value;
    } else {
      out[name] = value;
    }
  }
  return out;
}

export function buildEnvelope(
  inputs: Record<string, unknown>,
  inputSchemas: Record<string, string>,
  outputSchemas: Record<string, string>,
): string {
  return JSON.stringify({
    inputs,
    input_schemas: inputSchemas,
    output_schemas: outputSchemas,
  });
}
