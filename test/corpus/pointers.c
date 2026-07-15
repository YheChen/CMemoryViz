#include <stdio.h>
void swap(int *a, int *b) { int t = *a; *a = *b; *b = t; }
int main() {
    int x = 3, y = 9;
    swap(&x, &y);
    int *p = &x;
    *p = *p + 100;
    printf("%d %d\n", x, y);
    return 0;
}
