export interface ReferenceComparisonCounts {
  candidateCount: number
  matchedCandidateCount: number
  unmatchedCandidateCount: number
}

export interface ReferenceComparisonIndex extends ReferenceComparisonCounts {
  schemaVersion: 2
  comparisonJsonUrl: string
  comparisonTsvUrl: string
}

export interface ReferenceComparisonCandidate {
  referenceId: number | null
  referenceAccession: string
  sourceDb: string | null
  taxId: number | null
  organismName: string | null
  segment: string | null
  segmentKey: string | null
  status: 'MATCHED' | 'NO_MATCH'
  sequenceIdentity: number
  referenceCoverage: number
  alignedReferenceBases: number
  referenceBases: number
  matchingBases: number
  alignmentBlockBases: number
  alignmentCount: number
  alignmentPafUrl: string
  differenceTsvUrl: string
}

export interface ReferenceComparisonReport extends ReferenceComparisonCounts {
  schemaVersion: 2
  comparisons: ReferenceComparisonCandidate[]
}

function record(value: unknown, description: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${description}必须是 JSON 对象`)
  }
  return value as Record<string, unknown>
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function requireText(value: unknown, field: string): string {
  if (!nonemptyString(value)) throw new Error(`参考比较结果缺少有效的 ${field}`)
  // Object keys are opaque. Do not trim, decode, encode or turn them into URLs here.
  return value
}

function nullableText(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`参考比较结果的 ${field} 必须为字符串或 null`)
  }
  return value as string | null
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`参考比较结果的 ${field} 必须为非负整数`)
  }
  return value
}

function nullableId(value: unknown, field: string): number | null {
  if (value === null) return null
  const id = nonnegativeInteger(value, field)
  if (id === 0) throw new Error(`参考比较结果的 ${field} 必须为正整数或 null`)
  return id
}

function boundedNumber(value: unknown, maximum: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`参考比较结果的 ${field} 必须为 0–${maximum} 的数值`)
  }
  return value
}

function requireVersion(value: unknown): void {
  if (value !== 2) throw new Error(`暂不支持的参考比较结果版本：${String(value)}`)
}

function parseCounts(source: Record<string, unknown>): ReferenceComparisonCounts {
  const candidateCount = nonnegativeInteger(source.candidateCount, 'candidateCount')
  const matchedCandidateCount = nonnegativeInteger(source.matchedCandidateCount, 'matchedCandidateCount')
  const unmatchedCandidateCount = nonnegativeInteger(source.unmatchedCandidateCount, 'unmatchedCandidateCount')
  if (matchedCandidateCount + unmatchedCandidateCount !== candidateCount) {
    throw new Error('参考比较结果的候选总数与匹配／未匹配数不一致')
  }
  return { candidateCount, matchedCandidateCount, unmatchedCandidateCount }
}

/** Receives the parsed stage.output.urls, not a JSON string or the report file. */
export function parseReferenceComparisonIndex(raw: unknown):
  | { kind: 'v2'; index: ReferenceComparisonIndex }
  | { kind: 'legacy' }
  | { kind: 'empty' } {
  if (raw == null) return { kind: 'empty' }
  const source = record(raw, '参考比较结果索引')
  if (!('schemaVersion' in source)) {
    if (nonemptyString(source.pafPath) || nonemptyString(source.differenceTsv)) {
      return { kind: 'legacy' }
    }
    throw new Error('参考比较结果索引缺少 schemaVersion 或有效的历史文件字段')
  }
  requireVersion(source.schemaVersion)
  return {
    kind: 'v2',
    index: {
      schemaVersion: 2,
      ...parseCounts(source),
      comparisonJsonUrl: requireText(source.comparisonJsonUrl, 'comparisonJsonUrl'),
      comparisonTsvUrl: requireText(source.comparisonTsvUrl, 'comparisonTsvUrl')
    }
  }
}

function parseCandidate(raw: unknown, position: number): ReferenceComparisonCandidate {
  const source = record(raw, `第 ${position + 1} 个参考候选`)
  if (source.status !== 'MATCHED' && source.status !== 'NO_MATCH') {
    throw new Error(`第 ${position + 1} 个参考候选的 status 必须为 MATCHED 或 NO_MATCH`)
  }
  const candidate: ReferenceComparisonCandidate = {
    referenceId: nullableId(source.referenceId, 'referenceId'),
    referenceAccession: requireText(source.referenceAccession, 'referenceAccession'),
    sourceDb: nullableText(source.sourceDb, 'sourceDb'),
    taxId: nullableId(source.taxId, 'taxId'),
    organismName: nullableText(source.organismName, 'organismName'),
    segment: nullableText(source.segment, 'segment'),
    segmentKey: nullableText(source.segmentKey, 'segmentKey'),
    status: source.status,
    sequenceIdentity: boundedNumber(source.sequenceIdentity, 100, 'sequenceIdentity'),
    referenceCoverage: boundedNumber(source.referenceCoverage, 1, 'referenceCoverage'),
    alignedReferenceBases: nonnegativeInteger(source.alignedReferenceBases, 'alignedReferenceBases'),
    referenceBases: nonnegativeInteger(source.referenceBases, 'referenceBases'),
    matchingBases: nonnegativeInteger(source.matchingBases, 'matchingBases'),
    alignmentBlockBases: nonnegativeInteger(source.alignmentBlockBases, 'alignmentBlockBases'),
    alignmentCount: nonnegativeInteger(source.alignmentCount, 'alignmentCount'),
    alignmentPafUrl: requireText(source.alignmentPafUrl, 'alignmentPafUrl'),
    differenceTsvUrl: requireText(source.differenceTsvUrl, 'differenceTsvUrl')
  }
  if (candidate.alignedReferenceBases > candidate.referenceBases) {
    throw new Error(`第 ${position + 1} 个参考候选的对齐参考位置数超过参考总长度`)
  }
  if (candidate.matchingBases > candidate.alignmentBlockBases) {
    throw new Error(`第 ${position + 1} 个参考候选的匹配碱基数超过比对块长度`)
  }
  if (candidate.status === 'NO_MATCH' && [candidate.sequenceIdentity, candidate.referenceCoverage,
    candidate.alignedReferenceBases, candidate.matchingBases, candidate.alignmentBlockBases,
    candidate.alignmentCount].some(value => value !== 0)) {
    throw new Error(`第 ${position + 1} 个参考候选的 NO_MATCH 状态与对齐指标不一致`)
  }
  if (candidate.status === 'MATCHED' && (candidate.alignmentCount === 0 || candidate.alignmentBlockBases === 0)) {
    throw new Error(`第 ${position + 1} 个参考候选的 MATCHED 状态缺少有效对齐`)
  }
  // Keep backend percentages/fractions as supplied; do not mix accumulated and union counts.
  return candidate
}

export function parseReferenceComparisonReport(
  raw: unknown,
  index: ReferenceComparisonIndex
): ReferenceComparisonReport {
  const source = record(raw, '参考比较 JSON 报告')
  requireVersion(source.schemaVersion)
  const counts = parseCounts(source)
  for (const field of ['candidateCount', 'matchedCandidateCount', 'unmatchedCandidateCount'] as const) {
    if (counts[field] !== index[field]) throw new Error(`参考比较报告的 ${field} 与阶段结果索引不一致`)
  }
  if (!Array.isArray(source.comparisons)) throw new Error('参考比较 JSON 报告缺少 comparisons 数组')
  if (source.comparisons.length !== counts.candidateCount) {
    throw new Error('参考比较报告的候选明细数量与 candidateCount 不一致')
  }
  // Preserve snapshot order and duplicate accession/segment rows. These are not rankings.
  const comparisons = source.comparisons.map(parseCandidate)
  const matched = comparisons.filter(candidate => candidate.status === 'MATCHED').length
  if (matched !== counts.matchedCandidateCount || comparisons.length - matched !== counts.unmatchedCandidateCount) {
    throw new Error('参考比较报告的候选状态与匹配／未匹配计数不一致')
  }
  return { schemaVersion: 2, ...counts, comparisons }
}
