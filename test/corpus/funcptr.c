#include <stdio.h>
int add(int a, int b) { return a + b; }
int mul(int a, int b) { return a * b; }
int apply(int (*f)(int, int), int a, int b) { return f(a, b); }
int main() {
    int (*op)(int, int) = add;
    printf("%d ", apply(op, 3, 4));
    op = mul;
    printf("%d\n", apply(op, 3, 4));
    return 0;
}
