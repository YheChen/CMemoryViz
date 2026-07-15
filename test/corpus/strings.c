#include <stdio.h>
#include <string.h>
int main() {
    char s[] = "hello";
    int n = strlen(s);
    printf("%s %d %c\n", s, n, s[1]);
    return 0;
}
