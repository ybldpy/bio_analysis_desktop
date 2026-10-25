export type MetricRecord = Record<string, unknown>

export interface MetricPart {
  key: string
  label: string
  color: string
  value: number | null
  fraction: number | null
}

export interface MetricDistribution {
  parts: MetricPart[]
  state: 'ready' | 'empty' | 'missing' | 'inconsistent'
}

/** Display-only validation: absent or malformed metrics must never become zero. */
export function metricNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function metricFraction(value: unknown): number | null {
  const number = metricNumber(value)
  return number !== null && number <= 1 ? number : null
}

export function metricLabel(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : '未提供'
}

export function metricRecords(value: unknown): MetricRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is MetricRecord =>
      item !== null && typeof item === 'object' && !Array.isArray(item)
  )
}

/** Compare a reported value with an explicit display scale; do not infer missing totals. */
export function metricRatio(value: unknown, total: unknown): number | null {
  const number = metricNumber(value)
  const denominator = metricNumber(total)
  if (number === null || denominator === null || number > denominator) return null
  if (denominator === 0) return number === 0 ? 0 : null
  return number / denominator
}

export function metricBarWidth(fraction: unknown): string {
  const number = metricFraction(fraction)
  return number === null ? '0%' : `${number * 100}%`
}

export function metricMaximum(values: unknown[]): number | null {
  const numbers = values.map(metricNumber).filter((value): value is number => value !== null)
  return numbers.length ? numbers.reduce((maximum, value) => Math.max(maximum, value), 0) : null
}

/** Proportions are only for presentation of supplied counts, not biological analysis. */
export function metricDistribution(
  metrics: MetricRecord,
  totalKey: string,
  definitions: { key: string; label: string; color: string }[]
): MetricDistribution {
  const total = metricNumber(metrics[totalKey])
  const parts = definitions.map((definition) => ({
    ...definition,
    value: metricNumber(metrics[definition.key]),
    fraction: metricRatio(metrics[definition.key], total)
  }))
  if (total === null || parts.some((part) => part.value === null)) {
    return { parts, state: 'missing' }
  }
  const sum = parts.reduce((value, part) => value + (part.value as number), 0)
  if (!Number.isFinite(sum) || sum !== total) return { parts, state: 'inconsistent' }
  return { parts, state: total === 0 ? 'empty' : 'ready' }
}

export function metricMaskDistribution(metrics: MetricRecord): MetricDistribution {
  const parts = [
    { key: 'unmaskedBases', fractionKey: 'unmaskedFraction', label: '未遮罩', color: '#4b8bbe' },
    { key: 'maskedBases', fractionKey: 'maskedFraction', label: '低深度遮罩', color: '#d6a04a' }
  ].map(({ fractionKey, ...definition }) => ({
    ...definition,
    value: metricNumber(metrics[definition.key]),
    fraction: metricFraction(metrics[fractionKey])
  }))
  if (parts.some((part) => part.fraction === null)) return { parts, state: 'missing' }
  const sum = parts.reduce((total, part) => total + (part.fraction as number), 0)
  if (sum === 0 && metricNumber(metrics.totalBases) === 0) return { parts, state: 'empty' }
  // Allow rounding in reported fractions; never normalize a partial set into a full result.
  if (Math.abs(sum - 1) > 0.00001) return { parts, state: 'inconsistent' }
  return { parts, state: 'ready' }
}
