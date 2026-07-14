// Curated, exam-style practice problems. Each opens in exam mode paused at a
// target line, so the student fills in the memory diagram and checks it —
// exactly the CSC 209 midterm task.

export interface Challenge {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  // What the student is asked to reproduce.
  prompt: string;
  source: string;
  // Pause exactly before this 1-based source line executes.
  targetLine: number;
  // If several statements share the line, prefer the step with this note
  // (e.g. "return" for a return statement).
  targetNote?: string;
}

export const CHALLENGES: Challenge[] = [
  {
    id: "sumpairs",
    title: "sumpairs (past midterm)",
    difficulty: "medium",
    prompt:
      "Fill in the memory diagram showing the state exactly before the return on line 8. Label and separate the stack frames, and draw the pointer arrows.",
    targetLine: 8,
    targetNote: "return",
    source: `int *sumpairs(int *a, int size) {

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
  },
  {
    id: "swap",
    title: "swap by pointer",
    difficulty: "easy",
    prompt:
      "swap() is running. Fill in the diagram showing the state exactly before line 4 (the last assignment) executes. Draw the arrows a and b.",
    targetLine: 4,
    source: `void swap(int *a, int *b) {
    int tmp = *a;
    *a = *b;
    *b = tmp;
}

int main() {
    int x = 7;
    int y = 42;
    swap(&x, &y);
    return 0;
}
`,
  },
  {
    id: "linked-list",
    title: "build a linked list",
    difficulty: "medium",
    prompt:
      "Two nodes have been allocated and linked. Fill in the diagram showing the state exactly before the return on line 15, including the next pointers.",
    targetLine: 15,
    targetNote: "return",
    source: `struct node {
    int val;
    struct node *next;
};

int main() {
    struct node *head = malloc(sizeof(struct node));
    head->val = 1;

    struct node *second = malloc(sizeof(struct node));
    second->val = 2;
    second->next = NULL;

    head->next = second;
    return 0;
}
`,
  },
  {
    id: "string-reverse",
    title: "reverse a string in place",
    difficulty: "hard",
    prompt:
      "The reversal loop is partway done. Fill in the diagram showing the state exactly before line 6 executes on the FIRST iteration (i=0, j=4).",
    targetLine: 6,
    source: `int main() {
    char s[] = "abcde";
    int i = 0;
    int j = 4;
    while (i < j) {
        char t = s[i];
        s[i] = s[j];
        s[j] = t;
        i++;
        j--;
    }
    return 0;
}
`,
  },
  {
    id: "grid-2d",
    title: "2D dynamic array",
    difficulty: "hard",
    prompt:
      "A 2x3 grid of ints has been built with an array of row pointers. Fill in the diagram showing the state exactly before line 10 (the start of the free loop), with all arrows.",
    targetLine: 10,
    source: `int main() {
    int **grid = malloc(2 * sizeof(int *));
    for (int i = 0; i < 2; i++) {
        grid[i] = malloc(3 * sizeof(int));
        for (int j = 0; j < 3; j++) {
            grid[i][j] = i * 3 + j;
        }
    }

    for (int i = 0; i < 2; i++) {
        free(grid[i]);
    }
    free(grid);
    return 0;
}
`,
  },
];
