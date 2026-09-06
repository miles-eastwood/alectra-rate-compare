// capture.ts runs as its own MAIN-world content script (see manifest.ts),
// so it is injected automatically by Chrome and does not need to be
// manually appended to the page here.
//
// IMPORTANT: this file must have no imports/exports. CRXJS only injects a
// content script directly (synchronously) when it has no module
// dependencies; adding an import switches it to an async ESM loader that
// fetches the real script via a dynamic import() before the listener below
// is attached. capture.ts (MAIN world, document_start) can post its auth
// message before that async loader finishes, so the message is missed and
// auth capture silently never completes. See https://crxjs.dev/concepts/content.
const DEBUG = import.meta.env.DEV

function debugWarn(...args: unknown[]): void {
  if (DEBUG) {
    console.warn(...args)
  }
}

function debugError(...args: unknown[]): void {
  if (DEBUG) {
    console.error(...args)
  }
}

// Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (event.source !== window) return

  if (event.data.type === 'ALECTRA_AUTH' || event.data.type === 'ALECTRA_AUTH_XHR') {
    const auth = event.data.auth
    if (auth && auth.token && auth.accountNumber && auth.meterNumber) {
      chrome.runtime.sendMessage(
        {
          type: 'ALECTRA_AUTH_CAPTURED',
          auth,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            debugError('[Alectra Extension] Error sending message to background:', chrome.runtime.lastError)
          }
        }
      )
    } else {
      debugWarn('[Alectra Extension] Auth message missing required fields', { auth })
    }
  }
})



