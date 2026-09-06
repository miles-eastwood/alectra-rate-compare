export type UsageRecord = {
  readDate: string
  consumption: number | string
  ratePlan?: string
  accountNumber?: string
  meterNumber?: string
}

export type UsagePayload = {
  Result?: {
    electricUsages?: UsageRecord[]
  }
  electricUsages?: UsageRecord[]
}
