import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  metricBarWidth,
  metricDistribution,
  metricFraction,
  metricLabel,
  metricMaskDistribution,
  metricMaximum,
  metricNumber,
  metricRatio,
  metricRecords
} from './metricsDisplay'

const types = [
  { key: 'snpCount', label: 'SNP', color: 'blue' },
  { key: 'indelCount', label: 'INDEL', color: 'purple' },
  { key: 'otherCount', label: '其他', color: 'gray' }
]
const filters = [
  { key: 'explicitPassCount', label: 'PASS', color: 'blue' },
  { key: 'filteredCount', label: '已标记过滤', color: 'orange' },
  { key: 'unfilteredCount', label: '未明确过滤状态', color: 'gray' }
]

test('display metrics preserve real zero and reject absent or malformed values', () => {
  assert.equal(metricNumber(0), 0)
  for (const value of [null, undefined, '', '0', false, NaN, Infinity, -1, [], {}]) {
    assert.equal(metricNumber(value), null)
    assert.equal(metricRatio(value, 10), null)
  }
  assert.equal(metricFraction(1), 1)
  assert.equal(metricFraction(1.1), null)
  assert.equal(metricLabel('<script>alert(1)</script>'), '<script>alert(1)</script>')
  assert.equal(metricLabel({ name: 'reference' }), '未提供')
  assert.equal(metricLabel(' '), '未提供')
})

test('bar presentation never divides by zero or silently fills absent values', () => {
  assert.equal(metricRatio(0, 0), 0)
  assert.equal(metricRatio(1, 0), null)
  assert.equal(metricRatio(null, 0), null)
  assert.equal(metricRatio(0, null), null)
  assert.equal(metricRatio(5, 10), 0.5)
  assert.equal(metricRatio(11, 10), null)
  assert.equal(metricBarWidth(0), '0%')
  assert.equal(metricBarWidth(0.95), '95%')
  assert.equal(metricBarWidth(NaN), '0%')
  assert.equal(metricBarWidth(Infinity), '0%')
  assert.equal(metricBarWidth(null), '0%')
  assert.equal(metricMaximum([null, undefined, NaN]), null)
  assert.equal(metricMaximum([0, null, 82.6, 12]), 82.6)
})

test('row validation tolerates unknown shapes without mutating reported data', () => {
  const reference = { referenceName: 'ref A', meanDepth: 0 }
  assert.deepEqual(metricRecords(null), [])
  assert.deepEqual(metricRecords({ references: [] }), [])
  assert.deepEqual(metricRecords([null, 0, [], reference, 'bad']), [reference])
  assert.equal(metricRecords([reference])[0], reference)
})

test('variant type and filter distributions remain separate and use variantRecords', () => {
  const report = {
    variantRecords: 10,
    totalVcfRecords: 100,
    snpCount: 7,
    indelCount: 2,
    otherCount: 1,
    explicitPassCount: 4,
    filteredCount: 3,
    unfilteredCount: 3
  }
  const typeChart = metricDistribution(report, 'variantRecords', types)
  const filterChart = metricDistribution(report, 'variantRecords', filters)
  assert.equal(typeChart.state, 'ready')
  assert.equal(filterChart.state, 'ready')
  assert.deepEqual(
    typeChart.parts.map((part) => part.fraction),
    [0.7, 0.2, 0.1]
  )
  assert.deepEqual(
    filterChart.parts.map((part) => part.fraction),
    [0.4, 0.3, 0.3]
  )
  assert.equal(report.totalVcfRecords, 100)
})

test('zero variants are a legitimate empty chart, not missing data or NaN', () => {
  const result = metricDistribution(
    { variantRecords: 0, snpCount: 0, indelCount: 0, otherCount: 0 },
    'variantRecords',
    types
  )
  assert.equal(result.state, 'empty')
  assert.ok(result.parts.every((part) => part.value === 0 && part.fraction === 0))
  assert.ok(result.parts.every((part) => metricBarWidth(part.fraction) === '0%'))
})

test('incomplete or inconsistent variant counts are not normalized to a full chart', () => {
  assert.equal(
    metricDistribution(
      { variantRecords: 10, snpCount: 2, indelCount: null },
      'variantRecords',
      types
    ).state,
    'missing'
  )
  const missingTotal = metricDistribution(
    { snpCount: 2, indelCount: 0, otherCount: 0 },
    'variantRecords',
    types
  )
  assert.equal(missingTotal.state, 'missing')
  assert.ok(missingTotal.parts.every((part) => part.fraction === null))
  assert.equal(
    metricDistribution(
      { variantRecords: 10, snpCount: 2, indelCount: 0, otherCount: 0 },
      'variantRecords',
      types
    ).state,
    'inconsistent'
  )
})

test('mask chart uses reported fractions instead of reconstructing FASTA or missing metrics', () => {
  const report = {
    totalBases: 100,
    unmaskedBases: 80,
    maskedBases: 20,
    unmaskedFraction: 0.8,
    maskedFraction: 0.2
  }
  const result = metricMaskDistribution(report)
  assert.equal(result.state, 'ready')
  assert.deepEqual(
    result.parts.map((part) => part.fraction),
    [0.8, 0.2]
  )
  assert.equal(metricMaskDistribution({ ...report, maskedFraction: null }).state, 'missing')
  assert.equal(metricMaskDistribution({ ...report, maskedFraction: 0.1 }).state, 'inconsistent')
  assert.equal(metricMaskDistribution({ ...report, maskedFraction: 1.2 }).state, 'missing')
  assert.equal(
    metricMaskDistribution({ totalBases: 0, unmaskedFraction: 0, maskedFraction: 0 }).state,
    'empty'
  )
})
