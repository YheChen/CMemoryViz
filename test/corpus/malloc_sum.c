#include <stdio.h>
#include <stdlib.h>
int *sumpairs(int *a, int size) {
    int *r = malloc(size / 2 * sizeof(int));
    for (int i = 0; i < size / 2; i++) r[i] = a[i * 2] + a[i * 2 + 1];
    return r;
}
int main() {
    int arr[] = {1, 2, 3, 4};
    int *pairs = sumpairs(arr, 4);
    printf("%d %d\n", pairs[0], pairs[1]);
    free(pairs);
    return 0;
}
