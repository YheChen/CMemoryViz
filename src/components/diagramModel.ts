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
  subLabel?: string; // per-cell path like "[2]" or ".x"
  blockId: number;
  firstOfBlock: boolean;
  y: number;
}

export interface DiagramGroup {
  sectionLabel?: string;
  frameLabel?: string;
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

export function formatValue(
  cell: Cell,
  functionAddrs?: Record<number, string>
): string {
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

export function buildGroups(snap: MemorySnapshot): {
  groups: DiagramGroup[];
  height: number;
} {
  const groups: DiagramGroup[] = [];
  let y = HEADER_H;

  const addGroup = (
    blocks: Block[],
    sectionLabel: string | undefined,
    frameLabel?: string
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
          subLabel,
          blockId: b.id,
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
    groups.push({ sectionLabel, frameLabel, startY, endY: y, rows });
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
    addGroup(f.blocks, idx === 0 ? "Stack" : undefined, f.frame.funcName);
    y += SECTION_GAP;
  });

  return { groups, height: y + 10 };
}
