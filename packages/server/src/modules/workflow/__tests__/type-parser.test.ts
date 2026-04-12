import { describe, it, expect } from 'vitest';
import {
  parseTypeExpr,
  typeExprEqual,
  typeExprToString,
  ParseError,
} from '../type-parser.js';

describe('parseTypeExpr — named types', () => {
  it('parses a primitive name', () => {
    const e = parseTypeExpr('Integer');
    expect(e).toEqual({ kind: 'named', name: 'Integer' });
  });

  it('parses a structured name', () => {
    const e = parseTypeExpr('OhlcFrame');
    expect(e).toEqual({ kind: 'named', name: 'OhlcFrame' });
  });

  it('trims surrounding whitespace', () => {
    const e = parseTypeExpr('  Float  ');
    expect(e).toEqual({ kind: 'named', name: 'Float' });
  });
});

describe('parseTypeExpr — parametrized types', () => {
  it('parses List[Integer]', () => {
    const e = parseTypeExpr('List[Integer]');
    expect(e).toEqual({
      kind: 'parametrized',
      outer: 'List',
      params: [{ kind: 'named', name: 'Integer' }],
    });
  });

  it('parses Optional[Float]', () => {
    const e = parseTypeExpr('Optional[Float]');
    expect(e.kind).toBe('parametrized');
    if (e.kind === 'parametrized') {
      expect(e.outer).toBe('Optional');
      expect(e.params).toHaveLength(1);
    }
  });

  it('parses Dict[String, Integer]', () => {
    const e = parseTypeExpr('Dict[String, Integer]');
    expect(e).toEqual({
      kind: 'parametrized',
      outer: 'Dict',
      params: [
        { kind: 'named', name: 'String' },
        { kind: 'named', name: 'Integer' },
      ],
    });
  });

  it('parses Tuple[Integer, Float, String]', () => {
    const e = parseTypeExpr('Tuple[Integer, Float, String]');
    if (e.kind === 'parametrized') {
      expect(e.outer).toBe('Tuple');
      expect(e.params).toHaveLength(3);
    }
  });

  it('parses nested List[List[Integer]]', () => {
    const e = parseTypeExpr('List[List[Integer]]');
    expect(e).toEqual({
      kind: 'parametrized',
      outer: 'List',
      params: [
        {
          kind: 'parametrized',
          outer: 'List',
          params: [{ kind: 'named', name: 'Integer' }],
        },
      ],
    });
  });

  it('parses Optional[List[Float]]', () => {
    const e = parseTypeExpr('Optional[List[Float]]');
    expect(e.kind).toBe('parametrized');
  });
});

describe('parseTypeExpr — error cases', () => {
  it('throws ParseError for structured type as parameter', () => {
    expect(() => parseTypeExpr('List[OhlcFrame]')).toThrow(ParseError);
    expect(() => parseTypeExpr('List[DataFrame]')).toThrow(ParseError);
    expect(() => parseTypeExpr('Optional[NumpyArray]')).toThrow(ParseError);
  });

  it('throws ParseError for unknown container outer', () => {
    expect(() => parseTypeExpr('Map[String, Integer]')).toThrow(ParseError);
  });

  it('throws ParseError for empty brackets', () => {
    expect(() => parseTypeExpr('List[]')).toThrow(ParseError);
  });

  it('throws ParseError for trailing garbage', () => {
    expect(() => parseTypeExpr('Integer extra')).toThrow(ParseError);
  });

  it('throws ParseError for unclosed bracket', () => {
    expect(() => parseTypeExpr('List[Integer')).toThrow(ParseError);
  });

  it('throws ParseError for unexpected character', () => {
    expect(() => parseTypeExpr('List<Integer>')).toThrow(ParseError);
  });
});

describe('typeExprEqual', () => {
  it('named types with same name are equal', () => {
    expect(typeExprEqual(
      { kind: 'named', name: 'Integer' },
      { kind: 'named', name: 'Integer' },
    )).toBe(true);
  });

  it('named types with different names are not equal', () => {
    expect(typeExprEqual(
      { kind: 'named', name: 'Integer' },
      { kind: 'named', name: 'Float' },
    )).toBe(false);
  });

  it('named vs parametrized are not equal', () => {
    expect(typeExprEqual(
      { kind: 'named', name: 'List' },
      { kind: 'parametrized', outer: 'List', params: [{ kind: 'named', name: 'Integer' }] },
    )).toBe(false);
  });

  it('List[Integer] equals List[Integer]', () => {
    expect(typeExprEqual(
      parseTypeExpr('List[Integer]'),
      parseTypeExpr('List[Integer]'),
    )).toBe(true);
  });

  it('List[Integer] does not equal List[Float]', () => {
    expect(typeExprEqual(
      parseTypeExpr('List[Integer]'),
      parseTypeExpr('List[Float]'),
    )).toBe(false);
  });

  it('Dict[String, Integer] equals Dict[String, Integer]', () => {
    expect(typeExprEqual(
      parseTypeExpr('Dict[String, Integer]'),
      parseTypeExpr('Dict[String, Integer]'),
    )).toBe(true);
  });

  it('Dict[String, Integer] does not equal Dict[Integer, String]', () => {
    expect(typeExprEqual(
      parseTypeExpr('Dict[String, Integer]'),
      parseTypeExpr('Dict[Integer, String]'),
    )).toBe(false);
  });
});

describe('typeExprToString', () => {
  const roundTrip = (s: string) => typeExprToString(parseTypeExpr(s));

  it('round-trips Integer', () => expect(roundTrip('Integer')).toBe('Integer'));
  it('round-trips List[Integer]', () => expect(roundTrip('List[Integer]')).toBe('List[Integer]'));
  it('round-trips Dict[String, Float]', () => expect(roundTrip('Dict[String, Float]')).toBe('Dict[String, Float]'));
  it('round-trips Optional[Boolean]', () => expect(roundTrip('Optional[Boolean]')).toBe('Optional[Boolean]'));
  it('round-trips Tuple[Integer, Float, String]', () =>
    expect(roundTrip('Tuple[Integer, Float, String]')).toBe('Tuple[Integer, Float, String]'));
  it('round-trips List[List[Integer]]', () =>
    expect(roundTrip('List[List[Integer]]')).toBe('List[List[Integer]]'));
});
