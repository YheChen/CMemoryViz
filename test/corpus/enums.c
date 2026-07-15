#include <stdio.h>
enum Color { RED, GREEN, BLUE = 5, PURPLE };
int main() {
    printf("%d %d %d %d\n", RED, GREEN, BLUE, PURPLE);
    return 0;
}
