export type UsageRecord = {
  readDate: string
  consumption: number | string
  ratePlan?: string
}

export type MonthlyCosts = Record<string, number>
export type MonthlyUsage = Record<string, { kwh: number; days: number }>
export type UsageCostBreakdown = { kwh: number; cost: number }

export type TouBucket = 'Off-Peak' | 'Mid-Peak' | 'On-Peak'


// Hardcoded rates to fallback to if the API does not return the true rates
export const SUMMER_TIER_THRESHOLD = 600
export const WINTER_TIER_THRESHOLD = 1000

export const TIER1_RATE = 0.12
export const TIER2_RATE = 0.142

export const OFF_PEAK_RATE = 0.098
export const MID_PEAK_RATE = 0.157
export const ON_PEAK_RATE = 0.203

export function monthlyThreshold(year: number, month: number): number {
  return 5 <= month && month <= 10 ? SUMMER_TIER_THRESHOLD : WINTER_TIER_THRESHOLD
}

// Per-month usage rates. All calculation functions accept an optional rate table
// so live rates fetched from Alectra's RatePlan API can be used in place of the
// hardcoded defaults below (see buildRateTableFromApiEntries)
export type MonthlyRate = {
  tier1: number
  tier2: number
  offPeak: number
  midPeak: number
  onPeak: number
}

export type RateTable = Record<number, MonthlyRate>

export const DEFAULT_RATE_TABLE: RateTable = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [
    i + 1,
    {
      tier1: TIER1_RATE,
      tier2: TIER2_RATE,
      offPeak: OFF_PEAK_RATE,
      midPeak: MID_PEAK_RATE,
      onPeak: ON_PEAK_RATE,
    },
  ])
)

function getMonthlyRate(rates: RateTable, month: number): MonthlyRate {
  return rates[month] ?? DEFAULT_RATE_TABLE[month]
}

// Shape of an entry from Alectra's RatePlan/CurrentPlanRate API. Only the fields
// used to build a RateTable are declared; the API also returns rateEffectiveDate,
// rateEndDate, and a ULO (Ultra-Low Overnight) plan that we intentionally ignore.
export type RatePlanApiEntry = {
  ratePlanName?: unknown
  startMonth?: unknown
  endMonth?: unknown
  usageRate?: unknown
  touName?: unknown
}

// Converts raw RatePlan API entries into a RateTable, keeping only the RPP
// (tiered) and TOU plans. Returns null if the input is malformed or doesn't
// contain both plan types, so callers can safely fall back to hardcoded rates.
export function buildRateTableFromApiEntries(entries: unknown): RateTable | null {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null
  }

  const table: RateTable = {}
  for (let month = 1; month <= 12; month++) {
    table[month] = { ...DEFAULT_RATE_TABLE[month] }
  }

  let sawTier = false
  let sawTou = false

  for (const raw of entries as RatePlanApiEntry[]) {
    const planName = raw?.ratePlanName
    const start = Number(raw?.startMonth)
    const end = Number(raw?.endMonth)
    const rate = Number(raw?.usageRate)
    const touName = raw?.touName

    if (planName !== 'RPP' && planName !== 'TOU') continue // TODO: implement ULO rate plan
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(rate)) continue

    for (let month = start; month <= end; month++) {
      if (month < 1 || month > 12) continue
      const monthlyRate = table[month]

      if (planName === 'RPP') {
        if (touName === 'Tier 1') {
          monthlyRate.tier1 = rate
          sawTier = true
        } else if (touName === 'Tier 2') {
          monthlyRate.tier2 = rate
          sawTier = true
        }
      } else if (planName === 'TOU') {
        if (touName === 'Off-Peak') {
          monthlyRate.offPeak = rate
          sawTou = true
        } else if (touName === 'Mid-Peak') {
          monthlyRate.midPeak = rate
          sawTou = true
        } else if (touName === 'On-Peak') {
          monthlyRate.onPeak = rate
          sawTou = true
        }
      }
    }
  }

  // Require both plan types so we never end up with a half-populated table
  if (!sawTier || !sawTou) {
    return null
  }

  return table
}

export function parseUsageDate(dtStr: string): Date {
  const match = dtStr.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/
  )
  const value = match
    ? new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] ?? 0),
      Number((match[7] ?? '').slice(0, 3).padEnd(3, '0')),
    )
    : new Date(dtStr)

  if (Number.isNaN(value.getTime())) {
    throw new Error(`Invalid usage date: ${dtStr}`)
  }

  return value
}

function isSummerTou(month: number): boolean {
  // Summer TOU hours run May 1 - October 31 (month is 1-indexed)
  return 5 <= month && month <= 10
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

// Returns the nth occurrence of a weekday in a given month.
// month is 1-indexed (1 = January), weekday is 0 = Sunday ... 6 = Saturday, n is 1-indexed.
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const firstOfMonth = new Date(year, month - 1, 1)
  const offset = (weekday - firstOfMonth.getDay() + 7) % 7
  const day = 1 + offset + (n - 1) * 7
  return new Date(year, month - 1, day)
}

// Returns the most recent date with the given weekday strictly before `date`.
function precedingWeekday(date: Date, weekday: number): Date {
  let result = addDays(date, -1)
  while (result.getDay() !== weekday) {
    result = addDays(result, -1)
  }
  return result
}

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for the date of Easter Sunday.
function calculateEasterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1

  return new Date(year, month - 1, day)
}

// Walks forward from `startDate` to the next weekday (Mon-Fri) that is not already
// claimed by another observed holiday in `occupied`.
function nextAvailableWeekday(startDate: Date, occupied: Set<string>): Date {
  let candidate = startDate
  while (isWeekend(candidate) || occupied.has(dateKey(candidate))) {
    candidate = addDays(candidate, 1)
  }
  return candidate
}

const holidayCache = new Map<number, Set<string>>()

// Ontario statutory holidays observed by Alectra, at which TOU pricing applies the
// off-peak rate all day (same treatment as weekends). See:
// https://www.oeb.ca/consumer-information-and-protection/electricity-rates/holiday-schedule-time-use-and-ultra-low
function computeHolidays(year: number): Set<string> {
  const occupied = new Set<string>()
  const observed: Date[] = []

  // Fixed-date holidays shift to the next available weekday when they fall on a
  // weekend. Boxing Day is processed after Christmas Day so that if both land on
  // a weekend, Boxing Day shifts past whatever day Christmas Day claims.
  const fixedHolidays = [
    new Date(year, 0, 1), // New Year's Day
    new Date(year, 6, 1), // Canada Day
    new Date(year, 11, 25), // Christmas Day
    new Date(year, 11, 26), // Boxing Day
  ]

  for (const date of fixedHolidays) {
    const observedDate = isWeekend(date) ? nextAvailableWeekday(addDays(date, 1), occupied) : date
    occupied.add(dateKey(observedDate))
    observed.push(observedDate)
  }

  // These holidays are always weekdays by definition, so no shifting is needed.
  observed.push(nthWeekdayOfMonth(year, 2, 1, 3)) // Family Day: 3rd Monday of February
  observed.push(precedingWeekday(new Date(year, 4, 25), 1)) // Victoria Day: Monday preceding May 25
  observed.push(nthWeekdayOfMonth(year, 8, 1, 1)) // Civic Holiday: 1st Monday of August
  observed.push(nthWeekdayOfMonth(year, 9, 1, 1)) // Labour Day: 1st Monday of September
  observed.push(nthWeekdayOfMonth(year, 10, 1, 2)) // Thanksgiving Day: 2nd Monday of October
  observed.push(addDays(calculateEasterSunday(year), -2)) // Good Friday: Friday before Easter Sunday

  return new Set(observed.map(dateKey))
}

function getHolidaySet(year: number): Set<string> {
  let holidays = holidayCache.get(year)
  if (!holidays) {
    holidays = computeHolidays(year)
    holidayCache.set(year, holidays)
  }
  return holidays
}

export function isStatutoryHoliday(dt: Date): boolean {
  return getHolidaySet(dt.getFullYear()).has(dateKey(dt))
}

export function touRate(dt: Date, rates: RateTable = DEFAULT_RATE_TABLE): { rate: number; bucket: TouBucket } {
  const weekday = dt.getDay()
  const hour = dt.getHours()
  const month = dt.getMonth() + 1
  const monthlyRate = getMonthlyRate(rates, month)

  if (weekday === 0 || weekday === 6 || isStatutoryHoliday(dt)) {
    return { rate: monthlyRate.offPeak, bucket: 'Off-Peak' }
  }

  const summer = isSummerTou(month)
  const morningEveningBucket: TouBucket = summer ? 'Mid-Peak' : 'On-Peak'
  const middayBucket: TouBucket = summer ? 'On-Peak' : 'Mid-Peak'
  const morningEveningRate = summer ? monthlyRate.midPeak : monthlyRate.onPeak
  const middayRate = summer ? monthlyRate.onPeak : monthlyRate.midPeak

  if ((7 <= hour && hour < 11) || (17 <= hour && hour < 19)) {
    return { rate: morningEveningRate, bucket: morningEveningBucket }
  }

  if (11 <= hour && hour < 17) {
    return { rate: middayRate, bucket: middayBucket }
  }

  return { rate: monthlyRate.offPeak, bucket: 'Off-Peak' }
}

export function calculateTou(
  usageRecords: UsageRecord[],
  rates: RateTable = DEFAULT_RATE_TABLE
): { totalCost: number; monthlyCosts: MonthlyCosts } {
  let totalCost = 0
  const monthlyCosts: MonthlyCosts = {}

  for (const record of usageRecords) {
    const dt = parseUsageDate(record.readDate)
    const consumption = Number(record.consumption) || 0
    const { rate } = touRate(dt, rates)
    const cost = consumption * rate

    totalCost += cost

    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    monthlyCosts[key] = (monthlyCosts[key] ?? 0) + cost
  }

  return { totalCost, monthlyCosts }
}

export function calculateTiered(
  usageRecords: UsageRecord[],
  rates: RateTable = DEFAULT_RATE_TABLE
): { totalCost: number; monthlyCosts: MonthlyCosts } {
  const monthlyKwh: Record<string, number> = {}

  for (const record of usageRecords) {
    const dt = parseUsageDate(record.readDate)
    const consumption = Number(record.consumption) || 0
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    monthlyKwh[key] = (monthlyKwh[key] ?? 0) + consumption
  }

  const monthlyCosts: MonthlyCosts = {}
  let totalCost = 0

  for (const [key, kwh] of Object.entries(monthlyKwh).sort()) {
    const [yearString, monthString] = key.split('-')
    const year = Number(yearString)
    const month = Number(monthString)
    const threshold = monthlyThreshold(year, month)
    const monthlyRate = getMonthlyRate(rates, month)

    const tier1Usage = Math.min(kwh, threshold)
    const tier2Usage = Math.max(0, kwh - threshold)
    const cost = tier1Usage * monthlyRate.tier1 + tier2Usage * monthlyRate.tier2

    monthlyCosts[key] = cost
    totalCost += cost
  }

  return { totalCost, monthlyCosts }
}

export function calculateTouUsageByBucket(
  usageRecords: UsageRecord[],
  rates: RateTable = DEFAULT_RATE_TABLE
): Record<TouBucket, number> {
  const totals: Record<TouBucket, number> = {
    'Off-Peak': 0,
    'Mid-Peak': 0,
    'On-Peak': 0,
  }

  for (const record of usageRecords) {
    const dt = parseUsageDate(record.readDate)
    const consumption = Number(record.consumption) || 0
    const { bucket } = touRate(dt, rates)
    totals[bucket] += consumption
  }

  return totals
}

export function calculateTouCostByBucket(
  usageRecords: UsageRecord[],
  rates: RateTable = DEFAULT_RATE_TABLE
): Record<TouBucket, UsageCostBreakdown> {
  const totals: Record<TouBucket, UsageCostBreakdown> = {
    'Off-Peak': { kwh: 0, cost: 0 },
    'Mid-Peak': { kwh: 0, cost: 0 },
    'On-Peak': { kwh: 0, cost: 0 },
  }

  for (const record of usageRecords) {
    const dt = parseUsageDate(record.readDate)
    const consumption = Number(record.consumption) || 0
    const { rate, bucket } = touRate(dt, rates)
    totals[bucket].kwh += consumption
    totals[bucket].cost += consumption * rate
  }

  return totals
}

export function calculateTierCostByTier(
  usageRecords: UsageRecord[],
  rates: RateTable = DEFAULT_RATE_TABLE
): {
  tier1: UsageCostBreakdown
  tier2: UsageCostBreakdown
} {
  const monthlyKwh: Record<string, number> = {}

  for (const record of usageRecords) {
    const dt = parseUsageDate(record.readDate)
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    monthlyKwh[key] = (monthlyKwh[key] ?? 0) + (Number(record.consumption) || 0)
  }

  const breakdown = {
    tier1: { kwh: 0, cost: 0 },
    tier2: { kwh: 0, cost: 0 },
  }

  for (const [key, kwh] of Object.entries(monthlyKwh)) {
    const [year, month] = key.split('-').map(Number)
    const monthlyRate = getMonthlyRate(rates, month)
    const tier1Kwh = Math.min(kwh, monthlyThreshold(year, month))
    const tier2Kwh = Math.max(0, kwh - tier1Kwh)
    breakdown.tier1.kwh += tier1Kwh
    breakdown.tier1.cost += tier1Kwh * monthlyRate.tier1
    breakdown.tier2.kwh += tier2Kwh
    breakdown.tier2.cost += tier2Kwh * monthlyRate.tier2
  }

  return breakdown
}

export function calculateMonthlyUsage(usageRecords: UsageRecord[]): MonthlyUsage {
  const monthlyUsage: MonthlyUsage = {}

  for (const record of usageRecords) {
    const dt = parseUsageDate(record.readDate)
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    const entry = monthlyUsage[key] ?? { kwh: 0, days: 0 }

    entry.kwh += Number(record.consumption) || 0
    monthlyUsage[key] = entry
  }

  const daysByMonth: Record<string, Set<string>> = {}
  for (const record of usageRecords) {
    const dt = parseUsageDate(record.readDate)
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
      ; (daysByMonth[key] ??= new Set()).add(`${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`)
  }

  for (const [key, days] of Object.entries(daysByMonth)) {
    monthlyUsage[key].days = days.size
  }

  return monthlyUsage
}

export function buildPlanComparison(usageRecords: UsageRecord[], rates: RateTable = DEFAULT_RATE_TABLE) {
  const tiered = calculateTiered(usageRecords, rates)
  const tou = calculateTou(usageRecords, rates)
  const monthlyUsage = calculateMonthlyUsage(usageRecords)
  const touCostByBucket = calculateTouCostByBucket(usageRecords, rates)
  const tierCostByTier = calculateTierCostByTier(usageRecords, rates)

  return {
    tiered,
    tou,
    monthlyUsage,
    touCostByBucket,
    tierCostByTier,
    totalUsage: usageRecords.reduce((sum, record) => sum + (Number(record.consumption) || 0), 0),
    touUsageByBucket: calculateTouUsageByBucket(usageRecords),
    difference: tou.totalCost - tiered.totalCost,
  }
}
