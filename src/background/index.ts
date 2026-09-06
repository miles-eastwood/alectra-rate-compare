import { AlectraAuthExpiredError, fetchAlectraRatePlan, fetchAlectraUsage, type AlectraAuth } from '../lib/api'
import { debugError } from '../lib/debug'

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ALECTRA_AUTH_CAPTURED') {
    const auth = request.auth
    chrome.storage.local.set({ alectraAuth: auth }, () => {
      sendResponse({ success: true })
    })
    return true
  }

  if (request.type === 'FETCH_ALECTRA_USAGE') {
    handleFetchUsage(request.from, request.to)
      .then(({ records, rates }) => {
        sendResponse({ success: true, records, rates })
      })
      .catch(async (error) => {
        debugError('Background: Fetch failed:', error)
        if (error instanceof AlectraAuthExpiredError) {
          await chrome.storage.local.remove('alectraAuth')
        }
        sendResponse({ success: false, error: error.message })
      })

    return true
  }
})

async function handleFetchUsage(from: string, to: string) {
  const result = await chrome.storage.local.get(['alectraAuth'])
  const auth = result.alectraAuth as AlectraAuth | undefined

  if (!auth || !auth.token || !auth.accountNumber || !auth.meterNumber) {
    throw new Error('Auth not captured. Please visit the Alectra website first to capture your credentials.')
  }
  const records = await fetchAlectraUsage(auth, {
    accountNumber: auth.accountNumber,
    meterNumber: auth.meterNumber,
    from,
    to,
    periodicity: 'HH',
  })

  // Best-effort: use live rates from Alectra when available, otherwise the
  // caller falls back to the hardcoded defaults. This must never fail the
  // usage fetch itself, so failures are swallowed inside fetchAlectraRatePlan.
  const rates = await fetchAlectraRatePlan(auth)

  return { records, rates }
}
