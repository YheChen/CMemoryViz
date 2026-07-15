// Tree-walking interpreter for the C subset.
//
// Rather than exposing a coroutine, the interpreter runs the whole program to
// completion and records a *snapshot* of memory before every statement. The UI
// then scrubs through this trace, which makes "stop exactly before line N"
// trivial and keeps the interpreter itself simple.

import * as A from "./ast";
import { parse } from "./parser";
import { MemoryModel, MemorySnapshot, typeSize } from "./memory";

export interface Step {
  line: number;
  snapshot: MemorySnapshot;
  note?: string;
  callDepth: number;
  output: string;
}

// A single heap allocation/deallocation, in execution order.
export interface HeapEvent {
  kind: "alloc" | "free";
  fn: string; // "malloc", "calloc", "free", "realloc"
  address: number;
  size: number; // bytes (0 for a free)
  line: number;
  step: number; // trace step index this happened during
}

export interface HeapReport {
  events: HeapEvent[];
  leaks: { address: number; size: number; line: number }[];
  totalAllocs: number;
  totalBytes: number;
  totalFreed: number; // count of successful frees
  leakedBytes: number;
}

export interface RunResult {
  steps: Step[];
  output: string;
  // Pseudo-addresses assigned to functions (for function-pointer display).
  functionAddrs: Record<number, string>;
  heap: HeapReport;
  error?: { message: string; line?: number };
}

interface RValue {
  type: A.CType;
  value: number;
  // For struct values passed/returned/assigned by value: the leaf cell
  // values in canonical order (see Interpreter.leafOffsets).
  data?: (number | undefined)[];
}

interface LValue {
  address: number;
  type: A.CType;
}

interface VarInfo {
  address: number;
  type: A.CType;
}

type Scope = Map<string, VarInfo>;

class ReturnSignal {
  constructor(public value: RValue | undefined) {}
}
class BreakSignal {}
class ContinueSignal {}

class RuntimeError extends Error {
  constructor(
    message: string,
    public line: number
  ) {
    super(message);
  }
}

const MAX_STEPS = 200000;

const INT: A.CType = { kind: "int" };
const CHAR: A.CType = { kind: "char" };
const DOUBLE: A.CType = { kind: "double" };

// Pseudo-addresses for functions ("code" region, below the data sections).
const FUNC_ADDR_BASE = 0x50;

function isFloatType(t: A.CType): boolean {
  return t.kind === "float" || t.kind === "double";
}

export function run(src: string): RunResult {
  let program: A.Program;
  try {
    program = parse(src);
  } catch (e: any) {
    return {
      steps: [],
      output: "",
      functionAddrs: {},
      heap: {
        events: [],
        leaks: [],
        totalAllocs: 0,
        totalBytes: 0,
        totalFreed: 0,
        leakedBytes: 0,
      },
      error: { message: e.message, line: e.line },
    };
  }
  return new Interpreter(program).run();
}

class Interpreter {
  private mem = new MemoryModel();
  private functions = new Map<string, A.FunctionDecl>();
  private fnAddr = new Map<string, number>();
  private addrToFn = new Map<number, A.FunctionDecl>();
  private globalScope: Scope = new Map();
  // One scope-list per active call frame (innermost call at the end).
  private envStack: Scope[][] = [];
  private steps: Step[] = [];
  private output = "";
  private stepCount = 0;

  // Heap lifecycle tracking (leaks / frees).
  private heapEvents: HeapEvent[] = [];
  private liveAllocs = new Map<number, { size: number; line: number }>();

  constructor(private program: A.Program) {}

  private get enumConstants(): Record<string, number> {
    return this.program.enumConstants ?? {};
  }

  private recordAlloc(fn: string, address: number, size: number, line: number) {
    this.liveAllocs.set(address, { size, line });
    this.heapEvents.push({
      kind: "alloc",
      fn,
      address,
      size,
      line,
      step: Math.max(0, this.steps.length - 1),
    });
  }

  private recordFree(fn: string, address: number, line: number) {
    this.liveAllocs.delete(address);
    if (address !== 0) {
      this.heapEvents.push({
        kind: "free",
        fn,
        address,
        size: 0,
        line,
        step: Math.max(0, this.steps.length - 1),
      });
    }
  }

  private buildHeapReport(): HeapReport {
    const allocs = this.heapEvents.filter((e) => e.kind === "alloc");
    const leaks = [...this.liveAllocs.entries()].map(([address, info]) => ({
      address,
      size: info.size,
      line: info.line,
    }));
    return {
      events: this.heapEvents,
      leaks,
      totalAllocs: allocs.length,
      totalBytes: allocs.reduce((s, e) => s + e.size, 0),
      totalFreed: this.heapEvents.filter((e) => e.kind === "free").length,
      leakedBytes: leaks.reduce((s, l) => s + l.size, 0),
    };
  }

  run(): RunResult {
    const functionAddrs: Record<number, string> = {};
    try {
      for (const s of this.program.structs) {
        this.mem.registerStruct(s.name, s.fields, s.isUnion);
      }
      for (const f of this.program.functions) {
        this.functions.set(f.name, f);
        const addr = FUNC_ADDR_BASE + this.fnAddr.size * 4;
        this.fnAddr.set(f.name, addr);
        this.addrToFn.set(addr, f);
        functionAddrs[addr] = f.name;
      }
      this.initGlobals();
      const main = this.functions.get("main");
      if (!main) throw new RuntimeError("no main() function found", 1);
      this.callFunction(main, []);
    } catch (e: any) {
      if (e instanceof ReturnSignal) {
        // main returned normally
      } else if (e instanceof RuntimeError) {
        return {
          steps: this.steps,
          output: this.output,
          functionAddrs,
          heap: this.buildHeapReport(),
          error: { message: e.message, line: e.line },
        };
      } else {
        return {
          steps: this.steps,
          output: this.output,
          functionAddrs,
          heap: this.buildHeapReport(),
          error: { message: String(e?.message ?? e) },
        };
      }
    }
    return {
      steps: this.steps,
      output: this.output,
      functionAddrs,
      heap: this.buildHeapReport(),
    };
  }

  private initGlobals() {
    for (const decl of this.program.globals) {
      for (const d of decl.declarators) {
        const type = this.inferDeclType(d);
        const block = this.mem.allocGlobal(d.name, type);
        this.globalScope.set(d.name, { address: block.address, type });
        if (d.initList) {
          this.initInto(block.address, type, d.initList, decl.line);
        } else if (d.init?.kind === "StringLiteral" && this.isCharArray(type)) {
          this.writeStringInto(block.address, d.init.value);
        } else if (d.init) {
          const v = this.evalExpr(d.init, type);
          this.mem.write(block.address, this.coerce(v, type).value);
        }
      }
    }
  }

  // ---- Scopes ----

  private get scopes(): Scope[] {
    return this.envStack[this.envStack.length - 1];
  }
  private pushScope() {
    this.scopes.push(new Map());
  }
  private popScope() {
    this.scopes.pop();
  }
  private declareVar(name: string, info: VarInfo) {
    this.scopes[this.scopes.length - 1].set(name, info);
  }
  private tryLookupVar(name: string): VarInfo | undefined {
    if (this.envStack.length > 0) {
      const chain = this.scopes;
      for (let i = chain.length - 1; i >= 0; i--) {
        const v = chain[i].get(name);
        if (v) return v;
      }
    }
    return this.globalScope.get(name);
  }
  private lookupVar(name: string, line: number): VarInfo {
    const v = this.tryLookupVar(name);
    if (!v) throw new RuntimeError(`use of undeclared identifier '${name}'`, line);
    return v;
  }

  // ---- Snapshots / stepping ----

  private snapshot(): MemorySnapshot {
    return structuredClone(this.mem.snapshot());
  }

  private recordStep(line: number, note?: string) {
    if (++this.stepCount > MAX_STEPS) {
      throw new RuntimeError("execution step limit exceeded (infinite loop?)", line);
    }
    this.steps.push({
      line,
      snapshot: this.snapshot(),
      note,
      callDepth: this.envStack.length,
      output: this.output,
    });
  }

  // ---- Function calls ----

  private callFunction(fn: A.FunctionDecl, args: RValue[]): RValue | undefined {
    this.mem.pushFrame(fn.name);
    this.envStack.push([new Map()]);
    // Bind parameters as locals.
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i];
      // Array parameters decay to pointers.
      const ptype: A.CType =
        p.type.kind === "array" ? { kind: "pointer", to: p.type.of! } : p.type;
      const block = this.mem.allocLocal(p.name, ptype);
      this.declareVar(p.name, { address: block.address, type: ptype });
      const arg = args[i];
      if (arg !== undefined) {
        if (this.isAggregate(ptype)) {
          // Struct passed by value: copy the caller's aggregate into the param.
          const data = arg.data ?? this.readAggregate(arg.value, ptype);
          this.writeAggregate(block.address, ptype, data);
        } else {
          this.mem.write(block.address, this.coerce(arg, ptype).value);
        }
      }
    }
    let result: RValue | undefined;
    try {
      this.execBlock(fn.body, false);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        result = e.value;
      } else {
        this.envStack.pop();
        this.mem.popFrame();
        throw e;
      }
    }
    this.envStack.pop();
    this.mem.popFrame();
    return result;
  }

  // ---- Statements ----

  private execBlock(block: A.Block, ownScope = true) {
    if (ownScope) this.pushScope();
    for (const s of block.statements) this.execStatement(s);
    if (ownScope) this.popScope();
  }

  private execStatement(stmt: A.Statement) {
    switch (stmt.kind) {
      case "Block":
        this.execBlock(stmt);
        return;
      case "VarDecl":
        this.recordStep(stmt.line);
        this.execVarDecl(stmt);
        return;
      case "ExpressionStatement":
        this.recordStep(stmt.line);
        this.evalExpr(stmt.expression);
        return;
      case "If":
        this.recordStep(stmt.line);
        if (this.truthy(this.evalExpr(stmt.cond))) this.execStatement(stmt.then);
        else if (stmt.else) this.execStatement(stmt.else);
        return;
      case "While":
        while (true) {
          this.recordStep(stmt.line);
          if (!this.truthy(this.evalExpr(stmt.cond))) break;
          try {
            this.execStatement(stmt.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      case "For":
        this.pushScope();
        if (stmt.init) this.execStatement(stmt.init);
        while (true) {
          this.recordStep(stmt.line);
          if (stmt.cond && !this.truthy(this.evalExpr(stmt.cond))) break;
          try {
            this.execStatement(stmt.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (!(e instanceof ContinueSignal)) {
              this.popScope();
              throw e;
            }
          }
          if (stmt.update) this.evalExpr(stmt.update);
        }
        this.popScope();
        return;
      case "Return": {
        this.recordStep(stmt.line, "return");
        const value = stmt.value ? this.evalExpr(stmt.value) : undefined;
        throw new ReturnSignal(value);
      }
      case "Break":
        this.recordStep(stmt.line);
        throw new BreakSignal();
      case "Continue":
        this.recordStep(stmt.line);
        throw new ContinueSignal();
    }
  }

  // Resolve the final type of a declarator, inferring missing array lengths
  // from `{...}` initializers or string literals.
  private inferDeclType(d: A.Declarator): A.CType {
    let type = d.type;
    if (type.kind === "array" && type.length === undefined) {
      if (d.initList) {
        type = { ...type, length: d.initList.length };
      } else if (d.init?.kind === "StringLiteral" && type.of?.kind === "char") {
        type = { ...type, length: d.init.value.length + 1 };
      }
    }
    return type;
  }

  private isCharArray(type: A.CType): boolean {
    return type.kind === "array" && type.of?.kind === "char";
  }

  private writeStringInto(address: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      this.mem.write(address + i, str.charCodeAt(i) & 0xff);
    }
    this.mem.write(address + str.length, 0);
  }

  private execVarDecl(stmt: A.VarDecl) {
    for (const d of stmt.declarators) {
      const type = this.inferDeclType(d);
      // Allocate storage first (so its address exists even if the initializer
      // is a call that hasn't returned yet — matches C semantics).
      const block = this.mem.allocLocal(d.name, type);
      this.declareVar(d.name, { address: block.address, type });

      if (d.initList) {
        this.initInto(block.address, type, d.initList, stmt.line);
      } else if (d.init?.kind === "StringLiteral" && this.isCharArray(type)) {
        // char s[] = "hi"; -> bytes copied into the array, incl. '\0'
        this.writeStringInto(block.address, d.init.value);
      } else if (d.init && this.isAggregate(type)) {
        // struct q = p;  -> copy by value
        const v = this.evalExpr(d.init, type);
        const data = v.data ?? this.readAggregate(v.value, type);
        this.writeAggregate(block.address, type, data);
      } else if (d.init) {
        const v = this.evalExpr(d.init, type);
        this.mem.write(block.address, this.coerce(v, type).value);
      }
    }
  }

  // Write a brace initializer into memory at `address`. Handles arrays,
  // nested arrays ({{1,2},{3,4}}), and structs ({3, 5}).
  private initInto(address: number, type: A.CType, items: A.Expression[], line: number) {
    if (type.kind === "array") {
      const elem = type.of!;
      const elemSize = this.mem.sizeOf(elem);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "InitListExpr") {
          this.initInto(address + i * elemSize, elem, item.items, item.line);
        } else if (elem.kind === "array" || elem.kind === "struct") {
          throw new RuntimeError(
            "nested braces required to initialize array-of-array or array-of-struct elements",
            line
          );
        } else {
          const v = this.evalExpr(item, elem);
          this.mem.write(address + i * elemSize, this.coerce(v, elem).value);
        }
      }
      return;
    }
    if (type.kind === "struct") {
      const s = this.mem.getStruct(type.name!);
      for (let i = 0; i < items.length && i < s.fields.length; i++) {
        const field = s.fields[i];
        const item = items[i];
        if (item.kind === "InitListExpr") {
          this.initInto(address + field.offset, field.type, item.items, item.line);
        } else {
          const v = this.evalExpr(item, field.type);
          this.mem.write(address + field.offset, this.coerce(v, field.type).value);
        }
      }
      return;
    }
    // Scalar wrapped in braces: int x = {5};
    if (items.length > 0) {
      const v = this.evalExpr(items[0], type);
      this.mem.write(address, this.coerce(v, type).value);
    }
  }

  // ---- Expressions ----

  private evalExpr(expr: A.Expression, hint?: A.CType): RValue {
    switch (expr.kind) {
      case "NumberLiteral":
        return { type: expr.isFloat ? DOUBLE : INT, value: expr.value };
      case "CharLiteral":
        return { type: CHAR, value: expr.value };
      case "StringLiteral": {
        const block = this.mem.allocReadonlyString(expr.value);
        return { type: { kind: "pointer", to: CHAR }, value: block.address };
      }
      case "InitListExpr":
        throw new RuntimeError(
          "brace initializer is only allowed in a declaration",
          expr.line
        );
      case "Identifier": {
        if (expr.name === "NULL")
          return { type: { kind: "pointer", to: { kind: "void" } }, value: 0 };
        const v = this.tryLookupVar(expr.name);
        if (!v) {
          // An enum constant evaluates to its integer value.
          if (Object.prototype.hasOwnProperty.call(this.enumConstants, expr.name)) {
            return { type: INT, value: this.enumConstants[expr.name] };
          }
          // A bare function name evaluates to a function pointer.
          const addr = this.fnAddr.get(expr.name);
          if (addr !== undefined) {
            const fn = this.functions.get(expr.name)!;
            return {
              type: {
                kind: "pointer",
                to: {
                  kind: "func",
                  ret: fn.returnType,
                  params: fn.params.map((p) => p.type),
                },
              },
              value: addr,
            };
          }
          throw new RuntimeError(
            `use of undeclared identifier '${expr.name}'`,
            expr.line
          );
        }
        if (v.type.kind === "array") {
          // Array decays to a pointer to its first element.
          return { type: { kind: "pointer", to: v.type.of! }, value: v.address };
        }
        if (this.isAggregate(v.type)) {
          // Struct value: carry a copy of its cells (by-value semantics).
          return {
            type: v.type,
            value: v.address,
            data: this.readAggregate(v.address, v.type),
          };
        }
        const cell = this.readCellAt(v.address, expr.line);
        if (cell.value === undefined) {
          throw new RuntimeError(
            `use of uninitialized variable '${expr.name}' (at ${this.hex(v.address)})`,
            expr.line
          );
        }
        return { type: v.type, value: cell.value };
      }
      case "Binary":
        return this.evalBinary(expr);
      case "Unary":
        return this.evalUnary(expr);
      case "Assignment":
        return this.evalAssignment(expr);
      case "Call":
        return this.evalCall(expr, hint);
      case "Index": {
        const lv = this.evalLValueOfIndex(expr);
        return this.load(lv, expr.line);
      }
      case "Member": {
        const lv = this.evalLValueOfMember(expr);
        return this.load(lv, expr.line);
      }
      case "Sizeof": {
        const t = expr.typeArg ?? this.typeOf(expr.exprArg!);
        return { type: INT, value: this.mem.sizeOf(t) };
      }
      case "Cast": {
        const v = this.evalExpr(expr.operand, expr.type);
        return this.coerce(v, expr.type);
      }
    }
  }

  private hex(n: number): string {
    return "0x" + n.toString(16);
  }

  // readCell with the line attached to any memory error.
  private readCellAt(address: number, line: number) {
    try {
      return this.mem.readCell(address);
    } catch (e: any) {
      throw new RuntimeError(e.message, line);
    }
  }

  private writeAt(address: number, value: number, line: number) {
    try {
      this.mem.write(address, value);
    } catch (e: any) {
      throw new RuntimeError(e.message, line);
    }
  }

  private load(lv: LValue, line: number): RValue {
    if (lv.type.kind === "array") {
      return { type: { kind: "pointer", to: lv.type.of! }, value: lv.address };
    }
    if (this.isAggregate(lv.type)) {
      return {
        type: lv.type,
        value: lv.address,
        data: this.readAggregate(lv.address, lv.type),
      };
    }
    const cell = this.readCellAt(lv.address, line);
    if (cell.value === undefined) {
      throw new RuntimeError(
        `use of uninitialized memory at ${this.hex(lv.address)}`,
        line
      );
    }
    return { type: lv.type, value: cell.value };
  }

  private evalLValue(expr: A.Expression): LValue {
    switch (expr.kind) {
      case "Identifier": {
        const v = this.lookupVar(expr.name, expr.line);
        return { address: v.address, type: v.type };
      }
      case "Unary":
        if (expr.op === "*") {
          const ptr = this.evalExpr(expr.operand);
          return { address: ptr.value, type: this.pointeeType(ptr.type, expr.line) };
        }
        break;
      case "Index":
        return this.evalLValueOfIndex(expr);
      case "Member":
        return this.evalLValueOfMember(expr);
    }
    throw new RuntimeError("expression is not assignable (not an lvalue)", expr.line);
  }

  private evalLValueOfIndex(expr: A.Index): LValue {
    const base = this.evalExpr(expr.array);
    const idx = this.evalExpr(expr.index);
    const elem = this.pointeeType(base.type, expr.line);
    const size = this.mem.sizeOf(elem);
    return { address: base.value + idx.value * size, type: elem };
  }

  private evalLValueOfMember(expr: A.Member): LValue {
    let baseAddr: number;
    let structType: A.CType;
    if (expr.arrow) {
      const ptr = this.evalExpr(expr.object);
      baseAddr = ptr.value;
      structType = this.pointeeType(ptr.type, expr.line);
    } else {
      const lv = this.evalLValue(expr.object);
      baseAddr = lv.address;
      structType = lv.type;
    }
    if (structType.kind !== "struct") {
      throw new RuntimeError("member access on non-struct", expr.line);
    }
    const s = this.mem.getStruct(structType.name!);
    const field = s.fields.find((f) => f.name === expr.field);
    if (!field) {
      throw new RuntimeError(
        `no field '${expr.field}' in struct ${structType.name}`,
        expr.line
      );
    }
    return { address: baseAddr + field.offset, type: field.type };
  }

  private evalBinary(expr: A.Binary): RValue {
    if (expr.op === "&&") {
      const l = this.evalExpr(expr.left);
      if (!this.truthy(l)) return { type: INT, value: 0 };
      return { type: INT, value: this.truthy(this.evalExpr(expr.right)) ? 1 : 0 };
    }
    if (expr.op === "||") {
      const l = this.evalExpr(expr.left);
      if (this.truthy(l)) return { type: INT, value: 1 };
      return { type: INT, value: this.truthy(this.evalExpr(expr.right)) ? 1 : 0 };
    }

    const l = this.evalExpr(expr.left);
    const r = this.evalExpr(expr.right);

    // Pointer arithmetic
    const lPtr = l.type.kind === "pointer";
    const rPtr = r.type.kind === "pointer";
    if ((expr.op === "+" || expr.op === "-") && (lPtr || rPtr)) {
      if (lPtr && !rPtr) {
        const size = this.mem.sizeOf(l.type.to!);
        const delta = r.value * size * (expr.op === "-" ? -1 : 1);
        return { type: l.type, value: l.value + delta };
      }
      if (rPtr && !lPtr && expr.op === "+") {
        const size = this.mem.sizeOf(r.type.to!);
        return { type: r.type, value: r.value + l.value * size };
      }
      if (lPtr && rPtr && expr.op === "-") {
        const size = this.mem.sizeOf(l.type.to!);
        return { type: INT, value: (l.value - r.value) / size };
      }
    }

    const a = l.value;
    const b = r.value;
    // Usual arithmetic conversions, reduced to: any float operand -> double.
    const isF = isFloatType(l.type) || isFloatType(r.type);
    let out: number;
    switch (expr.op) {
      case "+":
        out = a + b;
        break;
      case "-":
        out = a - b;
        break;
      case "*":
        out = a * b;
        break;
      case "/":
        if (b === 0 && !isF) throw new RuntimeError("division by zero", expr.line);
        out = isF ? a / b : Math.trunc(a / b);
        break;
      case "%":
        if (b === 0) throw new RuntimeError("modulo by zero", expr.line);
        out = a % b;
        break;
      case "<":
        return { type: INT, value: a < b ? 1 : 0 };
      case ">":
        return { type: INT, value: a > b ? 1 : 0 };
      case "<=":
        return { type: INT, value: a <= b ? 1 : 0 };
      case ">=":
        return { type: INT, value: a >= b ? 1 : 0 };
      case "==":
        return { type: INT, value: a === b ? 1 : 0 };
      case "!=":
        return { type: INT, value: a !== b ? 1 : 0 };
      case "&":
        out = a & b;
        break;
      case "|":
        out = a | b;
        break;
      case "^":
        out = a ^ b;
        break;
      case "<<":
        out = a << b;
        break;
      case ">>":
        out = a >> b;
        break;
      default:
        throw new RuntimeError(`unsupported operator '${expr.op}'`, expr.line);
    }
    if (lPtr) return { type: l.type, value: out };
    return { type: isF ? DOUBLE : INT, value: out };
  }

  private evalUnary(expr: A.Unary): RValue {
    switch (expr.op) {
      case "&": {
        // &funcname -> function pointer
        if (expr.operand.kind === "Identifier" && !this.tryLookupVar(expr.operand.name)) {
          const addr = this.fnAddr.get(expr.operand.name);
          if (addr !== undefined) {
            const fn = this.functions.get(expr.operand.name)!;
            return {
              type: {
                kind: "pointer",
                to: {
                  kind: "func",
                  ret: fn.returnType,
                  params: fn.params.map((p) => p.type),
                },
              },
              value: addr,
            };
          }
        }
        const lv = this.evalLValue(expr.operand);
        return { type: { kind: "pointer", to: lv.type }, value: lv.address };
      }
      case "*": {
        const ptr = this.evalExpr(expr.operand);
        const t = this.pointeeType(ptr.type, expr.line);
        // *fp where fp is a function pointer: the "value" is the fn address.
        if (t.kind === "func") return ptr;
        return this.load({ address: ptr.value, type: t }, expr.line);
      }
      case "-": {
        const v = this.evalExpr(expr.operand);
        return { type: isFloatType(v.type) ? v.type : INT, value: -v.value };
      }
      case "!":
        return { type: INT, value: this.truthy(this.evalExpr(expr.operand)) ? 0 : 1 };
      case "~":
        return { type: INT, value: ~this.evalExpr(expr.operand).value };
      case "++":
      case "--": {
        const lv = this.evalLValue(expr.operand);
        const cur = this.load(lv, expr.line);
        const step = this.stepFor(lv.type, expr.op === "++" ? 1 : -1);
        const nv = cur.value + step;
        this.writeAt(lv.address, nv, expr.line);
        return { type: lv.type, value: nv };
      }
      case "post++":
      case "post--": {
        const lv = this.evalLValue(expr.operand);
        const cur = this.load(lv, expr.line);
        const step = this.stepFor(lv.type, expr.op === "post++" ? 1 : -1);
        this.writeAt(lv.address, cur.value + step, expr.line);
        return { type: lv.type, value: cur.value };
      }
    }
    throw new RuntimeError(`unsupported unary operator '${expr.op}'`, expr.line);
  }

  private stepFor(type: A.CType, dir: number): number {
    if (type.kind === "pointer") return dir * this.mem.sizeOf(type.to!);
    return dir;
  }

  private evalAssignment(expr: A.Assignment): RValue {
    const lv = this.evalLValue(expr.target);
    // Whole-struct assignment: copy the aggregate by value.
    if (this.isAggregate(lv.type) && expr.op === "=") {
      const rhs = this.evalExpr(expr.value, lv.type);
      const data = rhs.data ?? this.readAggregate(rhs.value, lv.type);
      this.writeAggregate(lv.address, lv.type, data);
      return { type: lv.type, value: lv.address, data };
    }
    let value: number;
    if (expr.op === "=") {
      const rhs = this.evalExpr(expr.value, lv.type);
      value = this.coerce(rhs, lv.type).value;
    } else {
      const cur = this.load(lv, expr.line);
      const rhs = this.evalExpr(expr.value);
      if (lv.type.kind === "pointer" && (expr.op === "+=" || expr.op === "-=")) {
        const size = this.mem.sizeOf(lv.type.to!);
        value = cur.value + rhs.value * size * (expr.op === "-=" ? -1 : 1);
      } else {
        const isF = isFloatType(lv.type) || isFloatType(rhs.type);
        const a = cur.value;
        const b = rhs.value;
        switch (expr.op) {
          case "+=":
            value = a + b;
            break;
          case "-=":
            value = a - b;
            break;
          case "*=":
            value = a * b;
            break;
          case "/=":
            if (b === 0 && !isF) throw new RuntimeError("division by zero", expr.line);
            value = isF ? a / b : Math.trunc(a / b);
            break;
          case "%=":
            if (b === 0) throw new RuntimeError("modulo by zero", expr.line);
            value = a % b;
            break;
          default:
            throw new RuntimeError(
              `unsupported assignment operator '${expr.op}'`,
              expr.line
            );
        }
      }
      value = this.coerce({ type: lv.type, value }, lv.type).value;
    }
    this.writeAt(lv.address, value, expr.line);
    return { type: lv.type, value };
  }

  // Resolve which FunctionDecl a call expression targets: a direct name, a
  // variable holding a function pointer, or (*fp)(...).
  private resolveCallee(expr: A.Call): A.FunctionDecl {
    const c = expr.callee;
    if (c.kind === "Identifier") {
      const v = this.tryLookupVar(c.name);
      if (!v) {
        const fn = this.functions.get(c.name);
        if (fn) return fn;
        throw new RuntimeError(`call to unknown function '${c.name}'`, expr.line);
      }
      // A local/global variable — must hold a function pointer.
      const val = this.evalExpr(c);
      const fn = this.addrToFn.get(val.value);
      if (!fn) {
        throw new RuntimeError(
          `'${c.name}' (${this.hex(val.value)}) does not point to a function`,
          expr.line
        );
      }
      return fn;
    }
    // (*fp)(...) or any expression yielding a function pointer
    const target = c.kind === "Unary" && c.op === "*" ? c.operand : c;
    const val = this.evalExpr(target);
    const fn = this.addrToFn.get(val.value);
    if (!fn) {
      throw new RuntimeError(
        `expression (${this.hex(val.value)}) does not point to a function`,
        expr.line
      );
    }
    return fn;
  }

  private evalCall(expr: A.Call, hint?: A.CType): RValue {
    if (expr.callee.kind === "Identifier") {
      const name = expr.callee.name;
      // Builtins (only when not shadowed by a user variable/function)
      if (!this.tryLookupVar(name) && !this.functions.has(name)) {
        if (name === "malloc" || name === "calloc") {
          let bytes = this.evalExpr(expr.args[0]).value;
          if (name === "calloc") bytes *= this.evalExpr(expr.args[1]).value;
          const elem = hint && hint.kind === "pointer" ? hint.to! : INT;
          const count = Math.max(1, Math.floor(bytes / this.mem.sizeOf(elem)));
          const block = this.mem.allocHeap(elem, count);
          if (name === "calloc") for (const c of block.cells) c.value = 0;
          this.recordAlloc(name, block.address, block.size, expr.line);
          return { type: { kind: "pointer", to: elem }, value: block.address };
        }
        if (name === "free") {
          const p = this.evalExpr(expr.args[0]);
          try {
            this.mem.freeHeap(p.value);
          } catch (e: any) {
            throw new RuntimeError(e.message, expr.line);
          }
          this.recordFree(name, p.value, expr.line);
          return { type: { kind: "void" }, value: 0 };
        }
        if (name === "realloc") {
          const p = this.evalExpr(expr.args[0]);
          const bytes = this.evalExpr(expr.args[1]).value;
          const elem = hint && hint.kind === "pointer" ? hint.to! : INT;
          const count = Math.max(1, Math.floor(bytes / this.mem.sizeOf(elem)));
          // realloc(NULL, n) behaves like malloc(n).
          if (p.value === 0) {
            const block = this.mem.allocHeap(elem, count);
            this.recordAlloc(name, block.address, block.size, expr.line);
            return { type: { kind: "pointer", to: elem }, value: block.address };
          }
          let block;
          try {
            block = this.mem.reallocHeap(p.value, elem, count);
          } catch (e: any) {
            throw new RuntimeError(e.message, expr.line);
          }
          // Accounting: the old block is freed, a new one is allocated.
          this.recordFree(name, p.value, expr.line);
          this.recordAlloc(name, block.address, block.size, expr.line);
          return { type: { kind: "pointer", to: elem }, value: block.address };
        }
        if (name === "printf") {
          this.doPrintf(expr.args);
          return { type: INT, value: 0 };
        }
        if (name === "strlen") {
          const p = this.evalExpr(expr.args[0]);
          return { type: INT, value: this.readCString(p.value).length };
        }
        const str = this.tryStringBuiltin(name, expr);
        if (str) return str;
      }
    }

    const fn = this.resolveCallee(expr);
    const args = expr.args.map((a, i) => {
      const ptype = fn.params[i]?.type;
      return this.evalExpr(a, ptype);
    });
    const ret = this.callFunction(fn, args);
    return ret ?? { type: fn.returnType, value: 0 };
  }

  // <string.h> byte functions operating on char buffers by address.
  private tryStringBuiltin(name: string, expr: A.Call): RValue | null {
    const CHARP: A.CType = { kind: "pointer", to: CHAR };
    const argAddr = (i: number) => this.evalExpr(expr.args[i]).value;
    const argInt = (i: number) => this.evalExpr(expr.args[i]).value;
    const wrap = (fn: () => number): RValue => {
      try {
        return {
          type: name.startsWith("strc") && name.endsWith("cmp") ? INT : CHARP,
          value: fn(),
        };
      } catch (e: any) {
        throw new RuntimeError(e.message, expr.line);
      }
    };
    switch (name) {
      case "strcpy":
        return wrap(() => {
          const d = argAddr(0),
            s = argAddr(1);
          let i = 0;
          for (;;) {
            const ch = this.mem.readCell(s + i).value ?? 0;
            this.mem.write(d + i, ch);
            if (ch === 0) break;
            i++;
          }
          return d;
        });
      case "strncpy":
        return wrap(() => {
          const d = argAddr(0),
            s = argAddr(1),
            n = argInt(2);
          let ended = false;
          for (let i = 0; i < n; i++) {
            const ch = ended ? 0 : (this.mem.readCell(s + i).value ?? 0);
            this.mem.write(d + i, ch);
            if (ch === 0) ended = true;
          }
          return d;
        });
      case "strcat":
        return wrap(() => {
          const d = argAddr(0),
            s = argAddr(1);
          let end = 0;
          while ((this.mem.readCell(d + end).value ?? 0) !== 0) end++;
          let i = 0;
          for (;;) {
            const ch = this.mem.readCell(s + i).value ?? 0;
            this.mem.write(d + end + i, ch);
            if (ch === 0) break;
            i++;
          }
          return d;
        });
      case "memcpy":
        return wrap(() => {
          const d = argAddr(0),
            s = argAddr(1),
            n = argInt(2);
          let copied = 0;
          while (copied < n && this.mem.hasCell(s + copied)) {
            const c = this.mem.readCell(s + copied);
            this.mem.write(d + copied, c.value ?? 0);
            copied += c.size;
          }
          return d;
        });
      case "strcmp":
      case "strncmp": {
        const a = this.readCString(argAddr(0));
        const b = this.readCString(argAddr(1));
        const x = name === "strncmp" ? a.slice(0, argInt(2)) : a;
        const y = name === "strncmp" ? b.slice(0, argInt(2)) : b;
        return { type: INT, value: x < y ? -1 : x > y ? 1 : 0 };
      }
      default:
        return null;
    }
  }

  // ---- Struct-by-value helpers ----

  // Canonical leaf-cell offsets (relative to the aggregate base), matching the
  // order MemoryModel lays cells out. Used to copy structs by value.
  private leafOffsets(type: A.CType, base = 0): number[] {
    if (type.kind === "array") {
      const size = this.mem.sizeOf(type.of!);
      const out: number[] = [];
      for (let k = 0; k < (type.length ?? 0); k++) {
        out.push(...this.leafOffsets(type.of!, base + k * size));
      }
      return out;
    }
    if (type.kind === "struct") {
      const s = this.mem.getStruct(type.name!);
      const fields = s.isUnion ? s.fields.slice(0, 1) : s.fields;
      const out: number[] = [];
      for (const f of fields) out.push(...this.leafOffsets(f.type, base + f.offset));
      return out;
    }
    return [base];
  }

  private readAggregate(address: number, type: A.CType): (number | undefined)[] {
    return this.leafOffsets(type).map((off) => this.mem.readCell(address + off).value);
  }

  private writeAggregate(address: number, type: A.CType, data: (number | undefined)[]) {
    const offs = this.leafOffsets(type);
    offs.forEach((off, i) => this.mem.write(address + off, data[i] ?? 0));
  }

  private isAggregate(type: A.CType): boolean {
    return type.kind === "struct";
  }

  private doPrintf(args: A.Expression[]) {
    if (args.length === 0) return;
    const fmtExpr = args[0];
    let fmt: string;
    if (fmtExpr.kind === "StringLiteral") {
      fmt = fmtExpr.value;
    } else {
      return; // non-literal format strings unsupported
    }
    let argIdx = 1;
    let out = "";
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] === "%" && i + 1 < fmt.length) {
        let spec = fmt[++i];
        // %ld / %lu / %lf — skip length modifiers
        while ((spec === "l" || spec === "h") && i + 1 < fmt.length) spec = fmt[++i];
        if (spec === "%") {
          out += "%";
          continue;
        }
        const v = args[argIdx] ? this.evalExpr(args[argIdx]) : { value: 0, type: INT };
        argIdx++;
        if (spec === "d" || spec === "i" || spec === "u")
          out += String(Math.trunc(v.value));
        else if (spec === "c") out += String.fromCharCode(v.value);
        else if (spec === "s") out += this.readCString(v.value);
        else if (spec === "f") out += v.value.toFixed(6);
        else if (spec === "g") out += String(v.value);
        else if (spec === "p") out += this.hex(v.value);
        else if (spec === "x") out += v.value.toString(16);
        else out += "%" + spec;
      } else {
        out += fmt[i];
      }
    }
    this.output += out;
  }

  private readCString(address: number): string {
    let s = "";
    let a = address;
    for (let i = 0; i < 4096; i++) {
      if (!this.mem.hasCell(a)) break;
      const c = this.mem.readCell(a);
      if (!c.value) break;
      s += String.fromCharCode(c.value);
      a += 1;
    }
    return s;
  }

  // ---- Helpers ----

  private pointeeType(type: A.CType, line: number): A.CType {
    if (type.kind === "pointer") return type.to!;
    if (type.kind === "array") return type.of!;
    throw new RuntimeError("dereference of non-pointer value", line);
  }

  private truthy(v: RValue): boolean {
    return v.value !== 0;
  }

  private coerce(v: RValue, target: A.CType): RValue {
    if (target.kind === "char")
      return { type: target, value: Math.trunc(v.value) & 0xff };
    if (target.kind === "int") return { type: target, value: Math.trunc(v.value) };
    return { type: target, value: v.value };
  }

  // Best-effort static type of an expression (used only for sizeof).
  private typeOf(expr: A.Expression): A.CType {
    switch (expr.kind) {
      case "NumberLiteral":
        return expr.isFloat ? DOUBLE : INT;
      case "CharLiteral":
        return CHAR;
      case "Identifier": {
        const v = this.tryLookupVar(expr.name);
        return v ? v.type : INT;
      }
      case "Unary":
        if (expr.op === "*") {
          const t = this.typeOf(expr.operand);
          if (t.kind === "pointer" || t.kind === "array") return (t.to ?? t.of)!;
        }
        return INT;
      case "Index": {
        const t = this.typeOf(expr.array);
        if (t.kind === "pointer" || t.kind === "array") return (t.to ?? t.of)!;
        return INT;
      }
      default:
        return INT;
    }
  }
}

// Re-export for convenience.
export { typeSize };
