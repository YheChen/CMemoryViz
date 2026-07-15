#include <stdio.h>
typedef struct { int x; int y; } Point;
typedef int myint;
int main() {
    Point p;
    p.x = 3;
    p.y = 4;
    myint d2 = p.x * p.x + p.y * p.y;
    printf("%d\n", d2);
    return 0;
}
