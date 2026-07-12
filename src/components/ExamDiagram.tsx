// Exam mode: the same memory table, but Value and Label columns are blank
// inputs for the student to fill in — and pointer arrows must be drawn by
// hand, exactly like the midterm. "Check" grades values, labels AND arrows
// leniently; "Reveal" fills in the answers and draws the arrows.
//
// Drawing an arrow: click ◉ on the pointer's row, then ◉ on the target row.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MemorySnapshot, Cell } from "../interpreter/memory";
import {
  buildGroups,
  expectedPointerArrows,
  formatValue,
  hex,
  isPointer,
  PointerArrow,
} from "./diagramModel";

interface Props {
  snapshot: MemorySnapshot;
  functionAddrs?: Record<number, string>;
}

type Grade = "ok" | "bad" | undefined;

function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase();
}

// Lenient per-cell grading.
function gradeValue(
  input: string,
  cell: Cell,
  functionAddrs?: Record<number, string>
): boolean {
  const s = normalizeAnswer(input);
  if (cell.value === undefined) {
    return /^\?+$/.test(s) || s === "uninitialized" || s === "uninit" || s === "garbage";
  }
  if (isPointer(cell.type)) {
    if (cell.value === 0) return ["null", "0", "0x0", "(null)"].includes(s);
    const fn = functionAddrs?.[cell.value];
    if (fn && s === fn.toLowerCase()) return true;
    const cleaned = s.replace(/^0x/, "");
    return /^[0-9a-f]+$/.test(cleaned) && parseInt(cleaned, 16) === cell.value;
  }
  if (cell.type.kind === "char") {
    // Chars are case-sensitive — grade against the raw (trimmed) input.
    const raw = input.trim();
    const m = raw.match(/^'(\\?.)'$/) ?? raw.match(/^(\\?.)$/);
    if (m) {
      const body = m[1];
      const code =
        body === "\\0" ? 0 : body === "\\n" ? 10 : body === "\\t" ? 9 : body.charCodeAt(0);
      return code === cell.value;
    }
    return Number(raw) === cell.value;
  }
  if (cell.type.kind === "double" || cell.type.kind === "float") {
    const num = parseFloat(s);
    return !Number.isNaN(num) && Math.abs(num - cell.value) < 1e-9;
  }
  return Number(s) === cell.value;
}

function gradeLabel(input: string, expected: string): boolean {
  return normalizeAnswer(input) === normalizeAnswer(expected);
}

// Heap "malloc(8)" and read-only string labels aren't variable names — the
// student can't be expected to invent them, so they aren't graded.
function isGradableLabel(name: string): boolean {
  return !name.startsWith("malloc(") && !name.startsWith('"');
}

const arrowKey = (a: PointerArrow) => `${a.from}>${a.to}`;

export function ExamDiagram({ snapshot, functionAddrs }: Props) {
  const { groups } = useMemo(() => buildGroups(snapshot), [snapshot]);
  const expected = useMemo(
    () => expectedPointerArrows(snapshot, functionAddrs),
    [snapshot, functionAddrs]
  );

  const [values, setValues] = useState<Record<number, string>>({});
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [arrows, setArrows] = useState<PointerArrow[]>([]);
  const [pendingFrom, setPendingFrom] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Row-center positions (relative to the wrap) for the arrow overlay.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const rowEls = useRef(new Map<number, HTMLTableRowElement>());
  const [layout, setLayout] = useState<{ ys: Map<number, number>; x0: number }>({
    ys: new Map(),
    x0: 0,
  });

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const table = tableRef.current;
      if (!wrap || !table) return;
      const wr = wrap.getBoundingClientRect();
      const ys = new Map<number, number>();
      for (const [addr, el] of rowEls.current) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        ys.set(addr, r.top - wr.top + r.height / 2);
      }
      const x0 = table.getBoundingClientRect().right - wr.left;
      setLayout((prev) => {
        if (
          prev.x0 === x0 &&
          prev.ys.size === ys.size &&
          [...ys].every(([k, v]) => prev.ys.get(k) === v)
        ) {
          return prev;
        }
        return { ys, x0 };
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  const allRows = groups.flatMap((g) => g.rows);
  const expectedKeys = useMemo(() => new Set(expected.map(arrowKey)), [expected]);

  const grades = useMemo(() => {
    if (!checked) return null;
    const valueGrades = new Map<number, Grade>();
    const labelGrades = new Map<number, Grade>();
    let right = 0;
    let total = 0;
    for (const r of allRows) {
      total++;
      const ok = gradeValue(values[r.cell.address] ?? "", r.cell, functionAddrs);
      valueGrades.set(r.cell.address, ok ? "ok" : "bad");
      if (ok) right++;
      if (r.firstOfBlock && r.blockName && isGradableLabel(r.blockName)) {
        total++;
        const lok = gradeLabel(labels[r.cell.address] ?? "", r.blockName);
        labelGrades.set(r.cell.address, lok ? "ok" : "bad");
        if (lok) right++;
      }
    }
    // Arrows: each expected arrow must be drawn; extras are wrong.
    const drawnKeys = new Set(arrows.map(arrowKey));
    let arrowsRight = 0;
    for (const k of expectedKeys) if (drawnKeys.has(k)) arrowsRight++;
    const extras = arrows.filter((a) => !expectedKeys.has(arrowKey(a))).length;
    total += expected.length;
    right += arrowsRight;
    return { valueGrades, labelGrades, right, total, arrowsRight, extras };
  }, [checked, values, labels, arrows, allRows, functionAddrs, expected, expectedKeys]);

  const reveal = () => {
    const v: Record<number, string> = {};
    const l: Record<number, string> = {};
    for (const r of allRows) {
      v[r.cell.address] = formatValue(r.cell, functionAddrs);
      if (r.firstOfBlock && r.blockName && isGradableLabel(r.blockName)) {
        l[r.cell.address] = r.blockName;
      }
    }
    setValues(v);
    setLabels(l);
    setArrows(expected);
    setPendingFrom(null);
    setRevealed(true);
    setChecked(false);
  };

  const reset = () => {
    setValues({});
    setLabels({});
    setArrows([]);
    setPendingFrom(null);
    setChecked(false);
    setRevealed(false);
  };

  const clickArrowHandle = (addr: number) => {
    setChecked(false);
    if (pendingFrom === null) {
      setPendingFrom(addr);
    } else if (pendingFrom === addr) {
      setPendingFrom(null); // cancel
    } else {
      const a: PointerArrow = { from: pendingFrom, to: addr };
      setArrows((prev) =>
        prev.some((x) => arrowKey(x) === arrowKey(a)) ? prev : [...prev, a]
      );
      setPendingFrom(null);
    }
  };

  const removeArrow = (key: string) => {
    setArrows((prev) => prev.filter((a) => arrowKey(a) !== key));
    setChecked(false);
  };

  // Route drawn arrows into channels (same greedy scheme as the diagram).
  const routed = useMemo(() => {
    const spans = arrows
      .map((a) => {
        const fromY = layout.ys.get(a.from);
        const toY = layout.ys.get(a.to);
        if (fromY === undefined || toY === undefined) return null;
        return { a, fromY, toY, top: Math.min(fromY, toY), bot: Math.max(fromY, toY) };
      })
      .filter(Boolean) as { a: PointerArrow; fromY: number; toY: number; top: number; bot: number }[];
    spans.sort((p, q) => p.bot - p.top - (q.bot - q.top));
    const channels: { top: number; bot: number }[][] = [];
    const out = spans.map((s) => {
      let ch = 0;
      while (channels[ch]?.some((o) => !(s.bot < o.top - 8 || s.top > o.bot + 8))) ch++;
      (channels[ch] ||= []).push({ top: s.top, bot: s.bot });
      return { ...s, ch };
    });
    return { out, channelCount: channels.length };
  }, [arrows, layout]);

  const overlayWidth = 20 + routed.channelCount * 14 + 10;

  return (
    <div className="exam">
      <div className="exam-toolbar">
        <span className="exam-hint">
          {pendingFrom !== null ? (
            <>
              Drawing arrow from <code>{hex(pendingFrom)}</code> — click ◉ on the
              target row (or the same ◉ to cancel).
            </>
          ) : (
            <>
              Fill in each Value (and Label where a variable starts). Write
              uninitialized memory as <code>???</code>. Draw pointer arrows by
              clicking ◉ on the pointer row, then ◉ on its target.
            </>
          )}
        </span>
        <div className="exam-actions">
          <button className="btn primary" onClick={() => setChecked(true)}>
            Check
          </button>
          <button className="btn" onClick={reveal}>
            Reveal
          </button>
          <button className="btn" onClick={reset}>
            Reset
          </button>
          {grades && (
            <span
              className={
                grades.right === grades.total && grades.extras === 0
                  ? "exam-score exam-score-perfect"
                  : "exam-score"
              }
            >
              {grades.right}/{grades.total}
              {grades.extras > 0 && ` · ${grades.extras} extra arrow${grades.extras > 1 ? "s" : ""}`}
              {grades.right === grades.total && grades.extras === 0 ? " 🎉" : ""}
            </span>
          )}
        </div>
        {arrows.length > 0 && (
          <div className="exam-arrow-chips">
            {arrows.map((a) => {
              const key = arrowKey(a);
              const wrong = checked && !expectedKeys.has(key);
              return (
                <span key={key} className={`exam-arrow-chip ${wrong ? "exam-chip-bad" : ""}`}>
                  {hex(a.from)} → {hex(a.to)}
                  <button className="exam-chip-x" onClick={() => removeArrow(key)}>
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="exam-wrap" ref={wrapRef}>
        <table className="exam-table" ref={tableRef}>
          <thead>
            <tr>
              <th>Section</th>
              <th>Address</th>
              <th>Value</th>
              <th>Label</th>
              <th className="exam-arrow-th">◉</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => {
              const heading = [
                g.sectionLabel,
                g.frameLabel && `frame: ${g.frameLabel}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <FragmentGroup
                  key={gi}
                  heading={heading}
                  rows={g.rows}
                  values={values}
                  labels={labels}
                  setValue={(a, s) => {
                    setValues((p) => ({ ...p, [a]: s }));
                    setChecked(false);
                  }}
                  setLabel={(a, s) => {
                    setLabels((p) => ({ ...p, [a]: s }));
                    setChecked(false);
                  }}
                  grades={grades}
                  revealed={revealed}
                  pendingFrom={pendingFrom}
                  onArrowHandle={clickArrowHandle}
                  registerRow={(addr, el) => {
                    if (el) rowEls.current.set(addr, el);
                    else rowEls.current.delete(addr);
                  }}
                />
              );
            })}
          </tbody>
        </table>

        {/* Drawn-arrow overlay, to the right of the table */}
        <svg
          className="exam-arrow-overlay"
          style={{ left: layout.x0, width: overlayWidth }}
          height={wrapRef.current?.scrollHeight ?? 0}
        >
          <defs>
            <marker
              id="exam-arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
            </marker>
          </defs>
          {routed.out.map(({ a, fromY, toY, ch }) => {
            const key = arrowKey(a);
            const cx = 16 + ch * 14;
            const wrong = checked && !expectedKeys.has(key);
            return (
              <path
                key={key}
                d={`M 2 ${fromY} H ${cx} V ${toY} H 6`}
                className={`exam-arrow-line ${wrong ? "exam-arrow-wrong" : ""}`}
                fill="none"
                markerEnd="url(#exam-arrowhead)"
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function FragmentGroup({
  heading,
  rows,
  values,
  labels,
  setValue,
  setLabel,
  grades,
  revealed,
  pendingFrom,
  onArrowHandle,
  registerRow,
}: {
  heading: string;
  rows: ReturnType<typeof buildGroups>["groups"][number]["rows"];
  values: Record<number, string>;
  labels: Record<number, string>;
  setValue: (addr: number, s: string) => void;
  setLabel: (addr: number, s: string) => void;
  grades: {
    valueGrades: Map<number, Grade>;
    labelGrades: Map<number, Grade>;
  } | null;
  revealed: boolean;
  pendingFrom: number | null;
  onArrowHandle: (addr: number) => void;
  registerRow: (addr: number, el: HTMLTableRowElement | null) => void;
}) {
  return (
    <>
      {heading && (
        <tr className="exam-group-row">
          <td colSpan={5}>{heading}</td>
        </tr>
      )}
      {rows.map((r) => {
        const addr = r.cell.address;
        const vGrade = grades?.valueGrades.get(addr);
        const lGrade = grades?.labelGrades.get(addr);
        const showLabelInput =
          r.firstOfBlock && r.blockName && isGradableLabel(r.blockName);
        return (
          <tr key={addr} ref={(el) => registerRow(addr, el)}>
            <td />
            <td className="exam-addr">{hex(addr)}</td>
            <td>
              <input
                className={`exam-input ${vGrade ? `exam-${vGrade}` : ""} ${
                  revealed ? "exam-revealed" : ""
                }`}
                value={values[addr] ?? ""}
                onChange={(e) => setValue(addr, e.target.value)}
                spellCheck={false}
              />
            </td>
            <td>
              {showLabelInput ? (
                <input
                  className={`exam-input exam-input-label ${
                    lGrade ? `exam-${lGrade}` : ""
                  } ${revealed ? "exam-revealed" : ""}`}
                  value={labels[addr] ?? ""}
                  onChange={(e) => setLabel(addr, e.target.value)}
                  spellCheck={false}
                />
              ) : r.firstOfBlock && r.blockName ? (
                <span className="exam-fixed-label">{r.blockName}</span>
              ) : null}
            </td>
            <td className="exam-arrow-td">
              <button
                className={`exam-arrow-handle ${
                  pendingFrom === addr ? "exam-arrow-armed" : ""
                }`}
                title={
                  pendingFrom === null
                    ? "Start drawing an arrow from this row"
                    : pendingFrom === addr
                    ? "Cancel"
                    : "Point the arrow at this row"
                }
                onClick={() => onArrowHandle(addr)}
              >
                ◉
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}
