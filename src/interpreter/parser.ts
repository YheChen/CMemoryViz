// Recursive-descent parser for the supported C subset.

import { Token, tokenize } from "./lexer";
import * as A from "./ast";

export class ParseError extends Error {
  constructor(
    message: string,
    public line: number
  ) {
    super(`Line ${line}: ${message}`);
  }
}

const TYPE_KEYWORDS = new Set([
  "int",
  "char",
  "void",
  "float",
  "double",
  "struct",
  "union",
  "enum",
  "unsigned",
  "const",
]);

export function parse(src: string): A.Program {
  const tokens = tokenize(src);
  return new Parser(tokens).parseProgram();
}

class Parser {
  private pos = 0;
  private structNames = new Set<string>();
  private typedefs = new Map<string, A.CType>();
  private enumConstants: Record<string, number> = {};
  private structs: A.StructDecl[] = [];
  private anonCount = 0;

  constructor(private tokens: Token[]) {}

  private peek(o = 0): Token {
    return this.tokens[Math.min(this.pos + o, this.tokens.length - 1)];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private get line(): number {
    return this.peek().line;
  }
  private is(value: string): boolean {
    const t = this.peek();
    return (t.type === "punct" || t.type === "keyword") && t.value === value;
  }
  private eat(value: string): boolean {
    if (this.is(value)) {
      this.pos++;
      return true;
    }
    return false;
  }
  private expect(value: string): Token {
    if (!this.is(value)) {
      throw new ParseError(
        `expected '${value}' but got '${this.peek().value || "EOF"}'`,
        this.line
      );
    }
    return this.next();
  }

  // ---- Program ----

  parseProgram(): A.Program {
    const functions: A.FunctionDecl[] = [];
    const globals: A.VarDecl[] = [];
    const line = this.line;
    while (this.peek().type !== "eof") {
      if (this.is("typedef")) {
        this.parseTypedef();
        continue;
      }
      // A struct/union/enum *definition* at top level (has a body).
      if (
        (this.is("struct") || this.is("union")) &&
        (this.peek(2).value === "{" || this.peek(1).value === "{")
      ) {
        this.parseAggregateDecl();
        this.expect(";");
        continue;
      }
      if (this.is("enum") && (this.peek(2).value === "{" || this.peek(1).value === "{")) {
        this.parseEnumBody();
        this.expect(";");
        continue;
      }
      // Top-level: type, then declarator; '(' after the name means function.
      const declLine = this.line;
      const base = this.parseBaseType();
      const { type, name } = this.parseDeclaratorType(base);
      if (this.is("(")) {
        functions.push(this.parseFunctionRest(type, name, declLine));
      } else {
        globals.push(this.parseGlobalRest(base, type, name, declLine));
      }
    }
    return {
      kind: "Program",
      functions,
      structs: this.structs,
      globals,
      enumConstants: this.enumConstants,
      line,
    };
  }

  // typedef <type> Name;  (also typedef struct/union/enum {…} Name;)
  private parseTypedef(): void {
    this.expect("typedef");
    const base = this.parseBaseType(); // may define an aggregate/enum inline
    const { type, name } = this.parseDeclaratorType(base);
    this.typedefs.set(name, type);
    this.expect(";");
  }

  // Parse a struct/union definition or bare reference, returning its CType.
  // (Unions are stored in the same registry as structs, tagged isUnion.)
  private parseAggregateDecl(): A.CType {
    const isUnion = this.is("union");
    this.next(); // struct | union
    let name: string;
    if (this.peek().type === "identifier") {
      name = this.next().value;
    } else {
      name = `__anon${this.anonCount++}`;
    }
    this.structNames.add(name);
    if (!this.is("{")) {
      // Bare reference: `struct node *p;`
      return { kind: "struct", name };
    }
    this.expect("{");
    const fields: { type: A.CType; name: string }[] = [];
    while (!this.is("}")) {
      const base = this.parseBaseType();
      do {
        const { type, name: fname } = this.parseDeclaratorType(base);
        fields.push({ type, name: fname });
      } while (this.eat(","));
      this.expect(";");
    }
    this.expect("}");
    this.structs.push({ kind: "StructDecl", name, fields, isUnion, line: this.line });
    return { kind: "struct", name };
  }

  // enum [Name] { A, B = 3, C };  -> registers constants, returns int type.
  private parseEnumBody(): A.CType {
    this.expect("enum");
    if (this.peek().type === "identifier") this.next(); // optional tag
    if (!this.is("{")) return { kind: "int" }; // bare `enum Name` reference
    this.expect("{");
    let next = 0;
    while (!this.is("}")) {
      const cname = this.expectIdent();
      if (this.eat("=")) {
        next = this.parseConstInt();
      }
      this.enumConstants[cname] = next;
      next++;
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return { kind: "int" };
  }

  // Continues a global variable declaration after the first declarator's
  // type+name have been consumed. Handles `int g = 5, h;`.
  private parseGlobalRest(
    base: A.CType,
    firstType: A.CType,
    firstName: string,
    line: number
  ): A.VarDecl {
    const declarators: A.Declarator[] = [];
    const finishDeclarator = (type: A.CType, name: string) => {
      const decl: A.Declarator = { name, type };
      if (this.eat("=")) {
        if (this.is("{")) {
          decl.initList = this.parseInitList();
        } else {
          decl.init = this.parseAssignment();
        }
      }
      declarators.push(decl);
    };
    finishDeclarator(firstType, firstName);
    while (this.eat(",")) {
      const { type, name } = this.parseDeclaratorType(base);
      finishDeclarator(type, name);
    }
    this.expect(";");
    return { kind: "VarDecl", declarators, line };
  }

  // Continues a function definition after `returnType name` have been parsed.
  private parseFunctionRest(
    returnType: A.CType,
    name: string,
    line: number
  ): A.FunctionDecl {
    this.expect("(");
    const params: A.Param[] = [];
    if (!this.is(")")) {
      if (this.is("void") && this.peek(1).value === ")") {
        this.next();
      } else {
        do {
          const pbase = this.parseBaseType();
          const { type, name: pname } = this.parseDeclaratorType(pbase);
          params.push({ type, name: pname });
        } while (this.eat(","));
      }
    }
    this.expect(")");
    const body = this.parseBlock();
    return { kind: "FunctionDecl", returnType, name, params, body, line };
  }

  // ---- Types ----

  private isTypeStart(): boolean {
    const t = this.peek();
    if (t.type === "keyword" && TYPE_KEYWORDS.has(t.value)) return true;
    if (t.type === "identifier" && this.typedefs.has(t.value)) return true;
    return false;
  }

  private parseBaseType(): A.CType {
    // Skip qualifiers we don't model.
    while (this.is("const") || this.is("unsigned")) this.next();
    const t = this.peek();
    if (this.is("int")) {
      this.next();
      return { kind: "int" };
    }
    if (this.is("char")) {
      this.next();
      return { kind: "char" };
    }
    if (this.is("float")) {
      this.next();
      return { kind: "float" };
    }
    if (this.is("double")) {
      this.next();
      return { kind: "double" };
    }
    if (this.is("void")) {
      this.next();
      return { kind: "void" };
    }
    if (this.is("struct") || this.is("union")) {
      return this.parseAggregateDecl();
    }
    if (this.is("enum")) {
      return this.parseEnumBody();
    }
    // A typedef alias name resolves to its underlying type.
    if (t.type === "identifier" && this.typedefs.has(t.value)) {
      this.next();
      return cloneType(this.typedefs.get(t.value)!);
    }
    throw new ParseError(`expected a type but got '${t.value || "EOF"}'`, t.line);
  }

  // Parse pointer stars + name + array suffixes on top of a base type.
  // Also handles function-pointer declarators: `int (*fp)(int, int)`.
  private parseDeclaratorType(base: A.CType): { type: A.CType; name: string } {
    let type = base;
    while (this.eat("*")) {
      this.eat("const");
      type = { kind: "pointer", to: type };
    }
    // Function pointer: '(' appears where the identifier would be.
    if (this.is("(")) {
      this.expect("(");
      this.expect("*");
      const name = this.expectIdent();
      this.expect(")");
      this.expect("(");
      const params: A.CType[] = [];
      if (!this.is(")")) {
        if (this.is("void") && this.peek(1).value === ")") {
          this.next();
        } else {
          do {
            let pt = this.parseBaseType();
            while (this.eat("*")) {
              this.eat("const");
              pt = { kind: "pointer", to: pt };
            }
            if (this.peek().type === "identifier") this.next(); // optional param name
            params.push(pt);
          } while (this.eat(","));
        }
      }
      this.expect(")");
      return {
        type: { kind: "pointer", to: { kind: "func", ret: type, params } },
        name,
      };
    }
    const name = this.expectIdent();
    // Array suffixes (possibly multi-dimensional): collect then apply outer-first.
    const dims: number[] = [];
    while (this.is("[")) {
      this.next();
      if (this.is("]")) {
        dims.push(-1); // unspecified size (e.g. int arr[])
      } else {
        dims.push(this.parseConstInt());
      }
      this.expect("]");
    }
    for (let d = dims.length - 1; d >= 0; d--) {
      type = { kind: "array", of: type, length: dims[d] < 0 ? undefined : dims[d] };
    }
    return { type, name };
  }

  private parseConstInt(): number {
    const t = this.peek();
    if (t.type === "number") {
      this.next();
      return parseIntLiteral(t.value);
    }
    throw new ParseError(`expected a constant array size, got '${t.value}'`, t.line);
  }

  private expectIdent(): string {
    const t = this.peek();
    if (t.type !== "identifier") {
      throw new ParseError(
        `expected an identifier but got '${t.value || "EOF"}'`,
        t.line
      );
    }
    this.next();
    return t.value;
  }

  // ---- Statements ----

  private parseBlock(): A.Block {
    const line = this.line;
    this.expect("{");
    const statements: A.Statement[] = [];
    while (!this.is("}") && this.peek().type !== "eof") {
      statements.push(this.parseStatement());
    }
    this.expect("}");
    return { kind: "Block", statements, line };
  }

  private parseStatement(): A.Statement {
    const line = this.line;
    if (this.is("{")) return this.parseBlock();
    if (this.is("if")) return this.parseIf();
    if (this.is("while")) return this.parseWhile();
    if (this.is("for")) return this.parseFor();
    if (this.is("return")) {
      this.next();
      let value: A.Expression | undefined;
      if (!this.is(";")) value = this.parseExpression();
      this.expect(";");
      return { kind: "Return", value, line };
    }
    if (this.is("break")) {
      this.next();
      this.expect(";");
      return { kind: "Break", line };
    }
    if (this.is("continue")) {
      this.next();
      this.expect(";");
      return { kind: "Continue", line };
    }
    if (this.isTypeStart()) return this.parseVarDecl();

    // Expression statement
    const expr = this.parseExpression();
    this.expect(";");
    return { kind: "ExpressionStatement", expression: expr, line };
  }

  private parseVarDecl(): A.VarDecl {
    const line = this.line;
    const base = this.parseBaseType();
    const declarators: A.Declarator[] = [];
    do {
      const { type, name } = this.parseDeclaratorType(base);
      const decl: A.Declarator = { name, type };
      if (this.eat("=")) {
        if (this.is("{")) {
          decl.initList = this.parseInitList();
        } else {
          decl.init = this.parseAssignment();
        }
      }
      declarators.push(decl);
    } while (this.eat(","));
    this.expect(";");
    return { kind: "VarDecl", declarators, line };
  }

  private parseInitList(): A.Expression[] {
    this.expect("{");
    const items: A.Expression[] = [];
    if (!this.is("}")) {
      do {
        if (this.is("}")) break; // trailing comma
        if (this.is("{")) {
          // Nested braces: {{1,2},{3,4}} for 2D arrays / arrays of structs.
          const line = this.line;
          items.push({ kind: "InitListExpr", items: this.parseInitList(), line });
        } else {
          items.push(this.parseAssignment());
        }
      } while (this.eat(","));
    }
    this.expect("}");
    return items;
  }

  private parseIf(): A.If {
    const line = this.line;
    this.expect("if");
    this.expect("(");
    const cond = this.parseExpression();
    this.expect(")");
    const then = this.parseStatement();
    let els: A.Statement | undefined;
    if (this.eat("else")) els = this.parseStatement();
    return { kind: "If", cond, then, else: els, line };
  }

  private parseWhile(): A.While {
    const line = this.line;
    this.expect("while");
    this.expect("(");
    const cond = this.parseExpression();
    this.expect(")");
    const body = this.parseStatement();
    return { kind: "While", cond, body, line };
  }

  private parseFor(): A.For {
    const line = this.line;
    this.expect("for");
    this.expect("(");
    let init: A.Statement | undefined;
    if (!this.is(";")) {
      if (this.isTypeStart()) {
        init = this.parseVarDecl(); // consumes the ';'
      } else {
        const e = this.parseExpression();
        this.expect(";");
        init = { kind: "ExpressionStatement", expression: e, line };
      }
    } else {
      this.expect(";");
    }
    let cond: A.Expression | undefined;
    if (!this.is(";")) cond = this.parseExpression();
    this.expect(";");
    let update: A.Expression | undefined;
    if (!this.is(")")) update = this.parseExpression();
    this.expect(")");
    const body = this.parseStatement();
    return { kind: "For", init, cond, update, body, line };
  }

  // ---- Expressions (precedence climbing) ----

  private parseExpression(): A.Expression {
    // Support comma operator minimally by just returning the assignment;
    // (comma in decls/args is handled by callers).
    return this.parseAssignment();
  }

  private parseAssignment(): A.Expression {
    const left = this.parseBinary(0);
    const t = this.peek();
    if (t.type === "punct" && ["=", "+=", "-=", "*=", "/=", "%="].includes(t.value)) {
      const line = t.line;
      this.next();
      const value = this.parseAssignment();
      return { kind: "Assignment", op: t.value, target: left, value, line };
    }
    return left;
  }

  // Binary operator precedence table (higher binds tighter).
  private static PREC: Record<string, number> = {
    "||": 1,
    "&&": 2,
    "|": 3,
    "^": 4,
    "&": 5,
    "==": 6,
    "!=": 6,
    "<": 7,
    ">": 7,
    "<=": 7,
    ">=": 7,
    "<<": 8,
    ">>": 8,
    "+": 9,
    "-": 9,
    "*": 10,
    "/": 10,
    "%": 10,
  };

  private parseBinary(minPrec: number): A.Expression {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (t.type !== "punct") break;
      const prec = Parser.PREC[t.value];
      if (prec === undefined || prec < minPrec) break;
      const line = t.line;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { kind: "Binary", op: t.value, left, right, line };
    }
    return left;
  }

  private parseUnary(): A.Expression {
    const t = this.peek();
    const line = t.line;
    if (t.type === "punct" && ["&", "*", "-", "!", "~", "++", "--"].includes(t.value)) {
      this.next();
      const operand = this.parseUnary();
      return { kind: "Unary", op: t.value, operand, line };
    }
    if (this.is("sizeof")) {
      this.next();
      if (this.is("(") && this.peekIsTypeAfterParen()) {
        this.expect("(");
        const typeArg = this.parseTypeName();
        this.expect(")");
        return { kind: "Sizeof", typeArg, line };
      }
      const exprArg = this.parseUnary();
      return { kind: "Sizeof", exprArg, line };
    }
    // Cast: '(' type ')' unary
    if (this.is("(") && this.peekIsTypeAfterParen()) {
      this.expect("(");
      const type = this.parseTypeName();
      this.expect(")");
      const operand = this.parseUnary();
      return { kind: "Cast", type, operand, line };
    }
    return this.parsePostfix();
  }

  private peekIsTypeAfterParen(): boolean {
    const t = this.peek(1);
    if (t.type === "keyword" && TYPE_KEYWORDS.has(t.value)) return true;
    return false;
  }

  // A type name in cast/sizeof position: base type + optional stars.
  private parseTypeName(): A.CType {
    let type = this.parseBaseType();
    while (this.eat("*")) {
      this.eat("const");
      type = { kind: "pointer", to: type };
    }
    return type;
  }

  private parsePostfix(): A.Expression {
    let expr = this.parsePrimary();
    while (true) {
      const t = this.peek();
      const line = t.line;
      if (this.is("(")) {
        this.next();
        const args: A.Expression[] = [];
        if (!this.is(")")) {
          do {
            args.push(this.parseAssignment());
          } while (this.eat(","));
        }
        this.expect(")");
        expr = { kind: "Call", callee: expr, args, line };
      } else if (this.is("[")) {
        this.next();
        const index = this.parseExpression();
        this.expect("]");
        expr = { kind: "Index", array: expr, index, line };
      } else if (this.is(".")) {
        this.next();
        const field = this.expectIdent();
        expr = { kind: "Member", object: expr, field, arrow: false, line };
      } else if (this.is("->")) {
        this.next();
        const field = this.expectIdent();
        expr = { kind: "Member", object: expr, field, arrow: true, line };
      } else if (this.is("++") || this.is("--")) {
        const op = this.next().value;
        expr = { kind: "Unary", op: "post" + op, operand: expr, line };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): A.Expression {
    const t = this.peek();
    const line = t.line;
    if (t.type === "number") {
      this.next();
      const { value, isFloat } = parseNumberLiteral(t.value);
      return { kind: "NumberLiteral", value, isFloat, line };
    }
    if (t.type === "char") {
      this.next();
      return { kind: "CharLiteral", value: parseCharLiteral(t.value), line };
    }
    if (t.type === "string") {
      this.next();
      return { kind: "StringLiteral", value: unescapeString(t.value), line };
    }
    if (t.type === "identifier") {
      this.next();
      return { kind: "Identifier", name: t.value, line };
    }
    if (this.is("(")) {
      this.next();
      const e = this.parseExpression();
      this.expect(")");
      return e;
    }
    throw new ParseError(`unexpected token '${t.value || "EOF"}'`, line);
  }
}

// Deep-copy a CType so typedef aliases aren't shared/mutated across uses.
function cloneType(t: A.CType): A.CType {
  const c: A.CType = { kind: t.kind };
  if (t.to) c.to = cloneType(t.to);
  if (t.of) c.of = cloneType(t.of);
  if (t.length !== undefined) c.length = t.length;
  if (t.name !== undefined) c.name = t.name;
  if (t.ret) c.ret = cloneType(t.ret);
  if (t.params) c.params = t.params.map(cloneType);
  return c;
}

// ---- literal helpers ----

export function parseIntLiteral(s: string): number {
  return parseNumberLiteral(s).value;
}

export function parseNumberLiteral(s: string): { value: number; isFloat: boolean } {
  if (/^0[xX]/.test(s)) {
    return { value: parseInt(s.replace(/[uUlL]+$/, ""), 16), isFloat: false };
  }
  const stripped = s.replace(/[fFuUlL]+$/, "");
  if (/[.eE]/.test(stripped)) {
    return { value: parseFloat(stripped), isFloat: true };
  }
  return { value: parseInt(stripped, 10), isFloat: false };
}

function parseCharLiteral(s: string): number {
  if (s[0] === "\\") {
    const map: Record<string, number> = {
      n: 10,
      t: 9,
      r: 13,
      "0": 0,
      "\\": 92,
      "'": 39,
      '"': 34,
    };
    return map[s[1]] ?? s.charCodeAt(1);
  }
  return s.charCodeAt(0);
}

function unescapeString(s: string): string {
  return s.replace(/\\(.)/g, (_, c) => {
    const map: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      "0": "\0",
      "\\": "\\",
      '"': '"',
    };
    return map[c] ?? c;
  });
}
