// Parametrized type expression parser for the Plurics type system.
// Spec: docs/superpowers/specs/2026-04-12-tool-registry-phase-4-design.md §10
// Design doc: docs/design/type-system.md §3.2

export type TypeExpr =
  | { kind: 'named'; name: string }
  | { kind: 'parametrized'; outer: string; params: TypeExpr[] };

// The 7 primitive schema names. Structured types may NOT appear as type parameters.
const PRIMITIVE_NAMES = new Set([
  'Integer', 'Float', 'String', 'Boolean', 'Null', 'JsonObject', 'JsonArray',
]);

// Parametrized container names (outer names that accept parameters).
const CONTAINER_NAMES = new Set(['List', 'Dict', 'Optional', 'Tuple']);

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

// ---------- Tokenizer ----------

type Token =
  | { type: 'name'; value: string }
  | { type: 'lbracket' }
  | { type: 'rbracket' }
  | { type: 'comma' }
  | { type: 'eof' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.trim();
  while (i < s.length) {
    const ch = s[i];
    if (ch === '[') { tokens.push({ type: 'lbracket' }); i++; }
    else if (ch === ']') { tokens.push({ type: 'rbracket' }); i++; }
    else if (ch === ',') { tokens.push({ type: 'comma' }); i++; }
    else if (/\s/.test(ch)) { i++; }
    else if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      tokens.push({ type: 'name', value: s.slice(i, j) });
      i = j;
    } else {
      throw new ParseError(`Unexpected character '${ch}' at position ${i} in type expression: "${input}"`);
    }
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

// ---------- Recursive descent parser ----------

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(type: Token['type']): Token {
    const tok = this.tokens[this.pos];
    if (tok.type !== type) {
      throw new ParseError(
        `Expected token '${type}' but got '${tok.type}' at position ${this.pos}.`,
      );
    }
    this.pos++;
    return tok;
  }

  parse(): TypeExpr {
    const expr = this.parseExpr();
    if (this.peek().type !== 'eof') {
      throw new ParseError(`Trailing tokens after type expression at position ${this.pos}.`);
    }
    return expr;
  }

  private parseExpr(): TypeExpr {
    const nameTok = this.consume('name') as { type: 'name'; value: string };
    const name = nameTok.value;

    if (this.peek().type === 'lbracket') {
      // Parametrized form: Outer[T, ...]
      if (!CONTAINER_NAMES.has(name)) {
        throw new ParseError(
          `'${name}' is not a supported parametrized container (List, Dict, Optional, Tuple).`,
        );
      }
      this.consume('lbracket');
      const params: TypeExpr[] = [];
      // Parse at least one parameter
      params.push(this.parseParam(name));
      while (this.peek().type === 'comma') {
        this.consume('comma');
        params.push(this.parseParam(name));
      }
      this.consume('rbracket');
      return { kind: 'parametrized', outer: name, params };
    }

    return { kind: 'named', name };
  }

  private parseParam(container: string): TypeExpr {
    // Peek at the name token — if it is a structured type used as a param, reject it.
    const tok = this.peek();
    if (tok.type !== 'name') {
      throw new ParseError(`Expected a type name inside '${container}[...]', got '${tok.type}'.`);
    }
    const name = tok.value;
    // Structured types are not in PRIMITIVE_NAMES and not in CONTAINER_NAMES.
    // They are invalid as parameters.
    if (!PRIMITIVE_NAMES.has(name) && !CONTAINER_NAMES.has(name)) {
      throw new ParseError(
        `Structured type '${name}' cannot be used as a type parameter in '${container}[${name}]'. ` +
        `Only primitive types (${[...PRIMITIVE_NAMES].join(', ')}) may appear as parameters.`,
      );
    }
    return this.parseExpr();
  }
}

// ---------- Public API ----------

/**
 * Parse a type expression string into a TypeExpr tree.
 * Throws ParseError on malformed input.
 */
export function parseTypeExpr(input: string): TypeExpr {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  return parser.parse();
}

/**
 * Structural equality for TypeExpr trees.
 */
export function typeExprEqual(a: TypeExpr, b: TypeExpr): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'named' && b.kind === 'named') return a.name === b.name;
  if (a.kind === 'parametrized' && b.kind === 'parametrized') {
    if (a.outer !== b.outer) return false;
    if (a.params.length !== b.params.length) return false;
    return a.params.every((p, i) => typeExprEqual(p, b.params[i]));
  }
  return false;
}

/**
 * Render a TypeExpr back to its canonical string form.
 */
export function typeExprToString(e: TypeExpr): string {
  if (e.kind === 'named') return e.name;
  return `${e.outer}[${e.params.map(typeExprToString).join(', ')}]`;
}
