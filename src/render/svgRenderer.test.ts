import { describe, it, expect } from "vitest";
import { run } from "../interpreter/interpreter";
import { renderMemorySvg, renderMemoryText } from "./svgRenderer";

const SRC = `int *sumpairs(int *a, int size) {
    int *result = malloc(size / 2 * sizeof(int));
    for (int i = 0; i < size / 2; i++) result[i] = a[i * 2] + a[i * 2 + 1];
    return result;
}
int main() {
    int arr[] = {1, 2, 3, 4};
    int *pairs = sumpairs(arr, 4);
    free(pairs);
    return 0;
}`;

function returnStep() {
  const r = run(SRC);
  const step = r.steps.find((s) => s.note === "return")!;
  return { step, functionAddrs: r.functionAddrs };
}

describe("renderMemorySvg", () => {
  const { step, functionAddrs } = returnStep();
  const svg = renderMemorySvg(step.snapshot, { functionAddrs, title: "demo" });

  it("produces a well-formed standalone SVG", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // Balanced <text> tags (rough well-formedness check).
    const open = (svg.match(/<text/g) || []).length;
    const close = (svg.match(/<\/text>/g) || []).length;
    expect(open).toBe(close);
  });

  it("includes the diagram content", () => {
    expect(svg).toContain("Address");
    expect(svg).toContain("0x240"); // heap block
    expect(svg).toContain("0x444"); // arr
    expect(svg).toContain("sumpairs"); // frame label
    expect(svg).toContain("demo"); // title
  });

  it("draws pointer arrows", () => {
    expect(svg).toContain("marker-end");
  });

  it("escapes XML-special characters in values", () => {
    // char holding '<' must not appear as a raw angle bracket in a value.
    const r = run(`int main() { char c = '<'; return 0; }`);
    const s = renderMemorySvg(r.steps[r.steps.length - 1].snapshot, {});
    expect(s).toContain("&lt;");
  });
});

describe("renderMemoryText", () => {
  const { step, functionAddrs } = returnStep();
  const txt = renderMemoryText(step.snapshot, { functionAddrs });

  it("renders an aligned table with the right cells", () => {
    expect(txt).toContain("SECTION");
    expect(txt).toContain("0x240");
    expect(txt).toContain("malloc(8)");
    expect(txt).toContain("frame: sumpairs");
    expect(txt).toContain("???"); // uninitialized pairs
  });
});
