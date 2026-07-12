import { describe, it, expect } from "vitest";
import { run } from "../interpreter/interpreter";
import { diffSnapshots, expectedPointerArrows } from "./diagramModel";

describe("diffSnapshots", () => {
  const r = run(`int main() {
    int x = 1;
    int y = 2;
    x = 10;
    return 0;
}`);
  // steps: [line2 decl x, line3 decl y, line4 assign, line5 return]
  // Each snapshot is taken BEFORE the statement runs, so the diff at step i
  // shows what statement i-1 did.

  it("no highlight on the first step", () => {
    expect(diffSnapshots(null, r.steps[0].snapshot).size).toBe(0);
  });

  it("new allocation + init shows as changed", () => {
    // step 2's snapshot reflects `int x = 1;` having run
    const changed = diffSnapshots(r.steps[0].snapshot, r.steps[1].snapshot);
    expect(changed.size).toBe(1); // just x's cell
    expect([...changed][0]).toBe(0x444);
  });

  it("assignment to existing cell shows as changed", () => {
    // step 4's snapshot reflects `x = 10;` having run
    const changed = diffSnapshots(r.steps[2].snapshot, r.steps[3].snapshot);
    expect([...changed]).toEqual([0x444]);
  });

  it("statement with no memory effect changes nothing", () => {
    const r2 = run(`int main() {
      int x = 1;
      if (x > 0) { }
      x = 2;
      return 0;
    }`);
    // snapshot before `x = 2` vs snapshot before `return`: only the if ran
    // between decl and assign... find consecutive steps with equal snapshots
    const diffs = r2.steps.slice(1).map((s, i) =>
      diffSnapshots(r2.steps[i].snapshot, s.snapshot).size
    );
    expect(diffs).toContain(0); // the `if` step changed nothing
  });
});

describe("expectedPointerArrows", () => {
  it("sumpairs at return: a->arr and result->heap, pairs (???) draws nothing", () => {
    const r = run(`int *sumpairs(int *a, int size) {
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
    }`);
    const snap = r.steps.find((s) => s.note === "return")!.snapshot;
    const arrows = expectedPointerArrows(snap, r.functionAddrs);
    expect(arrows).toEqual([
      { from: 0x45c, to: 0x444 }, // a -> arr
      { from: 0x464, to: 0x240 }, // result -> heap block
    ]);
  });

  it("NULL, dangling, and function pointers draw nothing", () => {
    const r = run(`int add(int a, int b) { return a + b; }
    int main() {
      int (*fp)(int, int) = add;
      int *n = NULL;
      int *d = malloc(4);
      free(d);
      return 0;
    }`);
    const snap = r.steps[r.steps.length - 1].snapshot;
    expect(expectedPointerArrows(snap, r.functionAddrs)).toEqual([]);
  });
});
