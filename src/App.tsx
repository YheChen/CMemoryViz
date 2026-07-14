import { useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "./components/CodeEditor";
import { MemoryDiagram } from "./components/MemoryDiagram";
import { ExamDiagram } from "./components/ExamDiagram";
import { HeapReportPanel } from "./components/HeapReportPanel";
import { ChallengePicker } from "./components/ChallengePicker";
import type { Challenge } from "./challenges";
import { Controls } from "./components/Controls";
import { run, RunResult } from "./interpreter/interpreter";
import { diffSnapshots } from "./components/diagramModel";
import { buildShareUrl, decodeShareState } from "./share";

const SAMPLES: Record<string, string> = {
  "sumpairs (midterm)": `int *sumpairs(int *a, int size) {

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
}
`,
  "structs & linked list": `struct node {
    int val;
    struct node *next;
};

int main() {
    struct node *head = malloc(sizeof(struct node));
    head->val = 1;
    head->next = malloc(sizeof(struct node));
    head->next->val = 2;
    head->next->next = NULL;

    int sum = 0;
    struct node *cur = head;
    while (cur != NULL) {
        sum += cur->val;
        cur = cur->next;
    }
    printf("sum = %d\\n", sum);

    free(head->next);
    free(head);
    return 0;
}
`,
  "strings": `int main() {
    char stack_str[] = "hi";
    char *ro_str = "hello";

    stack_str[0] = 'H';
    printf("%s %s\\n", stack_str, ro_str);
    return 0;
}
`,
  "function pointers": `int add(int a, int b) { return a + b; }
int mul(int a, int b) { return a * b; }

int apply(int (*op)(int, int), int x, int y) {
    return op(x, y);
}

int main() {
    int (*fp)(int, int) = add;
    int s = apply(fp, 3, 4);
    int p = apply(mul, 3, 4);
    printf("%d %d\\n", s, p);
    return 0;
}
`,
  "2D array & globals": `int calls = 0;
double ratio = 0.5;

int rowsum(int row[2]) {
    calls++;
    return row[0] + row[1];
}

int main() {
    int m[2][2] = {{1, 2}, {3, 4}};
    int top = rowsum(m[0]);
    int bot = rowsum(m[1]);
    printf("%d %d (%d calls)\\n", top, bot, calls);
    return 0;
}
`,
  "dangling pointer (bug!)": `int main() {
    int *p = malloc(2 * sizeof(int));
    p[0] = 10;
    p[1] = 20;

    free(p);

    // p still holds the old address: a dangling pointer.
    // Step to here and look at the diagram; one more step reads it.
    int x = p[0];
    return 0;
}
`,
  "2D dynamic array (int **)": `int main() {
    int rows = 2, cols = 3;

    // An array of row pointers, each pointing at its own heap row.
    int **grid = malloc(rows * sizeof(int *));
    for (int i = 0; i < rows; i++) {
        grid[i] = malloc(cols * sizeof(int));
        for (int j = 0; j < cols; j++) {
            grid[i][j] = i * cols + j;
        }
    }

    // Free the rows, then the array of pointers.
    for (int i = 0; i < rows; i++) {
        free(grid[i]);
    }
    free(grid);
    return 0;
}
`,
  "realloc (block moves)": `int main() {
    int *a = malloc(2 * sizeof(int));
    a[0] = 1;
    a[1] = 2;

    // Grow the block: realloc copies the old values into a new, larger
    // block and frees the old one, so 'a' now points somewhere new.
    a = realloc(a, 4 * sizeof(int));
    a[2] = 3;
    a[3] = 4;

    free(a);
    return 0;
}
`,
};

const DEFAULT_SAMPLE = "sumpairs (midterm)";

export default function App() {
  const [source, setSource] = useState(SAMPLES[DEFAULT_SAMPLE]);
  const [examMode, setExamMode] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);

  const steps = result?.steps ?? [];

  // Restore a shared link: #<base64url state> -> load, run, land on the step.
  useEffect(() => {
    const shared = decodeShareState(location.hash);
    if (!shared) return;
    setSource(shared.src);
    setBreakpoints(new Set(shared.bps ?? []));
    setExamMode(!!shared.exam);
    const r = run(shared.src);
    setResult(r);
    if (r.steps.length > 0) {
      const target = shared.step ?? r.steps.length - 1;
      setStepIndex(Math.max(0, Math.min(r.steps.length - 1, target)));
    }
  }, []);

  const doShare = async () => {
    const url = buildShareUrl({
      v: 1,
      src: source,
      step: stepIndex >= 0 ? stepIndex : undefined,
      bps: breakpoints.size ? [...breakpoints] : undefined,
      exam: examMode || undefined,
    });
    history.replaceState(null, "", url); // reflect it in the address bar too
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the URL is in the address bar to copy manually.
    }
  };

  const doRun = () => {
    const r = run(source);
    setResult(r);
    if (r.steps.length === 0) {
      setStepIndex(-1);
      return;
    }
    // Stop at the first breakpoint if any is hit; otherwise show final state.
    const bpIdx = breakpoints.size
      ? r.steps.findIndex((s) => breakpoints.has(s.line))
      : -1;
    setStepIndex(bpIdx >= 0 ? bpIdx : r.steps.length - 1);
  };

  const doContinue = () => {
    for (let i = stepIndex + 1; i < steps.length; i++) {
      if (breakpoints.has(steps[i].line)) {
        setStepIndex(i);
        return;
      }
    }
    setStepIndex(steps.length - 1);
  };

  const toggleBreakpoint = (line: number) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };

  const current = stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null;
  const snapshot = current?.snapshot ?? null;

  // Cells changed by the previous statement (what "just happened").
  const changedAddrs = useMemo(() => {
    if (!snapshot) return undefined;
    const prev = stepIndex > 0 ? steps[stepIndex - 1].snapshot : null;
    return diffSnapshots(prev, snapshot);
  }, [snapshot, stepIndex, steps]);

  const seek = (i: number) => {
    if (steps.length === 0) return;
    setStepIndex(Math.max(0, Math.min(steps.length - 1, i)));
  };

  const error = result?.error ?? null;
  const highlightLine = current?.line ?? error?.line ?? null;

  const output = useMemo(() => {
    if (!result) return "";
    return current ? current.output : result.output;
  }, [result, current]);

  const onSourceChange = (v: string) => {
    setSource(v);
    // Old trace no longer matches the code.
    setResult(null);
    setStepIndex(-1);
  };

  const loadSample = (name: string) => {
    onSourceChange(SAMPLES[name]);
    setBreakpoints(new Set());
  };

  // Load a practice problem: run it, pause at the target line, enter exam mode.
  const loadChallenge = (c: Challenge) => {
    setSource(c.source);
    setBreakpoints(new Set());
    const r = run(c.source);
    setResult(r);
    setExamMode(true);
    let idx = r.steps.findIndex(
      (s) => s.line === c.targetLine && (!c.targetNote || s.note === c.targetNote)
    );
    if (idx < 0) idx = r.steps.length - 1;
    setStepIndex(Math.max(0, idx));
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◧</span> CMemoryViz
          <span className="tagline">C memory model visualizer · CSC 209 style</span>
        </div>
        <div className="topbar-right">
          <button
            className="btn"
            onClick={doShare}
            title="Copy a link that reproduces this exact code, step and breakpoints"
          >
            {copied ? "✓ Copied!" : "🔗 Share"}
          </button>
          <ChallengePicker onPick={loadChallenge} />
          <select
            className="sample-select"
            defaultValue={DEFAULT_SAMPLE}
            onChange={(e) => loadSample(e.target.value)}
            title="Load an example program"
          >
            {Object.keys(SAMPLES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <label className="toggle">
            <input
              type="checkbox"
              checked={examMode}
              onChange={(e) => setExamMode(e.target.checked)}
            />
            Exam mode
          </label>
        </div>
      </header>

      <Controls
        onRun={doRun}
        onContinue={doContinue}
        hasBreakpoints={breakpoints.size > 0}
        stepIndex={stepIndex}
        stepCount={steps.length}
        onSeek={seek}
        currentLine={current?.line ?? null}
        note={current?.note}
      />

      <div className="panes">
        <div className="pane pane-editor">
          <CodeEditor
            value={source}
            onChange={onSourceChange}
            highlightLine={highlightLine}
            breakpoints={breakpoints}
            onToggleBreakpoint={toggleBreakpoint}
            error={error}
          />
        </div>
        <div className="pane pane-diagram">
          {error && (
            <div className="error-banner">
              ⚠ {error.message}
              {error.line ? ` (line ${error.line})` : ""}
            </div>
          )}
          {examMode && snapshot ? (
            <ExamDiagram
              key={stepIndex}
              snapshot={snapshot}
              functionAddrs={result?.functionAddrs}
            />
          ) : (
            <MemoryDiagram
              snapshot={snapshot}
              functionAddrs={result?.functionAddrs}
              changedAddrs={changedAddrs}
            />
          )}
          {output && (
            <div className="stdout">
              <div className="stdout-label">stdout</div>
              <pre>{output}</pre>
            </div>
          )}
          {result && (
            <HeapReportPanel
              report={result.heap}
              currentStep={current ? stepIndex : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
