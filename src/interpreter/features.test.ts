import { describe, it, expect } from "vitest";
import { run } from "./interpreter";
import type { MemorySnapshot } from "./memory";

function lastSnap(src: string): MemorySnapshot {
  const r = run(src);
  expect(r.error, r.error?.message).toBeUndefined();
  return r.steps[r.steps.length - 1].snapshot;
}

function cellsOf(snap: MemorySnapshot, name: string) {
  const all = [
    ...snap.globals,
    ...snap.heap,
    ...snap.readonly,
    ...snap.frames.flatMap((f) => f.blocks),
  ];
  const b = all.find((b) => b.name === name);
  expect(b, `block '${name}' not found`).toBeTruthy();
  return b!.cells;
}

describe("structs", () => {
  it("stack struct with field paths", () => {
    const snap = lastSnap(`
      struct point { int x; int y; };
      int main() {
        struct point p;
        p.x = 3;
        p.y = 5;
        return 0;
      }`);
    const cells = cellsOf(snap, "p");
    expect(cells.map((c) => [c.path, c.value])).toEqual([
      [".x", 3],
      [".y", 5],
    ]);
  });

  it("struct init list + pointer/arrow access", () => {
    const snap = lastSnap(`
      struct point { int x; int y; };
      int main() {
        struct point p = {3, 5};
        struct point *q = &p;
        q->y = 9;
        return 0;
      }`);
    const cells = cellsOf(snap, "p");
    expect(cells.map((c) => c.value)).toEqual([3, 9]);
  });

  it("heap struct via malloc + arrow", () => {
    const snap = lastSnap(`
      struct node { int val; struct node *next; };
      int main() {
        struct node *n = malloc(sizeof(struct node));
        n->val = 42;
        n->next = NULL;
        return 0;
      }`);
    const heap = snap.heap[0].cells;
    expect(heap.map((c) => [c.path, c.value])).toEqual([
      ["[0].val", 42],
      ["[0].next", 0],
    ]);
  });
});

describe("strings", () => {
  it("char s[] = literal copies bytes onto the stack", () => {
    const snap = lastSnap(`int main() { char s[] = "hi"; return 0; }`);
    const cells = cellsOf(snap, "s");
    expect(cells.map((c) => c.value)).toEqual([104, 105, 0]);
    expect(cells.map((c) => c.path)).toEqual(["[0]", "[1]", "[2]"]);
  });

  it("char *s = literal points into read-only", () => {
    const snap = lastSnap(`int main() { char *s = "ok"; return 0; }`);
    const ro = snap.readonly[0];
    expect(ro.name).toBe('"ok"');
    expect(ro.cells.map((c) => c.value)).toEqual([111, 107, 0]);
    const s = cellsOf(snap, "s")[0];
    expect(s.value).toBe(ro.address);
  });

  it("strlen works", () => {
    const r = run(`int main() { printf("%d", strlen("hello")); return 0; }`);
    expect(r.output).toBe("5");
  });
});

describe("2D arrays", () => {
  it("nested init and indexed writes", () => {
    const snap = lastSnap(`
      int main() {
        int m[2][2] = {{1, 2}, {3, 4}};
        m[1][0] = 30;
        return 0;
      }`);
    const cells = cellsOf(snap, "m");
    expect(cells.map((c) => [c.path, c.value])).toEqual([
      ["[0][0]", 1],
      ["[0][1]", 2],
      ["[1][0]", 30],
      ["[1][1]", 4],
    ]);
  });

  it("outer length inference: int m[][2] = {{..},{..},{..}}", () => {
    const snap = lastSnap(`
      int main() {
        int m[][2] = {{1,2},{3,4},{5,6}};
        return 0;
      }`);
    expect(cellsOf(snap, "m")).toHaveLength(6);
  });
});

describe("globals", () => {
  it("zero-initialized by default, own section", () => {
    const snap = lastSnap(`
      int counter;
      int limit = 7;
      int main() { counter = counter + 1; return 0; }`);
    expect(cellsOf(snap, "counter")[0].value).toBe(1);
    expect(cellsOf(snap, "limit")[0].value).toBe(7);
    expect(snap.globals.map((b) => b.name)).toEqual(["counter", "limit"]);
    expect(snap.globals[0].address).toBe(0x1a0);
  });

  it("global array", () => {
    const snap = lastSnap(`
      int table[3] = {10, 20, 30};
      int main() { return 0; }`);
    expect(cellsOf(snap, "table").map((c) => c.value)).toEqual([10, 20, 30]);
  });
});

describe("float/double", () => {
  it("double arithmetic does not truncate", () => {
    const r = run(`int main() { double d = 7.0; printf("%f", d / 2); return 0; }`);
    expect(r.output).toBe("3.500000");
  });

  it("int division still truncates", () => {
    const r = run(`int main() { printf("%d", 7 / 2); return 0; }`);
    expect(r.output).toBe("3");
  });

  it("double occupies 8 bytes", () => {
    const snap = lastSnap(`int main() { double d = 1.5; int x = 2; return 0; }`);
    const d = cellsOf(snap, "d")[0];
    const x = cellsOf(snap, "x")[0];
    expect(d.size).toBe(8);
    expect(x.address - d.address).toBe(8);
  });

  it("(int) cast truncates", () => {
    const r = run(`int main() { printf("%d", (int)3.9); return 0; }`);
    expect(r.output).toBe("3");
  });
});

describe("function pointers", () => {
  it("declare, assign, call via fp and (*fp)", () => {
    const r = run(`
      int add(int a, int b) { return a + b; }
      int mul(int a, int b) { return a * b; }
      int main() {
        int (*fp)(int, int) = add;
        int x = fp(2, 3);
        fp = &mul;
        int y = (*fp)(2, 3);
        printf("%d %d", x, y);
        return 0;
      }`);
    expect(r.error).toBeUndefined();
    expect(r.output).toBe("5 6");
  });

  it("fp cell holds the function pseudo-address", () => {
    const r = run(`
      int add(int a, int b) { return a + b; }
      int main() { int (*fp)(int, int) = add; return 0; }`);
    expect(r.error).toBeUndefined();
    const snap = r.steps[r.steps.length - 1].snapshot;
    const fp = cellsOf(snap, "fp")[0];
    expect(r.functionAddrs[fp.value!]).toBe("add");
  });

  it("function pointer as parameter", () => {
    const r = run(`
      int twice(int x) { return 2 * x; }
      int apply(int (*f)(int), int v) { return f(v); }
      int main() { printf("%d", apply(twice, 21)); return 0; }`);
    expect(r.error).toBeUndefined();
    expect(r.output).toBe("42");
  });
});

describe("diagnostics", () => {
  it("reading freed memory names the freed block", () => {
    const r = run(`
      int main() {
        int *p = malloc(2 * sizeof(int));
        p[0] = 1;
        free(p);
        int x = p[0];
        return 0;
      }`);
    expect(r.error?.message).toMatch(/freed heap memory/);
    expect(r.error?.message).toMatch(/dangling/);
    expect(r.error?.line).toBe(6);
  });

  it("double free detected", () => {
    const r = run(`
      int main() {
        int *p = malloc(4);
        free(p);
        free(p);
        return 0;
      }`);
    expect(r.error?.message).toMatch(/double free/);
  });

  it("free of a non-block pointer rejected", () => {
    const r = run(`
      int main() {
        int *p = malloc(2 * sizeof(int));
        free(p + 1);
        return 0;
      }`);
    expect(r.error?.message).toMatch(/invalid pointer/);
  });

  it("uninitialized read includes name and address", () => {
    const r = run(`int main() { int x; int y = x + 1; return 0; }`);
    expect(r.error?.message).toMatch(/uninitialized variable 'x'/);
    expect(r.error?.message).toMatch(/0x/);
  });
});

describe("printf extensions", () => {
  it("%f %p %x %c", () => {
    const r = run(`
      int main() {
        int arr[1] = {255};
        printf("%f|%p|%x|%c", 1.5, arr, arr[0], 65);
        return 0;
      }`);
    expect(r.error).toBeUndefined();
    expect(r.output).toBe("1.500000|0x444|ff|A");
  });
});
