import { describe, it, expect } from 'vitest';
import {
  encodeInputs,
  decodeOutputs,
  buildEnvelope,
  EncodingError,
} from '../encoding.js';
import { SchemaRegistry } from '../../schemas/schema-registry.js';

describe('encodeInputs', () => {
  const schemas = new SchemaRegistry();

  it('passes primitive values through unchanged', () => {
    const inputSchemas = { a: 'Integer', b: 'String', c: 'Boolean' };
    const encoded = encodeInputs({ a: 1, b: 'x', c: true }, inputSchemas, schemas);
    expect(encoded).toEqual({ a: 1, b: 'x', c: true });
  });

  it('rejects pickle schema on inputs', () => {
    const inputSchemas = { m: 'NumpyArray' };
    expect(() => encodeInputs({ m: [1, 2, 3] }, inputSchemas, schemas)).toThrow(EncodingError);
  });

  it('rejects unknown schema', () => {
    const inputSchemas = { a: 'Bogus' };
    expect(() => encodeInputs({ a: 1 }, inputSchemas, schemas)).toThrow(/unknown schema/i);
  });
});

describe('decodeOutputs', () => {
  const schemas = new SchemaRegistry();

  it('passes primitive values through unchanged', () => {
    const outputSchemas = { r: 'Integer' };
    expect(decodeOutputs({ r: 7 }, outputSchemas, schemas)).toEqual({ r: 7 });
  });

  it('preserves pickle envelopes opaquely for structured outputs', () => {
    const envelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'abc' };
    const outputSchemas = { arr: 'NumpyArray' };
    expect(decodeOutputs({ arr: envelope }, outputSchemas, schemas)).toEqual({ arr: envelope });
  });
});

describe('buildEnvelope', () => {
  it('returns a string with inputs, input_schemas, output_schemas', () => {
    const text = buildEnvelope({ a: 1 }, { a: 'Integer' }, { r: 'Integer' });
    const parsed = JSON.parse(text);
    expect(parsed.inputs).toEqual({ a: 1 });
    expect(parsed.input_schemas).toEqual({ a: 'Integer' });
    expect(parsed.output_schemas).toEqual({ r: 'Integer' });
  });
});
