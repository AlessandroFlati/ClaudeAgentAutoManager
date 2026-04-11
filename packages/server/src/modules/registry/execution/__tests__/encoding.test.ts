import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import {
  encodeInputs,
  decodeOutputs,
  buildEnvelope,
  EncodingError,
} from '../encoding.js';
import { SchemaRegistry } from '../../schemas/schema-registry.js';
import { ValueStore } from '../value-store.js';
import type { ValueRef, ValueEnvelope } from '../../types.js';

// Helpers shared across new describes
function makeStore(): ValueStore {
  return new ValueStore('test-run', os.tmpdir());
}

describe('encodeInputs', () => {
  const schemas = new SchemaRegistry();

  it('passes primitive values through unchanged', () => {
    const inputSchemas = { a: 'Integer', b: 'String', c: 'Boolean' };
    const result = encodeInputs({ a: 1, b: 'x', c: true }, inputSchemas, schemas, null);
    expect(result.encoded).toEqual({ a: 1, b: 'x', c: true });
  });

  it('rejects pickle schema on inputs', () => {
    const inputSchemas = { m: 'NumpyArray' };
    expect(() => encodeInputs({ m: [1, 2, 3] }, inputSchemas, schemas, null)).toThrow(EncodingError);
  });

  it('rejects unknown schema', () => {
    const inputSchemas = { a: 'Bogus' };
    expect(() => encodeInputs({ a: 1 }, inputSchemas, schemas, null)).toThrow(/unknown schema/i);
  });
});

describe('decodeOutputs', () => {
  const schemas = new SchemaRegistry();

  it('passes primitive values through unchanged', () => {
    const outputSchemas = { r: 'Integer' };
    expect(decodeOutputs({ r: 7 }, outputSchemas, schemas, null, 'n', 'p')).toEqual({ r: 7 });
  });

  it('preserves pickle envelopes opaquely for structured outputs when store is null', () => {
    const envelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'abc' };
    const outputSchemas = { arr: 'NumpyArray' };
    expect(decodeOutputs({ arr: envelope }, outputSchemas, schemas, null, 'n', 'p')).toEqual({ arr: envelope });
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

describe('encodeInputs — Phase 2 ValueRef handling', () => {
  const schemas = new SchemaRegistry();

  it('passes a ValueRef through unchanged when valueStore is provided', () => {
    const store = makeStore();
    const env: ValueEnvelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'AAAA' };
    const handle = store.store(env, null, 'node', 'port');
    const ref: ValueRef = { _type: 'value_ref', _handle: handle, _schema: 'NumpyArray' };
    // For this test we just verify encodeInputs passes the ref through as-is
    // (the value_refs map building is tested separately)
    const inputSchemas = { arr: 'NumpyArray' };
    // We supply the ref — encodeInputs must not throw
    const result = encodeInputs({ arr: ref }, inputSchemas, schemas, store);
    expect(result.encoded['arr']).toEqual(ref);
  });

  it('rejects a ValueRef when valueStore is null', () => {
    const ref: ValueRef = { _type: 'value_ref', _handle: 'vs-test', _schema: 'NumpyArray' };
    const inputSchemas = { arr: 'NumpyArray' };
    expect(() => encodeInputs({ arr: ref }, inputSchemas, schemas, null)).toThrow(EncodingError);
  });

  it('rejects a raw JS value for a pickle schema (unchanged behavior)', () => {
    const inputSchemas = { arr: 'NumpyArray' };
    expect(() => encodeInputs({ arr: [1, 2, 3] }, inputSchemas, schemas, null)).toThrow(EncodingError);
    expect(() => encodeInputs({ arr: [1, 2, 3] }, inputSchemas, schemas, makeStore())).toThrow(EncodingError);
  });

  it('builds value_refs map from ValueRef inputs using the store', () => {
    const store = makeStore();
    const env: ValueEnvelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'BBBB' };
    const handle = store.store(env, null, 'upstream', 'arr');
    const ref: ValueRef = { _type: 'value_ref', _handle: handle, _schema: 'NumpyArray' };

    const inputSchemas = { arr: 'NumpyArray' };
    const result = encodeInputs({ arr: ref }, inputSchemas, schemas, store);
    expect(result.valueRefs).toBeDefined();
    expect(result.valueRefs![handle]).toEqual(env);
  });

  it('throws validation error when ValueRef handle is not in store', () => {
    const store = makeStore();
    const ref: ValueRef = { _type: 'value_ref', _handle: 'vs-ghost', _schema: 'NumpyArray' };
    const inputSchemas = { arr: 'NumpyArray' };
    expect(() => encodeInputs({ arr: ref }, inputSchemas, schemas, store)).toThrow(
      /handle_not_found/,
    );
  });
});

describe('decodeOutputs — Phase 2 ValueStore registration', () => {
  const schemas = new SchemaRegistry();

  it('returns a ValueRef when valueStore is provided and output is pickle_b64', () => {
    const store = makeStore();
    const envelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'CCCC' };
    const outputSchemas = { arr: 'NumpyArray' };
    const result = decodeOutputs({ arr: envelope }, outputSchemas, schemas, store, 'myNode', 'myPort');
    expect((result['arr'] as ValueRef)._type).toBe('value_ref');
    expect((result['arr'] as ValueRef)._schema).toBe('NumpyArray');
    expect(typeof (result['arr'] as ValueRef)._handle).toBe('string');
  });

  it('stores the envelope in the value store after decodeOutputs', () => {
    const store = makeStore();
    const envelope = { _schema: 'DataFrame', _encoding: 'pickle_b64', _data: 'DDDD' };
    const outputSchemas = { df: 'DataFrame' };
    const result = decodeOutputs({ df: envelope }, outputSchemas, schemas, store, 'myNode', 'df');
    const handle = (result['df'] as ValueRef)._handle;
    expect(store.has(handle)).toBe(true);
    expect(store.resolve(handle)!.envelope._data).toBe('DDDD');
  });

  it('extracts _summary from envelope and stores it', () => {
    const store = makeStore();
    const summary = { schema: 'NumpyArray', ndim: 1, size: 3 };
    const envelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'EEEE', _summary: summary };
    const outputSchemas = { arr: 'NumpyArray' };
    decodeOutputs({ arr: envelope }, outputSchemas, schemas, store, 'n', 'p');
    const handles = store.handles();
    expect(handles.length).toBe(1);
    expect(store.resolve(handles[0])!.summary).toEqual(summary);
  });

  it('returns raw envelope when valueStore is null (backward compat)', () => {
    const schemas = new SchemaRegistry();
    const envelope = { _schema: 'NumpyArray', _encoding: 'pickle_b64', _data: 'FFFF' };
    const outputSchemas = { arr: 'NumpyArray' };
    const result = decodeOutputs({ arr: envelope }, outputSchemas, schemas, null, 'n', 'p');
    expect(result['arr']).toEqual(envelope);
  });

  it('primitive outputs are unchanged regardless of valueStore', () => {
    const store = makeStore();
    const outputSchemas = { r: 'Integer' };
    const result = decodeOutputs({ r: 42 }, outputSchemas, schemas, store, 'n', 'p');
    expect(result['r']).toBe(42);
  });
});
