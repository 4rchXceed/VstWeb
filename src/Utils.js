// Source - https://stackoverflow.com/a/15270931
// Posted by Tomo Huynh
// Retrieved 2026-03-01, License - CC BY-SA 3.0

export function dirname(path, levels = 1) {
    let result = path.replace(/\\/g, '/').replace(/\/[^\/]*\/?$/, '');
    for (let i = 0; i < levels; i++) {
        result = result.replace(/\/[^\/]*\/?$/, '');
    }
    return result;
}
