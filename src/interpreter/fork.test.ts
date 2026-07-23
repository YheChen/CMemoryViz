import { describe, it, expect } from "vitest";
import { run } from "./interpreter";

function ok(src: string) {
  const r = run(src);
  for (const p of r.processes) expect(p.error, p.error?.message).toBeUndefined();
  return r;
}

describe("fork()", () => {
  it("one fork produces a parent and a child", () => {
    const r = ok(`int main() {
      int pid = fork();
      if (pid == 0) printf("child");
      else printf("parent");
      return 0;
    }`);
    expect(r.processes.length).toBe(2);
    const [root, child] = r.processes;
    expect(root.pid).toBe(1);
    expect(root.parentPid).toBe(0);
    expect(root.output).toBe("parent");
    expect(child.pid).toBe(2);
    expect(child.parentPid).toBe(1);
    expect(child.bornAtLine).toBe(2);
    expect(child.output).toBe("child");
  });

  it("child sees fork() == 0, parent sees > 0", () => {
    const r = ok(`int main() {
      int pid = fork();
      printf("%d", pid > 0);
      return 0;
    }`);
    expect(r.processes[0].output).toBe("1"); // parent: pid > 0
    expect(r.processes[1].output).toBe("0"); // child: pid == 0
  });

  it("two sequential forks make four processes", () => {
    const r = ok(`int main() {
      fork();
      fork();
      return 0;
    }`);
    expect(r.processes.length).toBe(4);
  });

  it("a loop of forks doubles each iteration (2^3 = 8)", () => {
    const r = ok(`int main() {
      for (int i = 0; i < 3; i++) fork();
      return 0;
    }`);
    expect(r.processes.length).toBe(8);
  });

  it("getpid / getppid reflect the process tree", () => {
    const r = ok(`int main() {
      if (fork() == 0) printf("%d", getppid());
      return 0;
    }`);
    // child's parent is the root (pid 1)
    expect(r.processes[1].output).toBe("1");
  });

  it("wait() reports the child then -1", () => {
    const r = ok(`int main() {
      if (fork() > 0) {
        int got = wait(0);
        int again = wait(0);
        printf("%d %d", got > 0, again);
      }
      return 0;
    }`);
    expect(r.processes[0].output).toBe("1 -1");
  });
});

describe("file descriptors", () => {
  function lastFds(src: string) {
    const r = ok(src);
    const steps = r.processes[0].steps;
    return steps[steps.length - 1].fdTable;
  }

  it("starts with stdin/stdout/stderr", () => {
    const fds = lastFds(`int main() { int x = 0; return 0; }`);
    expect(fds).toEqual([
      { fd: 0, target: "stdin" },
      { fd: 1, target: "stdout" },
      { fd: 2, target: "stderr" },
    ]);
  });

  it("open allocates the lowest free fd; dup2 redirects", () => {
    const fds = lastFds(`int main() {
      int fd = open("data.txt");
      close(1);
      dup2(fd, 1);
      return 0;
    }`);
    const map = Object.fromEntries(fds.map((e) => [e.fd, e.target]));
    expect(map[3]).toBe("file:data.txt");
    expect(map[1]).toBe("file:data.txt"); // stdout redirected to the file
  });

  it("pipe writes the two fds into the array and opens both ends", () => {
    const r = ok(`int main() {
      int p[2];
      pipe(p);
      printf("%d %d", p[0], p[1]);
      return 0;
    }`);
    expect(r.processes[0].output).toBe("3 4");
    const steps = r.processes[0].steps;
    const fds = steps[steps.length - 1].fdTable;
    const map = Object.fromEntries(fds.map((e) => [e.fd, e.target]));
    expect(map[3]).toBe("pipe read");
    expect(map[4]).toBe("pipe write");
  });

  it("children inherit the parent's fd table", () => {
    const r = ok(`int main() {
      int fd = open("shared.txt");
      fork();
      return 0;
    }`);
    // both processes have the opened fd (child rebuilds it deterministically)
    for (const p of r.processes) {
      const last = p.steps[p.steps.length - 1].fdTable;
      expect(last.some((e) => e.target === "file:shared.txt")).toBe(true);
    }
  });
});
