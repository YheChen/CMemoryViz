import { describe, it, expect } from "vitest";
import { run } from "../interpreter/interpreter";
import { diffSnapshots } from "./diagramModel";

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
