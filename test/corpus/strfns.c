#include <stdio.h>
#include <string.h>
int main() {
    char s[16];
    strcpy(s, "foo");
    strcat(s, "bar");
    char t[16];
    strncpy(t, s, 3);
    t[3] = '\0';
    printf("%s %d %s\n", s, (int)strlen(s), t);
    printf("%d %d\n", strcmp("a", "a"), strcmp("b", "a") > 0);
    return 0;
}
