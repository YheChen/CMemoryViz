// AST node definitions for the supported C subset.
//
// Every node carries a `line` (1-based) so the interpreter can report which
// source line it is about to execute — this is what lets the UI stop
// "exactly before line N" the way exam questions phrase it.

export interface CType {
  kind:
    | "int"
    | "char"
    | "void"
    | "float"
    | "double"
    | "pointer"
    | "array"
    | "struct"
    | "func";
  // pointer: `to` is the pointee type
  to?: CType;
  // array: `of` is the element type, `length` the (constant) element count
  of?: CType;
  length?: number;
  // struct: name of the struct tag
  name?: string;
  // func: return type and parameter types (used via pointer-to-func)
  ret?: CType;
  params?: CType[];
}

export interface Node {
  line: number;
}

// ---- Top level -------------------------------------------------------------

export interface Program extends Node {
  kind: "Program";
  functions: FunctionDecl[];
  structs: StructDecl[];
  globals: VarDecl[];
}

export interface StructDecl extends Node {
  kind: "StructDecl";
  name: string;
  fields: { type: CType; name: string }[];
}

export interface Param {
  type: CType;
  name: string;
}

export interface FunctionDecl extends Node {
  kind: "FunctionDecl";
  returnType: CType;
  name: string;
  params: Param[];
  body: Block;
}

// ---- Statements ------------------------------------------------------------

export type Statement =
  | Block
  | VarDecl
  | If
  | While
  | For
  | Return
  | ExpressionStatement
  | Break
  | Continue;

export interface Block extends Node {
  kind: "Block";
  statements: Statement[];
}

export interface Declarator {
  name: string;
  type: CType; // fully resolved type of this declarator
  init?: Expression;
  // For array initializers like {1, 2, 3, 4}
  initList?: Expression[];
}

export interface VarDecl extends Node {
  kind: "VarDecl";
  declarators: Declarator[];
}

export interface If extends Node {
  kind: "If";
  cond: Expression;
  then: Statement;
  else?: Statement;
}

export interface While extends Node {
  kind: "While";
  cond: Expression;
  body: Statement;
}

export interface For extends Node {
  kind: "For";
  init?: Statement; // VarDecl or ExpressionStatement
  cond?: Expression;
  update?: Expression;
  body: Statement;
}

export interface Return extends Node {
  kind: "Return";
  value?: Expression;
}

export interface ExpressionStatement extends Node {
  kind: "ExpressionStatement";
  expression: Expression;
}

export interface Break extends Node {
  kind: "Break";
}
export interface Continue extends Node {
  kind: "Continue";
}

// ---- Expressions -----------------------------------------------------------

export type Expression =
  | NumberLiteral
  | CharLiteral
  | StringLiteral
  | Identifier
  | Binary
  | Unary
  | Assignment
  | Call
  | Index
  | Member
  | Sizeof
  | Cast
  | InitListExpr;

export interface NumberLiteral extends Node {
  kind: "NumberLiteral";
  value: number;
  isFloat?: boolean; // 1.5 -> double
}

// A nested brace initializer, e.g. the inner {1,2} in {{1,2},{3,4}}.
// Only ever appears inside an initializer list.
export interface InitListExpr extends Node {
  kind: "InitListExpr";
  items: Expression[];
}

export interface CharLiteral extends Node {
  kind: "CharLiteral";
  value: number; // char code
}

export interface StringLiteral extends Node {
  kind: "StringLiteral";
  value: string;
}

export interface Identifier extends Node {
  kind: "Identifier";
  name: string;
}

export interface Binary extends Node {
  kind: "Binary";
  op: string; // + - * / % < > <= >= == != && ||
  left: Expression;
  right: Expression;
}

export interface Unary extends Node {
  kind: "Unary";
  op: string; // & * - ! ++ -- (prefix), or "post++"/"post--"
  operand: Expression;
}

export interface Assignment extends Node {
  kind: "Assignment";
  op: string; // = += -= *= /=
  target: Expression;
  value: Expression;
}

export interface Call extends Node {
  kind: "Call";
  callee: Expression;
  args: Expression[];
}

export interface Index extends Node {
  kind: "Index";
  array: Expression;
  index: Expression;
}

export interface Member extends Node {
  kind: "Member";
  object: Expression;
  field: string;
  arrow: boolean; // true for ->, false for .
}

export interface Sizeof extends Node {
  kind: "Sizeof";
  typeArg?: CType;
  exprArg?: Expression;
}

export interface Cast extends Node {
  kind: "Cast";
  type: CType;
  operand: Expression;
}
