const DEBUG = true // import.meta.env.DEV

export function debugWarn(...args: unknown[]): void {
  if (DEBUG) {
    console.warn(...args)
  }
}

export function debugError(...args: unknown[]): void {
  if (DEBUG) {
    console.error(...args)
  }
}
