// Shows every process spawned by fork(), as an indented tree rooted at main.
// Clicking a process switches the diagram / stepper to that process's trace.

import type { ProcessResult } from "../interpreter/interpreter";

interface Props {
  processes: ProcessResult[];
  currentPid: number;
  onSelect: (pid: number) => void;
}

export function ProcessTree({ processes, currentPid, onSelect }: Props) {
  // Depth of each process = chain length up to the root, for indentation.
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const depth = (p: ProcessResult): number => {
    let d = 0;
    let cur = p;
    while (cur.parentPid !== 0 && byPid.has(cur.parentPid)) {
      cur = byPid.get(cur.parentPid)!;
      d++;
    }
    return d;
  };

  return (
    <div className="proctree" aria-label="Process tree">
      <span className="proctree-label">processes</span>
      <div className="proctree-list">
        {processes.map((p) => (
          <button
            key={p.pid}
            className={p.pid === currentPid ? "proc-chip active" : "proc-chip"}
            style={{ marginLeft: depth(p) * 16 }}
            onClick={() => onSelect(p.pid)}
            title={
              p.parentPid === 0
                ? "root process (main)"
                : `child of pid ${p.parentPid}, forked at line ${p.bornAtLine}`
            }
          >
            <span className="proc-pid">pid {p.pid}</span>
            {p.parentPid === 0 ? (
              <span className="proc-tag">main</span>
            ) : (
              <span className="proc-tag muted">↳ line {p.bornAtLine}</span>
            )}
            {p.error && <span className="proc-err">⚠</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
