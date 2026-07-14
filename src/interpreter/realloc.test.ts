import { describe, it, expect } from "vitest";
import { run } from "./interpreter";

function lastHeap(src: string) {
  const r = run(src);
  expect(r.error).toBeUndefined();
  const snap = r.steps[r.steps.length - 1].snapshot;
  return { r, snap };
}

describe("2D dynamic arrays (int **)", () => {
  it("builds an array of row pointers pointing at heap rows", () => {
    const { snap } = lastHeap(`int main() {
      int **grid = malloc(2 * sizeof(int *));
      for (int i = 0; i < 2; i++) {
        grid[i] = malloc(3 * sizeof(int));
        for (int j = 0; j < 3; j++) grid[i][j] = i * 3 + j;
      }
      return 0;
    }`);
    expect(snap.heap.length).toBe(3); // outer + 2 rows
    const outer = snap.heap[0];
    const rowAddrs = snap.heap.slice(1).map((b) => b.address);
    // outer cells are pointers to the row blocks
    expect(outer.cells.every((c) => c.type.kind === "pointer")).toBe(true);
    expect(outer.cells.map((c) => c.value)).toEqual(rowAddrs);
    // rows hold 0..5
    const rowVals = snap.heap.slice(1).flatMap((b) => b.cells.map((c) => c.value));
    expect(rowVals).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("realloc", () => {
  it("copies old values into a new, larger block and relocates", () => {
    const r = run(`int main() {
      int *a = malloc(2 * sizeof(int));
      a[0] = 1;
      a[1] = 2;
      a = realloc(a, 4 * sizeof(int));
      a[2] = 3;
      a[3] = 4;
      free(a);
      return 0;
    }`);
    expect(r.error).toBeUndefined();
    // Just before free(): one live heap block of 4 ints = 1,2,3,4
    const preFree = r.steps.find((s) => s.line === 8)!.snapshot;
    expect(preFree.heap.length).toBe(1);
    expect(preFree.heap[0].cells.map((c) => c.value)).toEqual([1, 2, 3, 4]);
    // realloc counts as a free of the old + alloc of the new; everything freed
    expect(r.heap.leaks).toEqual([]);
    expect(r.heap.totalAllocs).toBe(2); // malloc + realloc's new block
  });

  it("realloc(NULL, n) behaves like malloc", () => {
    const r = run(`int main() {
      int *a = realloc(NULL, 3 * sizeof(int));
      a[0] = 7;
      free(a);
      return 0;
    }`);
    expect(r.error).toBeUndefined();
    expect(r.heap.totalAllocs).toBe(1);
    expect(r.heap.leaks).toEqual([]);
  });

  it("the old pointer becomes dangling after realloc relocates", () => {
    const r = run(`int main() {
      int *a = malloc(2 * sizeof(int));
      int *old = a;
      a = realloc(a, 8 * sizeof(int));
      int x = old[0];
      return 0;
    }`);
    expect(r.error?.message).toMatch(/freed|dangling/i);
  });
});
