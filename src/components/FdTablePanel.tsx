// The current process's file-descriptor table at the viewed step. Hidden when
// only the three standard streams are open (nothing interesting to show).

import type { FdEntry } from "../interpreter/interpreter";

const STANDARD = ["stdin", "stdout", "stderr"];

function isDefault(fds: FdEntry[]): boolean {
  return fds.length === 3 && fds.every((e, i) => e.fd === i && e.target === STANDARD[i]);
}

export function FdTablePanel({ fds }: { fds: FdEntry[] }) {
  if (isDefault(fds)) return null;

  return (
    <div className="fdtable">
      <div className="fdtable-label">file descriptors</div>
      <table>
        <thead>
          <tr>
            <th>fd</th>
            <th>points to</th>
          </tr>
        </thead>
        <tbody>
          {fds.map((e) => (
            <tr key={e.fd}>
              <td className="fd-num">{e.fd}</td>
              <td className={"fd-target fd-" + e.target.split(/[: ]/)[0]}>{e.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
