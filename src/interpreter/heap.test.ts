import { describe, it, expect } from "vitest";
import { run } from "./interpreter";

describe("heap lifecycle report", () => {
  it("reports no leaks when every block is freed", () => {
    const r = run(`int main() {
      int *p = malloc(4 * sizeof(int));
      free(p);
      return 0;
    }`);
    expect(r.error).toBeUndefined();
    expect(r.heap.totalAllocs).toBe(1);
    expect(r.heap.totalFreed).toBe(1);
    expect(r.heap.leaks).toEqual([]);
    expect(r.heap.leakedBytes).toBe(0);
  });

  it("reports a leak for a block never freed, with its line", () => {
    const r = run(`int main() {
      int *p = malloc(2 * sizeof(int));
      return 0;
    }`);
    expect(r.heap.leaks.length).toBe(1);
    expect(r.heap.leaks[0].line).toBe(2);
    expect(r.heap.leaks[0].size).toBe(8);
    expect(r.heap.leakedBytes).toBe(8);
  });

  it("counts multiple allocations and partial frees", () => {
    const r = run(`int main() {
      int *a = malloc(4);
      int *b = malloc(8);
      int *c = malloc(12);
      free(b);
      return 0;
    }`);
    expect(r.heap.totalAllocs).toBe(3);
    expect(r.heap.totalFreed).toBe(1);
    expect(r.heap.leakedBytes).toBe(16); // a (4) + c (12)
    expect(r.heap.leaks.map((l) => l.size).sort((x, y) => x - y)).toEqual([4, 12]);
  });

  it("free(NULL) is a no-op and not counted", () => {
    const r = run(`int main() {
      int *p = NULL;
      free(p);
      return 0;
    }`);
    expect(r.error).toBeUndefined();
    expect(r.heap.totalFreed).toBe(0);
    expect(r.heap.events.length).toBe(0);
  });

  it("events carry a step index for live-at-step computation", () => {
    const r = run(`int main() {
      int *p = malloc(4);
      free(p);
      return 0;
    }`);
    expect(r.heap.events.map((e) => e.kind)).toEqual(["alloc", "free"]);
    const [a, f] = r.heap.events;
    expect(f.step).toBeGreaterThanOrEqual(a.step);
  });
});
