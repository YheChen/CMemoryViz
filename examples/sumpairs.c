// Sum adjacent pairs of an array into a malloc'd block.
// Try: npm run cli -- examples/sumpairs.c --line 10 --note return -o diagram.svg
int *sumpairs(int *a, int size) {

    int *result = malloc(size / 2 * sizeof(int));

    for (int i = 0; i < size / 2; i++) {
        result[i] = a[i * 2] + a[i * 2 + 1];
    }
    return result;
}

int main() {
    int arr[] = {1, 2, 3, 4};
    int *pairs = sumpairs(arr, 4);
    free(pairs);
    return 0;
}
