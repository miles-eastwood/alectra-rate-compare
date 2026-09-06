import { buildRateTableFromApiEntries, type RateTable } from './pricing'
import type { UsageRecord } from '../types/usage'

export type AlectraAuth = {
  token: string
  accountNumber: string
  meterNumber: string
}

// Thrown when the Alectra API rejects the stored bearer token (expired or revoked).
export class AlectraAuthExpiredError extends Error {
  constructor() {
    super('Your Alectra session has expired. Please revisit the Alectra usage page to refresh your credentials.')
    this.name = 'AlectraAuthExpiredError'
  }
}

export type AlectraRequestParams = {
  accountNumber: string
  meterNumber: string
  from: string
  to: string
  periodicity?: 'HH' | 'DD' | 'MM'
  uom?: 'kWh' | 'kW'
}

const ALECTRA_API_URL = 'https://alectra-svc.smartcmobile.link/UsageAPI/api/V1/Electric'

function addOneDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const nextDate = new Date(year, month - 1, day + 1)

  return [nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
}

export async function fetchAlectraUsage(auth: AlectraAuth, params: AlectraRequestParams): Promise<UsageRecord[]> {
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    uid: '1',
    pt: '1',
    Origin: 'https://myalectra.alectrautilities.com',
    Accept: 'application/json, text/plain, */*',
  }

  const queryParams = new URLSearchParams({
    AccountNumber: params.accountNumber,
    MeterNumber: params.meterNumber,
    From: params.from,
    To: addOneDay(params.to),
    Uom: params.uom ?? 'kWh',
    Periodicity: params.periodicity ?? 'HH',
  })

  const response = await fetch(`${ALECTRA_API_URL}?${queryParams}`, {
    method: 'GET',
    headers,
    mode: 'cors',
    credentials: 'include',
  })

  if (response.status === 401 || response.status === 403) {
    throw new AlectraAuthExpiredError()
  }

  if (!response.ok) {
    throw new Error(`Alectra API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  const records = data?.Result?.electricUsages ?? data?.electricUsages ?? []

  const mapped = records
    .filter(Boolean)
    .map((record: any) => ({
      readDate: record.readDate,
      consumption: Number(record.consumption ?? 0),
      ratePlan: record.ratePlan,
    }))
    .filter((record: UsageRecord) => {
      const recordDate = record.readDate?.slice(0, 10)
      return !!recordDate && recordDate >= params.from && recordDate <= params.to
    })

  return mapped
}

const RATE_PLAN_API_URL = 'https://alectra-svc.smartcmobile.link/apiservices/api/1/RatePlan/CurrentPlanRate'

// Fetches live tiered/TOU rates from Alectra's RatePlan API and converts them
// into a RateTable. Returns null on any failure (network error, non-2xx
// response, unexpected payload shape, etc.) so callers can fall back to the
// hardcoded default rates instead of failing the whole comparison.
export async function fetchAlectraRatePlan(auth: AlectraAuth): Promise<RateTable | null> {
  try {
    const response = await fetch(RATE_PLAN_API_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        uid: '1',
        pt: '1',
        Accept: 'application/json, text/plain, */*',
      },
      mode: 'cors',
      credentials: 'include',
    })

    if (!response.ok) {
      return null
    }

    const payload = await response.json()
    return buildRateTableFromApiEntries(payload?.data)
  } catch {
    return null
  }
}
