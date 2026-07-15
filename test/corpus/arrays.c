#include <stdio.h>
int main() {
    int a[5];
    for (int i = 0; i < 5; i++) a[i] = i * i;
    int total = 0;
    for (int i = 0; i < 5; i++) total += a[i];
    printf("%d %d %d\n", a[0], a[4], total);
    return 0;
}
