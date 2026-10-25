import { asRecord } from '../../common/pipelineResults'

export type ResultRecord = Record<string, unknown>

export function displayText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return '未提供'
}

export function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function recordList(value: unknown): ResultRecord[] {
  if (!Array.isArray(value)) return []
  return value.map(asRecord).filter((item): item is ResultRecord => item !== null)
}

export function displayCode(
  value: unknown,
  labels: Record<string, string>,
  unknownLabel = '未知'
): string {
  const raw = displayText(value)
  if (raw === '未提供') return raw
  return Object.prototype.hasOwnProperty.call(labels, String(value))
    ? labels[String(value)]
    : `${unknownLabel}（${raw}）`
}

// Unknown ordinals retain their reported order; names such as 1/10/2 are not sort keys.
export function sortBySegment(
  rows: ResultRecord[],
  knownOrdinals: Map<string, number> = new Map()
): ResultRecord[] {
  return rows
    .map((row, index) => ({
      row,
      index,
      ordinal:
        finiteNumber(row.segmentOrdinal) ??
        (hasText(row.segmentKey) ? knownOrdinals.get(row.segmentKey) : undefined)
    }))
    .sort((a, b) => {
      if (a.ordinal == null && b.ordinal == null) return a.index - b.index
      if (a.ordinal == null) return 1
      if (b.ordinal == null) return -1
      return a.ordinal - b.ordinal || a.index - b.index
    })
    .map(({ row }) => row)
}

export function configurationText(value: unknown): string {
  if (value == null) return '未提供'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}
