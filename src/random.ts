// https://github.com/bryc/code/blob/master/jshash/PRNGs.md

export function xmur3(str: string) {
    for(var i = 0, h = 1779033703 ^ str.length; i < str.length; i++)
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353),
        h = h << 13 | h >>> 19;
    return function() {
        h = Math.imul(h ^ h >>> 16, 2246822507);
        h = Math.imul(h ^ h >>> 13, 3266489909);
        return (h ^= h >>> 16) >>> 0;
    }
}

export const sfc32_max = 4294967296;

export function sfc32(a: number, b: number, c: number, d: number) {
    return function() {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; 
        var t = (a + b) | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = (c << 21 | c >>> 11);
        d = d + 1 | 0;
        t = t + d | 0;
        c = c + t | 0;
        return t >>> 0;
    }
}

// Returns a function which returns a value between [a..b] inclusive each time it is called
// using the provided random number generator.
export function randrange(a: number, b: number, rand: any) {
    if (a > b) [a, b] = [b, a];
    const range = b - a + 1;
    return () => a + (rand() % range);
}