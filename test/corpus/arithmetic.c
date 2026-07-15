#include <stdio.h>
int main() {
    int a = 17, b = 5;
    printf("%d %d %d %d %d\n", a + b, a - b, a * b, a / b, a % b);
    printf("%d %d\n", (a > b) && (b > 0), a < b || b == 5);
    return 0;
}
