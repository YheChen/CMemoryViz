#include <stdio.h>
struct point { int x; int y; };
int main() {
    struct point p;
    p.x = 4;
    p.y = 7;
    struct point *pp = &p;
    pp->x = pp->x + pp->y;
    printf("%d %d\n", p.x, p.y);
    return 0;
}
