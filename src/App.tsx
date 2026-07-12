import { useMemo, useState } from "react";
import { CodeEditor } from "./components/CodeEditor";
import { MemoryDiagram } from "./components/MemoryDiagram";
import { ExamDiagram } from "./components/ExamDiagram";
import { Controls } from "./components/Controls";
import { run, RunResult } from "./interpreter/interpreter";

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
};

const DEFAULT_SAMPLE = "sumpairs (midterm)";

export default function App() {
  const [source, setSource] = useState(SAMPLES[DEFAULT_SAMPLE]);
  const [examMode, setExamMode] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());

  const steps = result?.steps ?? [];

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◧</span> CMemoryViz
          <span className="tagline">C memory model visualizer · CSC 209 style</span>
        </div>
        <div className="topbar-right">
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
            <MemoryDiagram snapshot={snapshot} functionAddrs={result?.functionAddrs} />
          )}
          {output && (
            <div className="stdout">
              <div className="stdout-label">stdout</div>
              <pre>{output}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
