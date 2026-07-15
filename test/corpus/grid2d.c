#include <stdio.h>
#include <stdlib.h>
int main() {
    int **g = malloc(2 * sizeof(int *));
    for (int i = 0; i < 2; i++) {
        g[i] = malloc(3 * sizeof(int));
        for (int j = 0; j < 3; j++) g[i][j] = i * 3 + j;
    }
    printf("%d %d %d\n", g[0][0], g[1][2], g[1][0] + g[0][2]);
    for (int i = 0; i < 2; i++) free(g[i]);
    free(g);
    return 0;
}
