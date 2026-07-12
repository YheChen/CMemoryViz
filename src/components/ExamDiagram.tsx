// Exam mode: the same memory table, but Value and Label columns are blank
// inputs for the student to fill in — exactly like the midterm. "Check"
// grades leniently (hex case, NULL vs 0, ??? spellings, quoted chars);
// "Reveal" fills in the answers.

import { useMemo, useState } from "react";
import type { MemorySnapshot, Cell } from "../interpreter/memory";
import { buildGroups, formatValue, hex, isPointer } from "./diagramModel";

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

export function ExamDiagram({ snapshot, functionAddrs }: Props) {
  const { groups } = useMemo(() => buildGroups(snapshot), [snapshot]);

  const [values, setValues] = useState<Record<number, string>>({});
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const allRows = groups.flatMap((g) => g.rows);

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
    return { valueGrades, labelGrades, right, total };
  }, [checked, values, labels, allRows, functionAddrs]);

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
    setRevealed(true);
    setChecked(false);
  };

  const reset = () => {
    setValues({});
    setLabels({});
    setChecked(false);
    setRevealed(false);
  };

  return (
    <div className="exam">
      <div className="exam-toolbar">
        <span className="exam-hint">
          Fill in each Value (and Label where the row starts a variable). Write
          uninitialized memory as <code>???</code>.
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
                grades.right === grades.total ? "exam-score exam-score-perfect" : "exam-score"
              }
            >
              {grades.right}/{grades.total}
              {grades.right === grades.total ? " 🎉" : ""}
            </span>
          )}
        </div>
      </div>

      <table className="exam-table">
        <thead>
          <tr>
            <th>Section</th>
            <th>Address</th>
            <th>Value</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => (
            <ExamGroup
              key={gi}
              group={g}
              values={values}
              labels={labels}
              setValue={(a, s) => setValues((p) => ({ ...p, [a]: s }))}
              setLabel={(a, s) => setLabels((p) => ({ ...p, [a]: s }))}
              grades={grades}
              revealed={revealed}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExamGroup({
  group,
  values,
  labels,
  setValue,
  setLabel,
  grades,
  revealed,
}: {
  group: ReturnType<typeof buildGroups>["groups"][number];
  values: Record<number, string>;
  labels: Record<number, string>;
  setValue: (addr: number, s: string) => void;
  setLabel: (addr: number, s: string) => void;
  grades: {
    valueGrades: Map<number, Grade>;
    labelGrades: Map<number, Grade>;
  } | null;
  revealed: boolean;
}) {
  const heading = [group.sectionLabel, group.frameLabel && `frame: ${group.frameLabel}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {heading && (
        <tr className="exam-group-row">
          <td colSpan={4}>{heading}</td>
        </tr>
      )}
      {group.rows.map((r) => {
        const addr = r.cell.address;
        const vGrade = grades?.valueGrades.get(addr);
        const lGrade = grades?.labelGrades.get(addr);
        const showLabelInput =
          r.firstOfBlock && r.blockName && isGradableLabel(r.blockName);
        return (
          <tr key={addr}>
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
          </tr>
        );
      })}
    </>
  );
}
