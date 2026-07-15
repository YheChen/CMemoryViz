#include <stdio.h>
int main() {
    int sum = 0;
    for (int i = 1; i <= 10; i++) sum += i;
    int n = 3, fact = 1;
    while (n > 0) { fact *= n; n--; }
    printf("%d %d\n", sum, fact);
    return 0;
}
