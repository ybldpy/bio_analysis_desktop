export interface QcSummary {
  totalReads: number | null
  totalBases: number | null
  q20Bases: number | null
  q30Bases: number | null
  q20Fraction: number | null
  q30Fraction: number | null
  gcFraction: number | null
  readMeanLength: number | null
  read1MeanLength: number | null
  read2MeanLength: number | null
}

export interface RecognizedQcReport {
  kind: 'qc'
  tool: 'fastp' | 'fastplong'
  version: string
  before: QcSummary
  after: QcSummary
  readRetentionFraction: number | null
  baseRetentionFraction: number | null
  lengths: { key: string; label: string; before: number | null; after: number | null }[]
  filtering: { key: string; label: string; reads: number | null }[]
  warnings: string[]
}

export type QcReport = RecognizedQcReport | { kind: 'unsupported'; reason: string }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function version(value: unknown): string | null {
  return typeof value === 'string' && /^\d+(?:\.\d+)+(?:[-+][a-z\d.-]+)?$/i.test(value.trim())
    ? value.trim()
    : null
}

function valueOf(value: unknown, type: 'count' | 'length' | 'fraction'): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  if (type === 'count' && !Number.isInteger(value)) return null
  if (type === 'fraction' && value > 1) return null
  return value
}

function summary(source: Record<string, unknown>, warnings: Set<string>): QcSummary {
  const read = (key: string, type: 'count' | 'length' | 'fraction') => {
    const value = valueOf(source[key], type)
    if (value === null && source[key] !== undefined && source[key] !== null) {
      warnings.add('部分已提供的统计字段格式无效，已标为“未提供”；未将其转换为零。')
    }
    return value
  }
  return {
    totalReads: read('total_reads', 'count'),
    totalBases: read('total_bases', 'count'),
    q20Bases: read('q20_bases', 'count'),
    q30Bases: read('q30_bases', 'count'),
    q20Fraction: read('q20_rate', 'fraction'),
    q30Fraction: read('q30_rate', 'fraction'),
    gcFraction: read('gc_content', 'fraction'),
    readMeanLength: read('read_mean_length', 'length'),
    read1MeanLength: read('read1_mean_length', 'length'),
    read2MeanLength: read('read2_mean_length', 'length')
  }
}

function retention(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before === 0 || after > before) return null
  return after / before
}

/** Parse only verified report summary fields. Paths, commands and sequence details are excluded. */
export function parseQcReport(text: string): QcReport {
  if (typeof text !== 'string') throw new Error('QC 报告内容不是文本')
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('QC 报告 JSON 解析失败，请重新读取或下载原始报告核对')
  }
  const source = record(parsed)
  const rawSummary = record(source.summary)
  const fastp = version(rawSummary.fastp_version)
  const fastplong = version(rawSummary.fastplong_version)
  if (!fastp && !fastplong) {
    return {
      kind: 'unsupported',
      reason: '未识别到有效的 fastp 或 fastplong 工具版本字段。请下载原始报告查看。'
    }
  }
  if ('fastp_version' in rawSummary && 'fastplong_version' in rawSummary) {
    return {
      kind: 'unsupported',
      reason: '报告同时包含短读和长读工具版本字段，暂不推断其格式。请下载原始报告核对。'
    }
  }
  const tool = fastp ? 'fastp' : 'fastplong'
  const warnings = new Set<string>()
  const rawBefore = record(rawSummary.before_filtering)
  const rawAfter = record(rawSummary.after_filtering)
  const before = summary(rawBefore, warnings)
  const after = summary(rawAfter, warnings)
  const lengths: RecognizedQcReport['lengths'] =
    tool === 'fastplong'
      ? [
          {
            key: 'read',
            label: '平均 read 长度',
            before: before.readMeanLength,
            after: after.readMeanLength
          }
        ]
      : [
          {
            key: 'read1',
            label: 'R1 / 单端平均长度',
            before: before.read1MeanLength,
            after: after.read1MeanLength
          }
        ]
  if (tool === 'fastp' && ('read2_mean_length' in rawBefore || 'read2_mean_length' in rawAfter)) {
    lengths.push({
      key: 'read2',
      label: 'R2 平均长度',
      before: before.read2MeanLength,
      after: after.read2MeanLength
    })
  }
  const rawFiltering = record(source.filtering_result)
  const filtering = [
    ['passed_filter_reads', '通过过滤'],
    ['low_quality_reads', '低质量'],
    ['too_many_N_reads', 'N 过多'],
    ['too_short_reads', '长度过短'],
    ['too_long_reads', '长度过长']
  ]
    .filter(([key]) => key in rawFiltering)
    .map(([key, label]) => {
      const reads = valueOf(rawFiltering[key], 'count')
      if (reads === null && rawFiltering[key] !== null)
        warnings.add('部分过滤分类计数格式无效，已标为“未提供”。')
      return { key, label, reads }
    })
  for (const [label, beforeValue, afterValue] of [
    ['reads 数', before.totalReads, after.totalReads],
    ['碱基数', before.totalBases, after.totalBases]
  ] as const) {
    if (beforeValue !== null && afterValue !== null && afterValue > beforeValue) {
      warnings.add(`报告中的过滤后${label}大于过滤前，未计算对应保留比例。`)
    }
  }
  return {
    kind: 'qc',
    tool,
    version: (fastp ?? fastplong)!,
    before,
    after,
    lengths,
    filtering,
    readRetentionFraction: retention(before.totalReads, after.totalReads),
    baseRetentionFraction: retention(before.totalBases, after.totalBases),
    warnings: [...warnings]
  }
}

/** Presentation scale only; a zero count produces a zero-width bar, never NaN. */
export function qcReportBarWidth(value: number | null, maximum: number): string {
  if (
    value === null ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isFinite(maximum) ||
    maximum <= 0
  ) {
    return '0%'
  }
  return `${Math.min(1, value / maximum) * 100}%`
}
