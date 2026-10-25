import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ElementPlus, { ID_INJECTION_KEY } from 'element-plus'
import { parseQcReport, qcReportBarWidth, type QcReport, type RecognizedQcReport } from './qcReport'

const QcReportResult = require('./QcReportResult.vue').default
const fixture = (name: string) => readFileSync(resolve('test-data/report-fixtures', name), 'utf8')
const short = () => JSON.parse(fixture('qc-short.json'))
const long = () => JSON.parse(fixture('qc-long.json'))
function recognized(value: unknown): RecognizedQcReport {
  const result = parseQcReport(JSON.stringify(value))
  assert.equal(result.kind, 'qc')
  return result as RecognizedQcReport
}
async function render(report: QcReport) {
  const app = createSSRApp(QcReportResult, { report })
  app.use(ElementPlus)
  app.provide(ID_INJECTION_KEY, { prefix: 1, current: 0 })
  return renderToString(app)
}

test('real fastp fixture preserves before/after values, paired lengths and filtering counts', () => {
  const report = parseQcReport('\uFEFF' + fixture('qc-short.json')) as RecognizedQcReport
  assert.equal(report.kind, 'qc')
  assert.equal(report.tool, 'fastp')
  assert.equal(report.version, '1.0.1')
  assert.equal(report.before.totalReads, 1000000)
  assert.equal(report.after.totalReads, 933558)
  assert.equal(report.before.totalBases, 242935234)
  assert.equal(report.after.q30Fraction, 0.80169)
  assert.equal(report.readRetentionFraction, 0.933558)
  assert.equal(report.baseRetentionFraction, 226079883 / 242935234)
  assert.deepEqual(
    report.lengths.map((row) => [row.key, row.before, row.after]),
    [
      ['read1', 242, 242],
      ['read2', 243, 242]
    ]
  )
  assert.equal(report.filtering.find((row) => row.key === 'low_quality_reads')?.reads, 66442)
  assert.equal(report.filtering.find((row) => row.key === 'too_many_N_reads')?.reads, 0)
})

test('real fastplong fixture uses the long-read field and does not require short-read metrics', () => {
  const report = recognized(long())
  assert.equal(report.tool, 'fastplong')
  assert.equal(report.version, '0.4.1')
  assert.equal(report.before.totalReads, 3578)
  assert.equal(report.before.totalBases, 8397200)
  assert.equal(report.after.q20Fraction, 0.908033)
  assert.equal(report.readRetentionFraction, 1)
  assert.deepEqual(report.lengths, [
    { key: 'read', label: '平均 read 长度', before: 2346, after: 2346 }
  ])
  assert.equal(report.before.read1MeanLength, null)
  assert.deepEqual(report.warnings, [])
})

test('synthetic single-end and missing Q30 cases remain missing rather than zero', () => {
  const input = short()
  for (const summary of [input.summary.before_filtering, input.summary.after_filtering]) {
    delete summary.read2_mean_length
    delete summary.q30_rate
    delete summary.q30_bases
  }
  const report = recognized(input)
  assert.deepEqual(
    report.lengths.map((row) => row.key),
    ['read1']
  )
  assert.equal(report.before.q30Fraction, null)
  assert.equal(report.after.q30Bases, null)
  assert.equal(report.before.read2MeanLength, null)
})

test('zero reads and bases do not cause a fabricated retention percentage or NaN', async () => {
  const input = long()
  for (const summary of [input.summary.before_filtering, input.summary.after_filtering]) {
    summary.total_reads = 0
    summary.total_bases = 0
  }
  input.filtering_result = { passed_filter_reads: 0 }
  const report = recognized(input)
  assert.equal(report.before.totalReads, 0)
  assert.equal(report.readRetentionFraction, null)
  assert.equal(report.baseRetentionFraction, null)
  assert.equal(qcReportBarWidth(0, 0), '0%')
  assert.equal(qcReportBarWidth(null, 0), '0%')
  assert.equal(qcReportBarWidth(NaN, Infinity), '0%')
  const html = await render(report)
  assert.match(html, /不适用（过滤前为 0）/)
  assert.doesNotMatch(html, /NaN|Infinity|progressbar/)
})

test('bad JSON throws while unknown tools and ambiguous tool markers remain unsupported', () => {
  for (const input of ['', '{bad', '<html>server error</html>']) {
    assert.throws(() => parseQcReport(input), /JSON 解析失败/)
  }
  for (const input of [
    null,
    [],
    0,
    {},
    { summary: { other_version: '1.0' } },
    { summary: { fastp_version: '1.0.1', fastplong_version: '0.4.1' } },
    { summary: { fastp_version: '/private/local/path' } }
  ]) {
    assert.equal(parseQcReport(JSON.stringify(input)).kind, 'unsupported')
  }
})

test('invalid supplied values do not coerce strings/null to zero or infer missing fractions', () => {
  const input = short()
  input.summary.before_filtering.total_reads = '1000000'
  input.summary.before_filtering.q30_rate = 78.9
  input.summary.after_filtering.gc_content = null
  input.filtering_result.low_quality_reads = '66442'
  delete input.filtering_result.too_long_reads
  const report = recognized(input)
  assert.equal(report.before.totalReads, null)
  assert.equal(report.before.q30Fraction, null)
  assert.equal(report.after.gcFraction, null)
  assert.equal(report.readRetentionFraction, null)
  assert.equal(report.filtering.find((row) => row.key === 'low_quality_reads')?.reads, null)
  assert.ok(!report.filtering.some((row) => row.key === 'too_long_reads'))
  assert.ok(report.warnings.length)
  const increased = long()
  increased.summary.after_filtering.total_reads = 4000
  assert.equal(recognized(increased).readRetentionFraction, null)
})

test('parser whitelists metrics and never retains paths, commands or unsupported raw detail', () => {
  const input = short()
  input.command = 'private-command /home/private/reads.fastq'
  input.summary.sequencing = '/home/private/reads.fastq'
  input.summary.before_filtering.path = 'C:\\private\\reads.fastq'
  input.read1_before_filtering = { filename: '/private/file', quality_curves: [1, 2] }
  input.filtering_result.command = 'do-not-render'
  const serialized = JSON.stringify(recognized(input))
  assert.doesNotMatch(serialized, /private|command|quality_curves|filename|sequencing/)
})

test('real QC fixtures render correct units and percentages with distinct short/long length rows', async () => {
  const shortHtml = await render(recognized(short()))
  assert.match(shortHtml, /fastp 1\.0\.1/)
  assert.match(shortHtml, /1,000,000/)
  assert.match(shortHtml, /242,935,234 bp/)
  assert.match(shortHtml, /93\.36%/)
  assert.match(shortHtml, /80\.17%/)
  assert.match(shortHtml, /R2 平均长度/)
  assert.match(shortHtml, /低质量/)
  assert.match(shortHtml, /66,442 条 reads/)
  const longHtml = await render(recognized(long()))
  assert.match(longHtml, /fastplong 0\.4\.1/)
  assert.match(longHtml, /平均 read 长度/)
  assert.match(longHtml, /2,346 bp/)
  assert.match(longHtml, /90\.80%/)
  assert.doesNotMatch(longHtml, /R1 \/ 单端平均长度|R2 平均长度|NaN|Infinity/)
})

test('missing Q30 and unknown tool render explicit missing or unsupported states', async () => {
  const input = short()
  delete input.summary.after_filtering.q30_rate
  const html = await render(recognized(input))
  assert.match(html, /Q30 碱基比例<\/th><td>77\.89%<\/td><td>未提供<\/td>/)
  const unsupported = await render(parseQcReport('{"summary":{"unknown_version":"2.0"}}'))
  assert.match(unsupported, /暂未支持的 QC 报告格式/)
  assert.doesNotMatch(unsupported, /Reads 保留比例/)
})
