import { describe, it, expect } from "vitest";
import { CHALLENGES } from "./challenges";
import { run } from "./interpreter/interpreter";

describe("challenge bank", () => {
  it("has unique ids", () => {
    const ids = CHALLENGES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const c of CHALLENGES) {
    describe(c.title, () => {
      const r = run(c.source);

      it("runs without error", () => {
        expect(r.error).toBeUndefined();
        expect(r.steps.length).toBeGreaterThan(0);
      });

      it("has a step at the target line", () => {
        const idx = r.steps.findIndex(
          (s) => s.line === c.targetLine && (!c.targetNote || s.note === c.targetNote)
        );
        expect(
          idx,
          `no step at line ${c.targetLine}${c.targetNote ? ` (note ${c.targetNote})` : ""}`
        ).toBeGreaterThanOrEqual(0);
      });

      it("target step has memory to fill in", () => {
        const step = r.steps.find(
          (s) => s.line === c.targetLine && (!c.targetNote || s.note === c.targetNote)
        )!;
        const snap = step.snapshot;
        const cells =
          snap.heap.flatMap((b) => b.cells).length +
          snap.frames.flatMap((f) => f.blocks).flatMap((b) => b.cells).length;
        expect(cells).toBeGreaterThan(0);
      });
    });
  }
});
