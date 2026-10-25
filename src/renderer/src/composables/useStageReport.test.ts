import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { effectScope, nextTick, ref } from 'vue'
import type { AnalysisPipelineStage } from '../common/analysisPipeline'
import { getStageReportSpec, useStageReport } from './useStageReport'

const fixture = (name: string) =>
  readFileSync(path.resolve(__dirname, '../../../../test-data/report-fixtures', name), 'utf8')
const stage = (
  stageId: number,
  stageType: number,
  urls: Record<string, any> = {}
): AnalysisPipelineStage => ({
  stageId,
  stageType,
  stageName: '测试阶段',
  status: 4,
  startTime: null,
  output: { inline: null, urls }
})
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve))
  await nextTick()
}

test('report specs select exact keys and only the documented VF historical fallback', () => {
  const cases = [
    [0, 'reportJSON'],
    [60, 'amrResult'],
    [61, 'vfTsv'],
    [62, 'mlst'],
    [64, 'serotypeResultUrl']
  ] as const
  for (const [type, field] of cases) {
    assert.equal(
      getStageReportSpec(
        stage(1, type, { [field]: 'correct.tsv', r1Url: 'no.fastq', reportHTML: 'no.html' })
      ).fileKey,
      'correct.tsv'
    )
  }
  assert.equal(getStageReportSpec(stage(1, 61, { amrTsv: 'legacy.tsv' })).fileKey, 'legacy.tsv')
  assert.equal(getStageReportSpec(stage(1, 60, { amrTsv: 'wrong.tsv' })).fileKey, null)
  assert.equal(getStageReportSpec(stage(1, 0, { cleanedR1: 'raw.fastq' })).fileKey, null)
  assert.equal(
    getStageReportSpec(
      stage(1, 64, { serotypeResultUrl: 'merged.tsv', kaptiveKResultUrl: 'k.tsv' })
    ).fileKey,
    null
  )
})

test('reports are not loaded for unfinished, failed, skipped, unsupported or malformed stages', async () => {
  const current = ref(stage(1, 0, { reportJSON: 'qc.json' }))
  current.value.status = 2
  const scope = effectScope()
  let calls = 0
  const view = scope.run(() =>
    useStageReport(
      () => current.value,
      () => 0,
      async () => {
        calls++
        return '{}'
      }
    )
  )!
  for (const status of [0, 1, 2, 3, 5, 6]) {
    current.value = { ...stage(status + 2, 0, { reportJSON: 'qc.json' }), status }
    await flush()
    assert.ok(view.message.value)
  }
  current.value = stage(12, 20, { metricsUrl: 'other.json' })
  await flush()
  current.value = stage(13, 0, { reportJSON: 'qc.json' })
  current.value.output.parseErrors = { urls: '坏 JSON' }
  await flush()
  assert.equal(calls, 0)
  scope.stop()
})

test('switching reports aborts old requests, ignores late responses and refreshes unchanged keys', async () => {
  const scope = effectScope()
  const current = ref(stage(1, 0, { reportJSON: 'old.json' }))
  const revision = ref(0)
  let resolveOld!: (value: string) => void
  const old = new Promise<string>((resolve) => {
    resolveOld = resolve
  })
  const signals: AbortSignal[] = []
  const keys: string[] = []
  const view = scope.run(() =>
    useStageReport(
      () => current.value,
      () => revision.value,
      async (key, signal) => {
        keys.push(key)
        signals.push(signal!)
        return key === 'old.json' ? old : fixture('mlst-untyped.tsv')
      }
    )
  )!
  current.value = stage(2, 62, { mlst: 'new.tsv' })
  await flush()
  assert.equal(view.textReport.value?.format, 'mlst')
  assert.equal(signals[0].aborted, true)
  resolveOld(fixture('qc-short.json'))
  await flush()
  assert.equal(view.qcReport.value, null)
  assert.equal(view.textReport.value?.format, 'mlst')
  revision.value++
  await flush()
  assert.deepEqual(keys, ['old.json', 'new.tsv', 'new.tsv'])
  scope.stop()
  assert.equal(signals[2].aborted, true)
})

test('download and parse failures stay local; retry can load an actual QC report', async () => {
  const scope = effectScope()
  let attempt = 0
  const view = scope.run(() =>
    useStageReport(
      () => stage(1, 0, { reportJSON: 'qc.json' }),
      () => 0,
      async () => {
        attempt++
        if (attempt === 1) throw new Error('HTTP 500')
        if (attempt === 2) return '{broken'
        return fixture('qc-short.json')
      }
    )
  )!
  await flush()
  assert.match(view.error.value, /HTTP 500/)
  await view.reload()
  assert.ok(view.error.value)
  assert.equal(view.qcReport.value, null)
  await view.reload()
  assert.equal(view.error.value, '')
  assert.equal(view.qcReport.value?.kind, 'qc')
  scope.stop()
})

test('an empty valid report is distinct from a missing file key', async () => {
  const current = ref(stage(1, 60, { amrResult: 'amr.tsv' }))
  const scope = effectScope()
  const view = scope.run(() =>
    useStageReport(
      () => current.value,
      () => 0,
      async () => fixture('amr-empty.tsv')
    )
  )!
  await flush()
  assert.equal(view.textReport.value?.status, 'empty')
  assert.equal(view.error.value, '')
  current.value = stage(1, 60)
  await flush()
  assert.equal(view.textReport.value, null)
  assert.match(view.message.value, /未提供/)
  scope.stop()
})
