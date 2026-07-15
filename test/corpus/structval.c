#include <stdio.h>
struct P { int x; int y; };
struct P make(int a, int b) {
    struct P p;
    p.x = a;
    p.y = b;
    return p;
}
int sum(struct P p) {
    return p.x + p.y;
}
int main() {
    struct P q = make(7, 8);
    struct P r = q;
    q.x = 99;
    printf("%d %d %d\n", r.x, r.y, sum(q));
    return 0;
}
