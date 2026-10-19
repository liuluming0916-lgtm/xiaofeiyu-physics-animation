const listeners = new Set();
export function requestExport(kind) {
    for (const fn of listeners)
        fn(kind);
}
export function onExportRequest(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
