import { describe, it, expect } from "vitest";
import { run } from "./interpreter";
import type { MemorySnapshot } from "./memory";

const SUMPAIRS = `int *sumpairs(int *a, int size) {
    int *result = malloc(size / 2 * sizeof(int));
    for (int i = 0; i < size / 2; i++) {
        result[i] = a[i * 2] + a[i * 2 + 1];
    }
    return result;
}
int main() {
    int arr[] = {1, 2, 3, 4};
    int *pairs = sumpairs(arr, 4);
    free(pairs);
    return 0;
}`;

function flatCells(snap: MemorySnapshot) {
  const rows: {
    addr: number;
    value: number | undefined;
    kind: string;
    label?: string;
  }[] = [];
  const push = (blocks: any[]) => {
    for (const b of blocks)
      for (const c of b.cells)
        rows.push({ addr: c.address, value: c.value, kind: c.type.kind, label: b.name });
  };
  push(snap.readonly);
  push(snap.heap);
  for (const f of snap.frames) push(f.blocks);
  return rows;
}

describe("sumpairs midterm example", () => {
  const r = run(SUMPAIRS);

  it("runs without error", () => {
    expect(r.error).toBeUndefined();
    expect(r.steps.length).toBeGreaterThan(0);
  });

  it("has correct state at the 'return result' step (line: return in sumpairs)", () => {
    // Find the step recorded for the return statement inside sumpairs.
    const step = r.steps.find((s) => s.note === "return");
    expect(step).toBeTruthy();
    const snap = step!.snapshot;

    // Two active frames: main then sumpairs
    expect(snap.frames.map((f) => f.frame.funcName)).toEqual(["main", "sumpairs"]);

    // Heap: 2 ints, values 3 and 7
    const heapCells = snap.heap.flatMap((b) => b.cells);
    expect(heapCells.map((c) => c.value)).toEqual([3, 7]);

    const rows = flatCells(snap);
    // arr holds 1,2,3,4
    const arr = rows.filter((x) => x.label === "arr");
    expect(arr.map((c) => c.value)).toEqual([1, 2, 3, 4]);

    // pairs is uninitialized at this point (sumpairs hasn't returned)
    const pairs = rows.find((x) => x.label === "pairs");
    expect(pairs?.value).toBeUndefined();

    // result points to the heap block base
    const result = rows.find((x) => x.label === "result");
    const heapBase = snap.heap[0].address;
    expect(result?.value).toBe(heapBase);

    // i == 2 at loop exit
    const i = rows.find((x) => x.label === "i");
    expect(i?.value).toBe(2);

    // 'a' points to arr base
    const a = rows.find((x) => x.label === "a");
    const arrBase = arr[0].addr;
    expect(a?.value).toBe(arrBase);
  });

  it("uses clean CSC209-style addresses", () => {
    const snap = r.steps.find((s) => s.note === "return")!.snapshot;
    expect(snap.heap[0].address).toBe(0x240);
    const mainArr = snap.frames[0].blocks.find((b) => b.name === "arr")!;
    expect(mainArr.address).toBe(0x444);
  });
});
