import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseReferenceComparisonIndex,
  parseReferenceComparisonReport,
  type ReferenceComparisonCandidate,
  type ReferenceComparisonIndex,
  type ReferenceComparisonReport
} from './referenceComparison'

function candidate(overrides: Partial<ReferenceComparisonCandidate> = {}): ReferenceComparisonCandidate {
  return {
    referenceId: 1,
    referenceAccession: 'TEST_ACCESSION',
    sourceDb: 'USER_UPLOAD',
    taxId: 2000000000,
    organismName: 'SOFTWARE_TEST_ONLY',
    segment: '1',
    segmentKey: 'SEGMENT_1',
    status: 'MATCHED',
    sequenceIdentity: 99.775,
    referenceCoverage: 0.5,
    alignedReferenceBases: 4000,
    referenceBases: 8000,
    matchingBases: 3991,
    alignmentBlockBases: 4000,
    alignmentCount: 1,
    alignmentPafUrl: 'stageOutput/test/candidates/1/alignment.paf',
    differenceTsvUrl: 'stageOutput/test/candidates/1/difference.tsv',
    ...overrides
  }
}
function unmatched(overrides: Partial<ReferenceComparisonCandidate> = {}): ReferenceComparisonCandidate {
  return candidate({
    status: 'NO_MATCH', sequenceIdentity: 0, referenceCoverage: 0,
    alignedReferenceBases: 0, matchingBases: 0, alignmentBlockBases: 0, alignmentCount: 0,
    ...overrides
  })
}
function fixtures(comparisons = [candidate()]): { index: ReferenceComparisonIndex; report: ReferenceComparisonReport } {
  const counts = {
    candidateCount: comparisons.length,
    matchedCandidateCount: comparisons.filter(row => row.status === 'MATCHED').length,
    unmatchedCandidateCount: comparisons.filter(row => row.status === 'NO_MATCH').length
  }
  return {
    index: {
      schemaVersion: 2, ...counts,
      comparisonJsonUrl: 'stageOutput/目录与空格 & %/reference_comparison.json',
      comparisonTsvUrl: 'stageOutput/test/reference_comparison.tsv'
    },
    report: { schemaVersion: 2, ...counts, comparisons }
  }
}

test('schema-v2 parses complete index and preserves opaque object keys without encoding', () => {
  const { index } = fixtures()
  assert.deepEqual(parseReferenceComparisonIndex(index), { kind: 'v2', index })
  assert.equal(parseReferenceComparisonIndex(null).kind, 'empty')
  assert.equal(parseReferenceComparisonIndex(undefined).kind, 'empty')
})

test('legacy requires a valid old file field and never accepts explicit unknown versions', () => {
  for (const raw of [
    { pafPath: 'old.paf', differenceTsv: 'old.tsv' },
    { pafPath: 'old.paf' },
    { differenceTsv: 'old.tsv' }
  ]) assert.deepEqual(parseReferenceComparisonIndex(raw), { kind: 'legacy' })
  for (const raw of [
    {}, [], 'bad JSON', 'null', { pafPath: '' }, { differenceTsv: 4 },
    { comparisonJsonUrl: 'new.json' },
    ...[null, undefined, 1, 3, '2'].map(schemaVersion => ({ schemaVersion, pafPath: 'old.paf' }))
  ]) assert.throws(() => parseReferenceComparisonIndex(raw))
})

test('index validates counts and both required summary file keys', () => {
  const { index } = fixtures()
  for (const changed of [
    { candidateCount: -1 }, { matchedCandidateCount: 0.5 }, { unmatchedCandidateCount: '0' },
    { candidateCount: 3 }, { matchedCandidateCount: Number.MAX_SAFE_INTEGER + 1 },
    { comparisonJsonUrl: '' }, { comparisonTsvUrl: null }, { comparisonJsonUrl: [] }
  ]) assert.throws(() => parseReferenceComparisonIndex({ ...index, ...changed }))
  const empty = fixtures([])
  assert.deepEqual(parseReferenceComparisonIndex(empty.index), { kind: 'v2', index: empty.index })
})

test('retains all candidates, duplicate accession and segment values, original order and every flat metric', () => {
  const rows = [
    candidate({ referenceId: 7, sequenceIdentity: 100, referenceCoverage: 1, alignedReferenceBases: 6000,
      referenceBases: 6000, matchingBases: 6000, alignmentBlockBases: 6000 }),
    candidate({ referenceId: 3, alignmentPafUrl: 'candidates/2.paf', differenceTsvUrl: 'candidates/2.tsv' }),
    unmatched({ referenceId: 9, alignmentPafUrl: 'candidates/3.paf', differenceTsvUrl: 'candidates/3.tsv' })
  ]
  const { index, report } = fixtures(rows)
  const before = JSON.stringify(report)
  const parsed = parseReferenceComparisonReport(report, index)
  assert.deepEqual(parsed, report)
  assert.equal(JSON.stringify(report), before)
  assert.deepEqual(parsed.comparisons.map(row => row.referenceId), [7, 3, 9])
  assert.equal(parsed.comparisons[1].sequenceIdentity, 99.775)
  assert.equal(parsed.comparisons[1].referenceCoverage, 0.5)
  assert.equal(parsed.comparisons[2].status, 'NO_MATCH')
  assert.ok(parsed.comparisons.every(row => row.referenceAccession === 'TEST_ACCESSION'))
  assert.ok(parsed.comparisons.every(row => row.segmentKey === 'SEGMENT_1'))
  assert.equal('metrics' in parsed.comparisons[0], false)
})

test('all-NO_MATCH report and nullable metadata are legitimate, without inferred species or zero-filled metadata', () => {
  const { index, report } = fixtures([unmatched({
    referenceId: null, sourceDb: null, taxId: null, organismName: null, segment: null, segmentKey: null
  })])
  const parsed = parseReferenceComparisonReport(report, index)
  assert.deepEqual(parsed, report)
  assert.equal(parsed.matchedCandidateCount, 0)
  assert.equal(parsed.unmatchedCandidateCount, 1)
  for (const field of ['referenceId', 'sourceDb', 'taxId', 'organismName', 'segment', 'segmentKey'] as const) {
    assert.equal(parsed.comparisons[0][field], null)
  }
  const empty = fixtures([])
  assert.deepEqual(parseReferenceComparisonReport(empty.report, empty.index), empty.report)
})

test('preserves backend fractional values and permits accumulated alignment bases exceeding union/reference length', () => {
  const { index, report } = fixtures([candidate({
    referenceBases: 6000, alignedReferenceBases: 4000, referenceCoverage: 0.666667,
    matchingBases: 9000, alignmentBlockBases: 10000, sequenceIdentity: 90, alignmentCount: 3
  })])
  const parsed = parseReferenceComparisonReport(report, index)
  assert.equal(parsed.comparisons[0].referenceCoverage, 0.666667)
  assert.equal(parsed.comparisons[0].matchingBases, 9000)
  assert.equal(parsed.comparisons[0].alignmentCount, 3)
})

test('rejects report envelope, missing arrays, unsupported schema and partial candidate lists', () => {
  const { index, report } = fixtures()
  for (const raw of [
    undefined, null, [], JSON.stringify(report), { data: report }, { metrics: report },
    { ...report, schemaVersion: 3 }, { ...report, schemaVersion: '2' },
    { ...report, comparisons: undefined }, { ...report, comparisons: [] }
  ]) assert.throws(() => parseReferenceComparisonReport(raw, index))
})

test('report counts must agree internally, with row status and with index, not merely the array length', () => {
  const { index, report } = fixtures()
  assert.throws(() => parseReferenceComparisonReport({ ...report, candidateCount: 2 }, index), /总数/)
  assert.throws(() => parseReferenceComparisonReport(report, { ...index, candidateCount: 2 }), /索引/)
  assert.throws(() => parseReferenceComparisonReport({
    ...report, matchedCandidateCount: 0, unmatchedCandidateCount: 1
  }, index), /索引/)
  assert.throws(() => parseReferenceComparisonReport({ ...report, comparisons: [unmatched()] }, index), /候选状态/)
})

test('all candidate fields are required even when their permitted value is null', () => {
  const { index, report } = fixtures()
  for (const field of Object.keys(report.comparisons[0])) {
    const row = { ...report.comparisons[0] } as Record<string, unknown>
    delete row[field]
    assert.throws(() => parseReferenceComparisonReport({ ...report, comparisons: [row] }, index), field)
  }
})

test('rejects out-of-range, non-numeric, non-integer and inconsistent metrics instead of presenting zeroes', () => {
  const { index, report } = fixtures()
  const changes = [
    { sequenceIdentity: 100.1 }, { sequenceIdentity: -0.1 }, { sequenceIdentity: NaN },
    { referenceCoverage: 1.01 }, { referenceCoverage: Infinity }, { referenceCoverage: '0.5' },
    { alignedReferenceBases: 8001 }, { referenceBases: -1 }, { matchingBases: 4001 },
    { alignmentBlockBases: 0.5 }, { alignmentCount: -1 }, { alignmentCount: 0 },
    { referenceId: 0 }, { referenceId: Number.MAX_SAFE_INTEGER + 1 }, { taxId: '123' },
    { organismName: {} }, { sourceDb: 1 }, { segment: [] }, { segmentKey: false },
    { status: 'FAILED' }, { alignmentPafUrl: '' }, { differenceTsvUrl: null }
  ]
  for (const changed of changes) {
    assert.throws(() => parseReferenceComparisonReport({
      ...report, comparisons: [{ ...report.comparisons[0], ...changed }]
    }, index), JSON.stringify(changed))
  }
  const none = fixtures([unmatched()])
  for (const field of ['sequenceIdentity', 'referenceCoverage', 'alignedReferenceBases', 'matchingBases',
    'alignmentBlockBases', 'alignmentCount']) {
    assert.throws(() => parseReferenceComparisonReport({
      ...none.report, comparisons: [{ ...none.report.comparisons[0], [field]: 1 }]
    }, none.index))
  }
})
