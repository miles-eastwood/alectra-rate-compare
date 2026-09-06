// This script runs in the page context (MAIN world), not the content script context.
// It can intercept fetch and XHR with full access to request headers.
//
// IMPORTANT: this file must have no imports/exports. CRXJS injects
// document_start MAIN-world scripts directly only when they have no module
// dependencies; adding an import switches it to an async ESM loader that can
// run too late to patch fetch/XHR before the page's own scripts do. See
// https://crxjs.dev/concepts/content ("IIFE content scripts").
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

// Guard against multiple injections
if (window.__alectraAuthCaptureLoaded) {
  throw new Error('Script already initialized')
}
window.__alectraAuthCaptureLoaded = true

try {
  let authCaptured = false
  let pollInterval: ReturnType<typeof setInterval> | undefined

  // Store the originals before wrapping anything so we can restore them
  // once auth is captured and interception is no longer needed.
  const originalFetch = window.fetch
  const originalXhrOpen = XMLHttpRequest.prototype.open
  const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader
  const originalXhrSend = XMLHttpRequest.prototype.send

  function stopCapturing() {
    authCaptured = true
    if (pollInterval !== undefined) {
      clearInterval(pollInterval)
    }
    window.fetch = originalFetch
    XMLHttpRequest.prototype.open = originalXhrOpen
    XMLHttpRequest.prototype.setRequestHeader = originalXhrSetRequestHeader
    XMLHttpRequest.prototype.send = originalXhrSend
  }

  function postAuth(auth: { token: string; accountNumber: string; meterNumber: string }) {
    window.postMessage({ type: 'ALECTRA_AUTH', auth }, '*')
    stopCapturing()
  }

  // Try to get auth from localStorage first
  function checkStoredAuth(): boolean {
    if (authCaptured) return true

    try {
      const token = localStorage.getItem('bearerToken') || localStorage.getItem('token') || localStorage.getItem('auth_token')
      const accountNumber = localStorage.getItem('AccountNumber') || localStorage.getItem('accountNumber')
      const meterNumber = localStorage.getItem('MeterNumber') || localStorage.getItem('meterNumber')

      if (token && accountNumber && meterNumber) {
        try {
          postAuth({ token, accountNumber, meterNumber })
        } catch (e) {
          debugWarn('[Alectra Capture] Failed to post auth from localStorage:', e)
        }
        return true
      }
    } catch (e) {
      // localStorage might not be accessible
    }
    return false
  }

  // Check localStorage periodically until auth is captured, then stop polling.
  if (!checkStoredAuth()) {
    pollInterval = setInterval(() => {
      if (checkStoredAuth() && pollInterval !== undefined) {
        clearInterval(pollInterval)
      }
    }, 2000)
  }

  // Wrap fetch to intercept calls, only while auth hasn't been captured yet.
  window.fetch = function (...args: Parameters<typeof fetch>) {
    const input = args[0]
    const init = args[1]
    let url = ''

    try {
      if (typeof input === 'string') {
        url = input
      } else if (input instanceof Request) {
        url = input.url
      } else if (input instanceof URL) {
        url = input.toString()
      }
    } catch (e) {
      // Ignore errors parsing URL
    }

    // Make the actual request with originalFetch
    const responsePromise = originalFetch.apply(this, args)

    // Try to capture auth from this specific request
    if (!authCaptured && url.includes('alectra-svc.smartcmobile.link') && url.includes('Electric')) {
      responsePromise
        .then(() => {
          if (authCaptured) return
          try {
            const urlObj = new URL(url)
            const accountNumber = urlObj.searchParams.get('AccountNumber')
            const meterNumber = urlObj.searchParams.get('MeterNumber')

            // Try to get auth from request headers
            let authHeader = ''
            if (init && init.headers) {
              const headers = init.headers
              if (headers instanceof Headers) {
                authHeader = headers.get('authorization') || ''
              } else if (Array.isArray(headers)) {
                const found = headers.find(([name]) => name.toLowerCase() === 'authorization')
                authHeader = found?.[1] ?? ''
              } else if (headers && typeof headers === 'object') {
                const record = headers as Record<string, string>
                authHeader = record['authorization'] || record['Authorization'] || ''
              }
            }

            if (authHeader && accountNumber && meterNumber) {
              const token = authHeader.replace(/^Bearer\s+/i, '')
              postAuth({ token, accountNumber, meterNumber })
            }
          } catch (error) {
            debugWarn('[Alectra Capture] Error capturing auth:', error)
          }
        })
        .catch((error) => {
          debugWarn('[Alectra Capture] Fetch error:', error)
        })
    }

    return responsePromise
  }

  // Also try to intercept XMLHttpRequest, only while auth hasn't been captured yet.
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    if (!authCaptured) {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('alectra-svc.smartcmobile.link')) {
        this.__alectraUrl = urlStr
        this.__alectraMethod = method
      }
    }
    return (originalXhrOpen as any).apply(this, [method, url, ...rest])
  }

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (!authCaptured && this.__alectraUrl && name.toLowerCase() === 'authorization') {
      this.__alectraAuthHeader = value
    }
    return originalXhrSetRequestHeader.call(this, name, value)
  }

  XMLHttpRequest.prototype.send = function (body) {
    const xhr = this
    if (!authCaptured && xhr.__alectraUrl && xhr.__alectraAuthHeader) {
      try {
        const urlObj = new URL(xhr.__alectraUrl)
        const accountNumber = urlObj.searchParams.get('AccountNumber')
        const meterNumber = urlObj.searchParams.get('MeterNumber')

        if (accountNumber && meterNumber) {
          const token = xhr.__alectraAuthHeader.replace(/^Bearer\s+/i, '')
          postAuth({ token, accountNumber, meterNumber })
        }
      } catch (error) {
        debugWarn('[Alectra Capture] Error capturing XHR auth:', error)
      }
    }
    return originalXhrSend.call(this, body)
  }
} catch (e) {
  debugError('[Alectra Capture] Fatal error in auth capture:', e)
}
