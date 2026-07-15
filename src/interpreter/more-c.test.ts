import { describe, it, expect } from "vitest";
import { run } from "./interpreter";

function ok(src: string) {
  const r = run(src);
  expect(r.error, r.error?.message).toBeUndefined();
  return r;
}

describe("string.h builtins", () => {
  it("strcpy / strlen", () => {
    const r = ok(`int main() {
      char dst[8];
      strcpy(dst, "hi");
      printf("%s %d", dst, strlen(dst));
      return 0;
    }`);
    expect(r.output).toBe("hi 2");
  });

  it("strcat", () => {
    const r = ok(`int main() {
      char s[16];
      strcpy(s, "foo");
      strcat(s, "bar");
      printf("%s", s);
      return 0;
    }`);
    expect(r.output).toBe("foobar");
  });

  it("strcmp orders strings", () => {
    const r = ok(`int main() {
      printf("%d %d %d", strcmp("a", "a"), strcmp("a", "b") < 0, strcmp("b", "a") > 0);
      return 0;
    }`);
    expect(r.output).toBe("0 1 1");
  });

  it("memcpy copies ints", () => {
    const r = ok(`int main() {
      int a[3] = {1, 2, 3};
      int b[3];
      memcpy(b, a, 3 * sizeof(int));
      printf("%d %d %d", b[0], b[1], b[2]);
      return 0;
    }`);
    expect(r.output).toBe("1 2 3");
  });
});

describe("enum", () => {
  it("assigns sequential and explicit values", () => {
    const r = ok(`enum Color { RED, GREEN, BLUE = 5, PURPLE };
    int main() {
      printf("%d %d %d %d", RED, GREEN, BLUE, PURPLE);
      return 0;
    }`);
    expect(r.output).toBe("0 1 5 6");
  });

  it("enum constants usable in expressions", () => {
    const r = ok(`enum { LO = 2, HI = 10 };
    int main() {
      int mid = (LO + HI) / 2;
      printf("%d", mid);
      return 0;
    }`);
    expect(r.output).toBe("6");
  });
});

describe("typedef", () => {
  it("aliases a primitive", () => {
    const r = ok(`typedef int myint;
    int main() { myint x = 41; x = x + 1; printf("%d", x); return 0; }`);
    expect(r.output).toBe("42");
  });

  it("aliases an anonymous struct", () => {
    const r = ok(`typedef struct { int x; int y; } Point;
    int main() {
      Point p;
      p.x = 3;
      p.y = 4;
      printf("%d", p.x * p.x + p.y * p.y);
      return 0;
    }`);
    expect(r.output).toBe("25");
  });

  it("aliases a pointer type", () => {
    const r = ok(`typedef int *IntPtr;
    int main() {
      int v = 9;
      IntPtr p = &v;
      *p = 12;
      printf("%d", v);
      return 0;
    }`);
    expect(r.output).toBe("12");
  });
});

describe("union", () => {
  it("fields overlap; size is the largest member", () => {
    const r = ok(`union U { int i; char c; };
    int main() {
      union U u;
      u.i = 65;
      printf("%d", u.i);
      return 0;
    }`);
    expect(r.output).toBe("65");
    const snap = r.steps[r.steps.length - 1].snapshot;
    const uBlock = snap.frames[0].blocks.find((b) => b.name === "u")!;
    expect(uBlock.size).toBe(4); // max(int=4, char=1) aligned to 4
  });
});

describe("struct by value", () => {
  it("assignment copies all fields", () => {
    const r = ok(`struct P { int x; int y; };
    int main() {
      struct P a;
      a.x = 1;
      a.y = 2;
      struct P b;
      b = a;
      a.x = 99;
      printf("%d %d %d", b.x, b.y, a.x);
      return 0;
    }`);
    expect(r.output).toBe("1 2 99");
  });

  it("passes structs to functions by value (copy)", () => {
    const r = ok(`struct P { int x; int y; };
    int sum(struct P p) { p.x = 0; return p.x + p.y; }
    int main() {
      struct P a;
      a.x = 10;
      a.y = 20;
      int s = sum(a);
      printf("%d %d", s, a.x);
      return 0;
    }`);
    // sum sees x=10,y=20 -> sets p.x=0 -> returns 20; caller's a.x stays 10
    expect(r.output).toBe("20 10");
  });

  it("returns structs by value", () => {
    const r = ok(`struct P { int x; int y; };
    struct P make(int a, int b) {
      struct P p;
      p.x = a;
      p.y = b;
      return p;
    }
    int main() {
      struct P q = make(7, 8);
      printf("%d %d", q.x, q.y);
      return 0;
    }`);
    expect(r.output).toBe("7 8");
  });
});
