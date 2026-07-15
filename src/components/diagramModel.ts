// Shared model between the SVG diagram and exam mode: flattens a memory
// snapshot into ordered rows grouped by section / stack frame, and formats
// cell values the way the CSC 209 handouts write them.

import type { Block, Cell, MemorySnapshot } from "../interpreter/memory";
import type { CType } from "../interpreter/ast";

export const ROW_H = 30;
export const HEADER_H = 34;
export const SECTION_GAP = 14;

export interface DiagramRow {
  cell: Cell;
  blockName?: string; // main label, on the block's first row only
  ownerName: string; // the block's name, on every row (for hover linking)
  subLabel?: string; // per-cell path like "[2]" or ".x"
  blockId: number;
  frameId?: number; // owning stack frame, if any
  firstOfBlock: boolean;
  y: number;
}

export interface DiagramGroup {
  sectionLabel?: string;
  frameLabel?: string;
  frameId?: number;
  startY: number;
  endY: number;
  rows: DiagramRow[];
}

export function isPointer(t: CType): boolean {
  return t.kind === "pointer";
}

export function hex(n: number): string {
  return "0x" + n.toString(16);
}

export function formatValue(cell: Cell, functionAddrs?: Record<number, string>): string {
  if (cell.value === undefined) return "???";
  if (isPointer(cell.type)) {
    if (cell.value === 0) return "NULL";
    const fn = functionAddrs?.[cell.value];
    if (fn) return fn; // function pointer -> show the function's name
    return hex(cell.value);
  }
  if (cell.type.kind === "char") {
    const c = cell.value;
    if (c === 0) return "'\\0'";
    if (c >= 32 && c < 127) return `'${String.fromCharCode(c)}'`;
    return String(c);
  }
  if (cell.type.kind === "double" || cell.type.kind === "float") {
    return Number.isInteger(cell.value) ? cell.value.toFixed(1) : String(cell.value);
  }
  return String(cell.value);
}

// Flatten a snapshot into address -> value (undefined = uninitialized).
function snapshotValues(snap: MemorySnapshot): Map<number, number | undefined> {
  const m = new Map<number, number | undefined>();
  const add = (blocks: Block[]) => {
    for (const b of blocks) for (const c of b.cells) m.set(c.address, c.value);
  };
  add(snap.readonly);
  add(snap.globals);
  add(snap.heap);
  for (const f of snap.frames) add(f.blocks);
  return m;
}

// Addresses whose cells are new or whose value changed between two steps —
// used to highlight what the statement just executed actually did.
export function diffSnapshots(
  prev: MemorySnapshot | null,
  curr: MemorySnapshot
): Set<number> {
  const changed = new Set<number>();
  if (!prev) return changed; // first step: nothing to compare against
  const before = snapshotValues(prev);
  for (const [addr, value] of snapshotValues(curr)) {
    if (!before.has(addr) || before.get(addr) !== value) changed.add(addr);
  }
  return changed;
}

export interface PointerArrow {
  from: number; // address of the pointer cell
  to: number; // address it points at
}

// The arrows a student is expected to draw: every pointer cell holding a
// valid address of another visible cell. NULL, uninitialized, dangling and
// function pointers draw nothing.
export function expectedPointerArrows(
  snap: MemorySnapshot,
  functionAddrs?: Record<number, string>
): PointerArrow[] {
  const allCells: Cell[] = [];
  const collect = (blocks: Block[]) => {
    for (const b of blocks) allCells.push(...b.cells);
  };
  collect(snap.readonly);
  collect(snap.globals);
  collect(snap.heap);
  for (const f of snap.frames) collect(f.blocks);

  const addrs = new Set(allCells.map((c) => c.address));
  const arrows: PointerArrow[] = [];
  for (const c of allCells) {
    if (!isPointer(c.type) || c.value === undefined || c.value === 0) continue;
    if (functionAddrs?.[c.value]) continue;
    if (!addrs.has(c.value)) continue; // dangling — nothing to point at
    arrows.push({ from: c.address, to: c.value });
  }
  return arrows;
}

export function buildGroups(snap: MemorySnapshot): {
  groups: DiagramGroup[];
  height: number;
} {
  const groups: DiagramGroup[] = [];
  let y = HEADER_H;

  const addGroup = (
    blocks: Block[],
    sectionLabel: string | undefined,
    frameLabel?: string,
    frameId?: number
  ) => {
    if (blocks.length === 0 && !sectionLabel) return;
    const startY = y;
    const rows: DiagramRow[] = [];
    for (const b of blocks) {
      // A heap block holding exactly one element (e.g. malloc(sizeof(struct
      // node))) wraps every path in a pointless "[0]" — strip it.
      const single = b.type.kind === "array" && b.type.length === 1;
      b.cells.forEach((cell, i) => {
        let subLabel = cell.path;
        if (single && subLabel?.startsWith("[0]")) {
          subLabel = subLabel.slice(3) || undefined;
        }
        rows.push({
          cell,
          blockName: i === 0 ? b.name : undefined,
          ownerName: b.name,
          subLabel,
          blockId: b.id,
          frameId,
          firstOfBlock: i === 0,
          y,
        });
        y += ROW_H;
      });
    }
    // Keep an empty section visible with one blank row.
    if (blocks.length === 0) {
      y += ROW_H;
    }
    groups.push({ sectionLabel, frameLabel, frameId, startY, endY: y, rows });
  };

  addGroup(snap.readonly, "Read-only");
  y += SECTION_GAP;
  if (snap.globals.length > 0) {
    addGroup(snap.globals, "Globals");
    y += SECTION_GAP;
  }
  addGroup(snap.heap, "Heap");
  y += SECTION_GAP;

  snap.frames.forEach((f, idx) => {
    addGroup(f.blocks, idx === 0 ? "Stack" : undefined, f.frame.funcName, f.frame.id);
    y += SECTION_GAP;
  });

  return { groups, height: y + 10 };
}
