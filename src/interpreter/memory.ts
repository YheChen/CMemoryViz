// The memory model: sections, a deterministic "clean" address allocator, a
// typed cell store, and snapshot serialization for the diagram renderer.
//
// Conventions chosen to match the CSC 209 teaching model:
//   - int / pointer / float are 4 bytes, 4-byte aligned; double is 8 bytes,
//     8-byte aligned; char is 1 byte.
//   - Read-only, Globals, Heap and Stack are separate regions with fixed bases.
//   - Each function call pushes a labeled stack frame at a higher address.
//   - Uninitialized cells have value === undefined and render as "???".
//   - Globals are zero-initialized (as in real C).

import { CType } from "./ast";

export type Section = "readonly" | "globals" | "heap" | "stack";

// Fixed section bases, chosen to resemble the exam handout addresses.
export const READONLY_BASE = 0x104;
export const GLOBALS_BASE = 0x1a0;
export const HEAP_BASE = 0x240;
export const STACK_BASE = 0x444;
const FRAME_GAP = 4; // blank gap between adjacent stack frames

export interface Cell {
  address: number;
  size: number;
  type: CType;
  value: number | undefined; // undefined => uninitialized ("???")
  // Sub-label within the owning block, e.g. "[2]", ".x", "[1][0]", ".pt.y".
  path?: string;
}

export interface Block {
  id: number;
  address: number;
  size: number;
  section: Section;
  type: CType;
  name: string; // variable name, or "malloc(n)" for heap blocks
  frameId?: number;
  cells: Cell[];
}

export interface Frame {
  id: number;
  funcName: string;
  base: number;
  top: number; // next free address within this frame
}

export interface MemorySnapshot {
  readonly: Block[];
  globals: Block[];
  heap: Block[];
  frames: { frame: Frame; blocks: Block[] }[];
}

export function typeSize(type: CType): number {
  switch (type.kind) {
    case "int":
    case "float":
      return 4;
    case "char":
      return 1;
    case "void":
      return 1;
    case "double":
      return 8;
    case "pointer":
      return 4;
    case "array":
      return (type.length ?? 0) * typeSize(type.of!);
    case "struct":
      // Filled in via the structs registry; see MemoryModel.sizeOf.
      return 0;
    case "func":
      return 1; // never allocated directly; only pointed to
  }
}

function align(addr: number, to: number): number {
  return Math.ceil(addr / to) * to;
}

function hex(n: number): string {
  return "0x" + n.toString(16);
}

export class MemoryModel {
  private store = new Map<number, Cell>();
  private blocks: Block[] = [];
  private frames: Frame[] = [];
  private nextReadonly = READONLY_BASE;
  private nextGlobal = GLOBALS_BASE;
  private nextHeap = HEAP_BASE;
  // Address ranges released by free(), for dangling-pointer diagnostics.
  private freedRanges: { start: number; end: number }[] = [];
  private blockId = 0;
  private frameId = 0;

  // struct tag -> ordered fields with computed offsets and total size
  private structs = new Map<
    string,
    { fields: { name: string; type: CType; offset: number }[]; size: number }
  >();

  registerStruct(name: string, fields: { name: string; type: CType }[]): void {
    let offset = 0;
    const laid: { name: string; type: CType; offset: number }[] = [];
    for (const f of fields) {
      const a = this.alignOf(f.type);
      offset = align(offset, a);
      laid.push({ name: f.name, type: f.type, offset });
      offset += this.sizeOf(f.type);
    }
    this.structs.set(name, { fields: laid, size: align(offset, 4) });
  }

  getStruct(name: string) {
    const s = this.structs.get(name);
    if (!s) throw new Error(`unknown struct '${name}'`);
    return s;
  }

  sizeOf(type: CType): number {
    if (type.kind === "struct") return this.getStruct(type.name!).size;
    if (type.kind === "array") return (type.length ?? 0) * this.sizeOf(type.of!);
    return typeSize(type);
  }

  private alignOf(type: CType): number {
    if (type.kind === "char") return 1;
    if (type.kind === "double") return 8;
    if (type.kind === "array") return this.alignOf(type.of!);
    if (type.kind === "struct") return 4;
    return 4;
  }

  // ---- Frames ----

  pushFrame(funcName: string): Frame {
    let base: number;
    if (this.frames.length === 0) {
      base = STACK_BASE;
    } else {
      const top = this.frames[this.frames.length - 1].top;
      base = align(top, 4) + FRAME_GAP;
    }
    const frame: Frame = { id: this.frameId++, funcName, base, top: base };
    this.frames.push(frame);
    return frame;
  }

  popFrame(): void {
    const frame = this.frames.pop();
    if (!frame) return;
    // Reclaim the frame's storage.
    this.blocks = this.blocks.filter((b) => {
      if (b.frameId === frame.id) {
        for (const c of b.cells) this.store.delete(c.address);
        return false;
      }
      return true;
    });
  }

  currentFrame(): Frame {
    return this.frames[this.frames.length - 1];
  }

  // ---- Allocation ----

  // Builds the leaf cells for a block, threading a `path` sub-label through
  // nested arrays/structs so `m[1][0]` and `p.pt.y` render meaningfully.
  private makeCells(address: number, type: CType): Cell[] {
    const cells: Cell[] = [];
    const build = (addr: number, t: CType, path: string): number => {
      if (t.kind === "array") {
        let a = addr;
        for (let k = 0; k < (t.length ?? 0); k++) {
          a = build(a, t.of!, `${path}[${k}]`);
        }
        return a;
      }
      if (t.kind === "struct") {
        const s = this.getStruct(t.name!);
        for (const f of s.fields) {
          build(addr + f.offset, f.type, `${path}.${f.name}`);
        }
        return addr + s.size;
      }
      const cell: Cell = {
        address: addr,
        size: this.sizeOf(t),
        type: t,
        value: undefined,
        path: path || undefined,
      };
      this.store.set(addr, cell);
      cells.push(cell);
      return addr + this.sizeOf(t);
    };
    build(address, type, "");
    return cells;
  }

  allocLocal(name: string, type: CType): Block {
    const frame = this.currentFrame();
    const a = this.alignOf(type);
    const address = align(frame.top, a);
    const size = this.sizeOf(type);
    const cells = this.makeCells(address, type);
    frame.top = address + size;
    const block: Block = {
      id: this.blockId++,
      address,
      size,
      section: "stack",
      type,
      name,
      frameId: frame.id,
      cells,
    };
    this.blocks.push(block);
    return block;
  }

  allocGlobal(name: string, type: CType): Block {
    const a = this.alignOf(type);
    const address = align(this.nextGlobal, a);
    const size = this.sizeOf(type);
    const cells = this.makeCells(address, type);
    // C zero-initializes globals.
    for (const c of cells) c.value = 0;
    this.nextGlobal = address + size;
    const block: Block = {
      id: this.blockId++,
      address,
      size,
      section: "globals",
      type,
      name,
      cells,
    };
    this.blocks.push(block);
    return block;
  }

  allocHeap(elemType: CType, count: number): Block {
    const type: CType = { kind: "array", of: elemType, length: count };
    const size = this.sizeOf(type);
    const address = align(this.nextHeap, Math.max(4, this.alignOf(elemType)));
    const cells = this.makeCells(address, type);
    this.nextHeap = address + size;
    const block: Block = {
      id: this.blockId++,
      address,
      size,
      section: "heap",
      type,
      name: `malloc(${size})`,
      cells,
    };
    this.blocks.push(block);
    return block;
  }

  // realloc: allocate a fresh block, copy the overlapping prefix, and free the
  // old one. We always relocate (rather than growing in place) so the diagram
  // shows the block move — the whole point of the "realloc can invalidate your
  // pointer" lesson. Returns the new block.
  reallocHeap(oldAddress: number, elemType: CType, count: number): Block {
    const old = this.blocks.find(
      (b) => b.section === "heap" && b.address === oldAddress
    );
    if (!old) {
      const freed = this.freedRanges.some((r) => r.start === oldAddress);
      throw new Error(
        freed
          ? `realloc() of already-freed pointer ${hex(oldAddress)}`
          : `realloc() of invalid pointer ${hex(oldAddress)} (not the start of a heap block)`
      );
    }
    const oldValues = old.cells.map((c) => c.value);
    const block = this.allocHeap(elemType, count);
    const n = Math.min(oldValues.length, block.cells.length);
    for (let i = 0; i < n; i++) block.cells[i].value = oldValues[i];
    this.freeHeap(oldAddress);
    return block;
  }

  freeHeap(address: number): void {
    if (address === 0) return; // free(NULL) is a no-op
    if (this.freedRanges.some((r) => r.start === address)) {
      throw new Error(`double free detected at ${hex(address)}`);
    }
    const idx = this.blocks.findIndex(
      (b) => b.section === "heap" && b.address === address
    );
    if (idx === -1) {
      throw new Error(
        `free() of invalid pointer ${hex(address)} (not the start of a heap block)`
      );
    }
    const block = this.blocks[idx];
    for (const c of block.cells) this.store.delete(c.address);
    this.blocks.splice(idx, 1);
    this.freedRanges.push({ start: block.address, end: block.address + block.size });
  }

  allocReadonlyString(str: string): Block {
    // Deduplicate identical literals (like real compilers merge strings).
    const existing = this.blocks.find(
      (b) => b.section === "readonly" && b.name === `"${str}"`
    );
    if (existing) return existing;
    const bytes = [...str].map((ch) => ch.charCodeAt(0));
    bytes.push(0); // NUL terminator
    const type: CType = { kind: "array", of: { kind: "char" }, length: bytes.length };
    const address = this.nextReadonly;
    const cells = this.makeCells(address, type);
    cells.forEach((c, k) => (c.value = bytes[k]));
    this.nextReadonly = address + bytes.length;
    const block: Block = {
      id: this.blockId++,
      address,
      size: bytes.length,
      section: "readonly",
      type,
      name: `"${str}"`,
      cells,
    };
    this.blocks.push(block);
    return block;
  }

  // ---- Read / write by address ----

  readCell(address: number): Cell {
    const cell = this.store.get(address);
    if (!cell) {
      const freed = this.freedRanges.find((r) => address >= r.start && address < r.end);
      if (freed) {
        throw new Error(
          `read of freed heap memory at ${hex(address)} — dangling pointer (block ${hex(freed.start)} was free()d)`
        );
      }
      throw new Error(
        `invalid memory access at ${hex(address)} (unallocated, or a stack frame that has been popped)`
      );
    }
    return cell;
  }

  hasCell(address: number): boolean {
    return this.store.has(address);
  }

  write(address: number, value: number): void {
    const cell = this.readCell(address);
    cell.value = value;
  }

  // ---- Snapshot for rendering ----

  snapshot(): MemorySnapshot {
    const readonly = this.blocks.filter((b) => b.section === "readonly");
    const globals = this.blocks.filter((b) => b.section === "globals");
    const heap = this.blocks.filter((b) => b.section === "heap");
    const frames = this.frames.map((frame) => ({
      frame,
      blocks: this.blocks.filter((b) => b.frameId === frame.id),
    }));
    return { readonly, globals, heap, frames };
  }
}
