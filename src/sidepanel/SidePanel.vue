<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { debugError } from '../lib/debug'
import { buildPlanComparison, DEFAULT_RATE_TABLE, type RateTable, type UsageRecord } from '../lib/pricing'

const usageRecords = ref<UsageRecord[]>([])
const rateTable = ref<RateTable>(DEFAULT_RATE_TABLE)
const usingLiveRates = ref(false)
const loading = ref(false)
const error = ref('')
const noResults = ref(false)
const lastUpdated = ref<{ from: string; to: string; at: string } | null>(null)
const authCaptured = ref(false)
const requestingAuth = ref(false)
const connectionErrorMessage = 'Connection failed. Make sure you are logged into your Alectra account and have navigated to the usage page.'
const ALECTRA_USAGE_URL = 'https://myalectra.alectrautilities.com/portal/#/Usages'

const fromDate = ref(getDefaultFromDate())
const toDate = ref(getDefaultToDate())

function getDefaultFromDate() {
  const today = new Date()
  const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())
  return monthAgo.toISOString().split('T')[0]
}

function getDefaultToDate() {
  const today = new Date()
  return today.toISOString().split('T')[0]
}

const comparison = computed(() => {
  if (!usageRecords.value.length) {
    return null
  }
  return buildPlanComparison(usageRecords.value, rateTable.value)
})

const totalUsage = computed(() => comparison.value?.totalUsage ?? 0)
const tieredCost = computed(() => comparison.value?.tiered.totalCost ?? 0)
const touCost = computed(() => comparison.value?.tou.totalCost ?? 0)
const isTieredCheaper = computed(() => tieredCost.value <= touCost.value)
const savingsAmount = computed(() => Math.abs(touCost.value - tieredCost.value))
const touBreakdown = computed(() => Object.entries(comparison.value?.touCostByBucket ?? {}))
const tierBreakdown = computed(() => Object.entries(comparison.value?.tierCostByTier ?? {})
  .filter(([, breakdown]) => breakdown.kwh > 0))

const monthlyBreakdown = computed(() => {
  if (!comparison.value) return []
  const keys = [...new Set([
    ...Object.keys(comparison.value.tiered.monthlyCosts),
    ...Object.keys(comparison.value.tou.monthlyCosts),
  ])].sort()
  return keys.map((key) => ({
    month: key,
    kwh: comparison.value!.monthlyUsage[key]?.kwh ?? 0,
    days: comparison.value!.monthlyUsage[key]?.days ?? 0,
    tiered: comparison.value!.tiered.monthlyCosts[key] ?? 0,
    tou: comparison.value!.tou.monthlyCosts[key] ?? 0,
    diff: (comparison.value!.tou.monthlyCosts[key] ?? 0) - (comparison.value!.tiered.monthlyCosts[key] ?? 0),
  }))
})

onMounted(() => {
  checkAuth()

  chrome.storage.local.get(['alectraUsageData', 'alectraRateTable'], (result) => {
    const saved = result.alectraUsageData as UsageRecord[] | undefined
    if (saved && saved.length) {
      usageRecords.value = saved
    }

    const savedRates = result.alectraRateTable as RateTable | undefined
    if (savedRates) {
      rateTable.value = savedRates
      usingLiveRates.value = true
    }
  })

  const checkInterval = window.setInterval(checkAuth, 2000)

  onUnmounted(() => clearInterval(checkInterval))
})

const checkAuth = () => {
  chrome.storage.local.get(['alectraAuth'], (result) => {
    authCaptured.value = !!result.alectraAuth
  })
}

// Finds the open Alectra tab (or opens a new one) and forces a fresh
// navigation to the usage page, which is what reliably re-triggers auth
// capture. A plain in-page reload isn't enough if the tab isn't already on
// the usage route, so this navigates there directly and bypasses the cache.
const requestAuth = async () => {
  error.value = ''
  requestingAuth.value = true
  try {
    const tabs = await chrome.tabs.query({ url: 'https://myalectra.alectrautilities.com/*' })
    const existingTab = tabs.find((tab) => tab.id !== undefined)

    if (existingTab?.id !== undefined) {
      const alreadyOnUsagePage = existingTab.url?.includes('/Usages')

      if (alreadyOnUsagePage) {
        await chrome.tabs.reload(existingTab.id, { bypassCache: true })
      } else {
        await chrome.tabs.update(existingTab.id, { url: ALECTRA_USAGE_URL })
      }

      await chrome.tabs.update(existingTab.id, { active: true })
      if (existingTab.windowId !== undefined) {
        await chrome.windows.update(existingTab.windowId, { focused: true })
      }
    } else {
      await chrome.tabs.create({ url: ALECTRA_USAGE_URL })
    }
  } catch (err) {
    debugError('SidePanel: Failed to trigger auth capture', err)
  } finally {
    requestingAuth.value = false
  }
}

const fetchData = async () => {
  loading.value = true
  error.value = ''
  noResults.value = false
  usageRecords.value = []

  try {
    const response = await new Promise<{
      success: boolean
      records?: UsageRecord[]
      rates?: RateTable | null
      error?: string
    }>(
      (resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'FETCH_ALECTRA_USAGE',
            from: fromDate.value,
            to: toDate.value,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              debugError('SidePanel: Runtime error', chrome.runtime.lastError)
              resolve({ success: false, error: connectionErrorMessage })
            } else {
              resolve(response)
            }
          }
        )
      }
    )

    if (response.success && response.records?.length) {
      usageRecords.value = response.records
      if (response.rates) {
        rateTable.value = response.rates
        usingLiveRates.value = true
        chrome.storage.local.set({ alectraUsageData: usageRecords.value, alectraRateTable: response.rates })
      } else {
        rateTable.value = DEFAULT_RATE_TABLE
        usingLiveRates.value = false
        chrome.storage.local.set({ alectraUsageData: usageRecords.value })
        chrome.storage.local.remove('alectraRateTable')
      }
      lastUpdated.value = {
        from: fromDate.value,
        to: toDate.value,
        at: new Date().toLocaleString(),
      }
    } else if (response.success) {
      noResults.value = true
      chrome.storage.local.remove('alectraUsageData')
    } else {
      error.value = response.error || connectionErrorMessage
      debugError('SidePanel: Fetch failed', { error: response.error || 'Failed to fetch usage data' })
    }
  } catch (err) {
    error.value = connectionErrorMessage
    debugError('SidePanel: Caught error', err)
  } finally {
    loading.value = false
  }
}

const clearData = () => {
  usageRecords.value = []
  noResults.value = false
  lastUpdated.value = null
  rateTable.value = DEFAULT_RATE_TABLE
  usingLiveRates.value = false
  chrome.storage.local.remove(['alectraUsageData', 'alectraRateTable'])
}

const enforceDateRange = () => {
  if (toDate.value < fromDate.value) {
    toDate.value = fromDate.value
  }
}

const formatCurrency = (value: number) => `$${value.toFixed(2)}`
</script>

<template>
  <main>
    <div class="controls">
      <div class="date-inputs">
        <div class="input-group">
          <label>From</label>
          <input v-model="fromDate" type="date" :disabled="loading" @change="enforceDateRange" />
        </div>
        <div class="input-group">
          <label>To</label>
          <input v-model="toDate" type="date" :min="fromDate" :disabled="loading" @change="enforceDateRange" />
        </div>
      </div>

      <button @click="fetchData" :disabled="loading || !authCaptured" class="fetch-btn"
        title="Fetch usage data from Alectra">
        {{ loading ? 'Loading...' : 'Fetch & Compare' }}
      </button>
    </div>

    <div v-if="!authCaptured" class="status-warning">
      <p>⏳ Waiting for auth...</p>
      <p class="hint">Make sure you're logged into <a href="https://myalectra.alectrautilities.com"
          target="_blank">Alectra website</a> and visit the usage page.</p>
      <p class="hint">The extension will automatically capture your credentials.</p>
      <button @click="requestAuth" :disabled="requestingAuth" class="auth-btn">
        {{ requestingAuth ? 'Opening…' : 'Get Authorization' }}
      </button>
    </div>

    <div v-if="authCaptured && !comparison && !loading && !error && !noResults" class="status-success">
      <p>✅ Authorization granted. Select a date range to compare rates.</p>
    </div>

    <div v-if="error && authCaptured" class="error-message">{{ error }}</div>

    <div v-if="noResults" class="empty-message">No usage data found for this date range.</div>

    <div v-if="comparison" class="results">
      <p v-if="lastUpdated" class="last-updated">
        Showing {{ lastUpdated.from }} through {{ lastUpdated.to }}. Updated {{ lastUpdated.at }}.
        {{ usingLiveRates ? 'Using live rates from Alectra.' : 'Using default rates (live rates unavailable).' }}
      </p>
      <div class="summary">
        <div class="stat total-usage">
          <span class="label">Total Usage</span>
          <strong>{{ totalUsage.toFixed(2) }} kWh</strong>
        </div>
        <div class="stat">
          <span class="label">Tiered Cost</span>
          <strong>{{ formatCurrency(tieredCost) }}</strong>
        </div>
        <div class="stat">
          <span class="label">TOU Cost</span>
          <strong>{{ formatCurrency(touCost) }}</strong>
        </div>
        <div class="stat highlight savings">
          <span class="label">{{ isTieredCheaper ? 'Tiered Saves' : 'TOU Saves' }}</span>
          <strong>{{ formatCurrency(savingsAmount) }}</strong>
        </div>
      </div>

      <div class="cost-breakdowns">
        <div class="cost-breakdown">
          <h4>TOU Cost Breakdown</h4>
          <div v-for="[bucket, breakdown] in touBreakdown" :key="bucket" class="breakdown-row">
            <span>{{ bucket }}</span>
            <span>{{ breakdown.kwh.toFixed(2) }} kWh · {{ formatCurrency(breakdown.cost) }}</span>
          </div>
        </div>

        <div class="cost-breakdown">
          <h4>Tiered Cost Breakdown</h4>
          <div v-for="[tier, breakdown] in tierBreakdown" :key="tier" class="breakdown-row">
            <span>{{ tier === 'tier1' ? 'Tier 1' : 'Tier 2' }}</span>
            <span>{{ breakdown.kwh.toFixed(2) }} kWh · {{ formatCurrency(breakdown.cost) }}</span>
          </div>
        </div>
      </div>

      <div v-if="monthlyBreakdown.length" class="monthly-table">
        <h4>Monthly Breakdown</h4>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Days</th>
                <th>kWh</th>
                <th>Tiered</th>
                <th>TOU</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in monthlyBreakdown" :key="row.month">
                <td>{{ row.month }}</td>
                <td>{{ row.days }}</td>
                <td>{{ row.kwh.toFixed(2) }}</td>
                <td>{{ formatCurrency(row.tiered) }}</td>
                <td>{{ formatCurrency(row.tou) }}</td>
                <td :class="{ positive: row.diff > 0, negative: row.diff < 0 }">{{ row.diff > 0 ? '+' : '' }}{{
                  formatCurrency(row.diff) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <button @click="clearData" class="clear-btn">Clear Data</button>
    </div>
  </main>
</template>

<style scoped>
:root {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #f5f7fb;
  background: #121826;
}

body {
  margin: 0;
  background: #121826;
}

main {
  padding: 1rem;
  color: #f5f7fb;
  background: #121826;
  min-height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

h4 {
  margin: 1rem 0 0.5rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: #b6c2d9;
}

.controls {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.date-inputs {
  display: flex;
  gap: 0.5rem;
  flex: 1;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.input-group label {
  font-size: 0.75rem;
  color: #b6c2d9;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}

input[type='date'] {
  padding: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.375rem;
  background: rgba(255, 255, 255, 0.03);
  color: #f5f7fb;
  font-size: 0.875rem;
}

input[type='date']:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fetch-btn,
.clear-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  color: white;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.875rem;
  transition: opacity 0.2s;
}

.fetch-btn {
  background: linear-gradient(135deg, #42b983 0%, #359970 100%);
  align-self: flex-end;
}

.fetch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fetch-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.clear-btn {
  background: rgba(255, 255, 255, 0.1);
  width: 100%;
  margin-top: 1rem;
}

.clear-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.status-warning {
  padding: 1rem;
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 0.375rem;
  color: #ffc107;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.status-warning p {
  margin: 0.25rem 0;
}

.status-warning .hint {
  color: #b6c2d9;
  margin-top: 0.5rem;
  font-size: 0.8rem;
}

.status-warning a {
  color: #42b983;
  text-decoration: none;
}

.status-warning a:hover {
  text-decoration: underline;
}

.auth-btn {
  margin-top: 0.75rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  background: linear-gradient(135deg, #42b983 0%, #359970 100%);
  color: white;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.875rem;
  transition: opacity 0.2s;
}

.auth-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.auth-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.status-success {
  padding: 1rem;
  background: rgba(66, 185, 131, 0.1);
  border: 1px solid rgba(66, 185, 131, 0.3);
  border-radius: 0.375rem;
  color: #42b983;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.status-success p {
  margin: 0;
}

.error-message {
  padding: 1rem;
  background: rgba(244, 67, 54, 0.1);
  border: 1px solid rgba(244, 67, 54, 0.3);
  border-radius: 0.375rem;
  color: #ff6b6b;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.empty-message {
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.375rem;
  color: #b6c2d9;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.results {
  animation: fadeIn 0.3s ease-in;
}

.last-updated {
  margin: 0 0 0.75rem;
  color: #b6c2d9;
  font-size: 0.75rem;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.stat {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 0.375rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.total-usage,
.savings {
  grid-column: 1 / -1;
}

.stat.highlight {
  background: rgba(66, 185, 131, 0.12);
  border: 1px solid rgba(66, 185, 131, 0.4);
}

.stat .label {
  font-size: 0.75rem;
  color: #b6c2d9;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.stat strong {
  font-size: 1.1rem;
}

.monthly-table {
  margin-top: 1rem;
}

.table-scroll {
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

.cost-breakdowns {
  display: grid;
  gap: 1rem;
  margin-top: 1.25rem;
}

.cost-breakdown {
  padding-top: 0.25rem;
}

.breakdown-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  color: #b6c2d9;
  font-size: 0.875rem;
}

.breakdown-row span:last-child {
  color: #f5f7fb;
  text-align: right;
  white-space: nowrap;
}

table {
  width: 100%;
  min-width: 36rem;
  border-collapse: collapse;
  font-size: 0.8rem;
}

table thead {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

table th {
  text-align: left;
  padding: 0.5rem;
  color: #b6c2d9;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.5px;
}

table td {
  padding: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

table td.positive {
  color: #42b983;
}

table td.negative {
  color: #ff6b6b;
}
</style>
