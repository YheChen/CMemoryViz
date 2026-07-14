// A dropdown of exam-style practice problems. Picking one loads the program,
// runs it, jumps to the target step, and turns on exam mode.

import { useEffect, useRef, useState } from "react";
import { CHALLENGES, Challenge } from "../challenges";

export function ChallengePicker({ onPick }: { onPick: (c: Challenge) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="challenge-picker" ref={ref}>
      <button
        className="btn"
        onClick={() => setOpen((o) => !o)}
        title="Practice: fill in the diagram for an exam-style problem"
      >
        📚 Challenges
      </button>
      {open && (
        <div className="challenge-menu">
          <div className="challenge-menu-head">Practice problems</div>
          {CHALLENGES.map((c) => (
            <button
              key={c.id}
              className="challenge-item"
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
            >
              <div className="challenge-item-top">
                <span className="challenge-title">{c.title}</span>
                <span className={`challenge-diff diff-${c.difficulty}`}>{c.difficulty}</span>
              </div>
              <div className="challenge-prompt">{c.prompt}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
