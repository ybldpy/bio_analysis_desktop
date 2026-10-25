import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import type { AxiosAdapter } from 'axios'
import { backendService } from '../api/backendService'
import type { AnalysisPipelineStage } from '../common/analysisPipeline'
import { useReferenceComparison } from './useReferenceComparison'

function comparisonIndex(key = 'stageOutput/test/reference_comparison.json') {
  return {
    schemaVersion: 2,
    candidateCount: 1,
    matchedCandidateCount: 0,
    unmatchedCandidateCount: 1,
    comparisonJsonUrl: key,
    comparisonTsvUrl: 'stageOutput/test/reference_comparison.tsv'
  }
}

function report(accession = 'UI_TEST_REFERENCE') {
  return {
    schemaVersion: 2,
    candidateCount: 1,
    matchedCandidateCount: 0,
    unmatchedCandidateCount: 1,
    comparisons: [{
      referenceId: 501, referenceAccession: accession, sourceDb: null, taxId: null,
      organismName: null, segment: null, segmentKey: null, status: 'NO_MATCH',
      sequenceIdentity: 0, referenceCoverage: 0, alignedReferenceBases: 0,
      referenceBases: 6000, matchingBases: 0, alignmentBlockBases: 0, alignmentCount: 0,
      alignmentPafUrl: 'stageOutput/test/candidates/0001/alignment.paf',
      differenceTsvUrl: 'stageOutput/test/candidates/0001/reference_difference.tsv'
    }]
  }
}

function stage(stageId = 1, urls: Record<string, any> | null = comparisonIndex()): AnalysisPipelineStage {
  return { stageId, stageType: 43, stageName: '参考比较', status: 4, startTime: null,
    output: { urls, inline: null } }
}

const flush = async () => {
  await new Promise(resolve => setImmediate(resolve))
  await nextTick()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function scoped(t: TestContext) {
  const scope = effectScope()
  t.after(() => scope.stop())
  return scope
}

test('completed reference comparison reads the single file key and retains all-unmatched rows as valid results', async t => {
  const scope = scoped(t)
  const calls: string[] = []
  const view = scope.run(() => useReferenceComparison(() => stage(), () => 0, async key => {
    calls.push(key)
    return report()
  }))!
  await flush()
  assert.deepEqual(calls, ['stageOutput/test/reference_comparison.json'])
  assert.equal(view.kind.value, 'v2')
  assert.equal(view.index.value?.candidateCount, 1)
  assert.equal(view.report.value?.matchedCandidateCount, 0)
  assert.equal(view.report.value?.comparisons[0].status, 'NO_MATCH')
  assert.equal(view.report.value?.comparisons[0].referenceBases, 6000)
  assert.equal(view.error.value, '')
  assert.equal(view.loading.value, false)
})

test('default file reader passes one unencoded object key and parses raw JSON instead of data wrappers', async t => {
  const scope = scoped(t)
  const key = 'stageOutput/test/A&B%2F comparison.json'
  const oldAdapter = backendService.defaults.adapter
  t.after(() => { backendService.defaults.adapter = oldAdapter })
  let calls = 0
  backendService.defaults.adapter = (async config => {
    calls++
    assert.equal(config.method, 'get')
    assert.equal(new URL(backendService.getUri(config)).pathname, '/stageOutput/download')
    assert.deepEqual(config.params, { outputUrl: key })
    assert.equal(config.responseType, 'text')
    assert.ok(config.signal)
    return { config, status: 200, statusText: 'OK', headers: { 'content-type': 'application/octet-stream' },
      data: JSON.stringify(report('RAW_FILE_RESULT')) }
  }) as AxiosAdapter
  const view = scope.run(() => useReferenceComparison(() => stage(1, comparisonIndex(key)), () => 0))!
  await flush()
  assert.equal(calls, 1)
  assert.equal(view.report.value?.comparisons[0].referenceAccession, 'RAW_FILE_RESULT')
  assert.equal(view.error.value, '')
})

test('legacy, absent and unfinished results do not fetch or fabricate candidate metrics', async t => {
  const scope = scoped(t)
  const current = ref(stage(1, { pafPath: 'old.paf', differenceTsv: 'old.tsv' }))
  let calls = 0
  const view = scope.run(() => useReferenceComparison(() => current.value, () => 0, async () => {
    calls++
    return report()
  }))!
  assert.equal(view.kind.value, 'legacy')
  assert.match(view.message.value, /历史结果未提供/)
  assert.equal(view.index.value, null)
  for (const status of [0, 1, 2, 3, 5, 6]) {
    current.value = { ...stage(), status }
    await flush()
    assert.equal(view.report.value, null)
    assert.match(view.message.value, /尚未完成、执行失败或不适用/)
    assert.doesNotMatch(view.message.value, /未获得匹配|NO_MATCH/)
  }
  current.value = stage(2, null)
  await flush()
  assert.equal(view.kind.value, 'empty')
  assert.equal(view.index.value, null)
  assert.equal(view.report.value, null)
  assert.match(view.message.value, /未提供/)
  current.value = { ...stage(), stageType: 44 }
  await flush()
  assert.equal(view.kind.value, 'empty')
  assert.equal(view.index.value, null)
  assert.equal(calls, 0)
})

test('unknown versions, bad indexes and DTO URL parse errors are explicit errors, never legacy or empty', async t => {
  const scope = scoped(t)
  const current = ref(stage(1, { ...comparisonIndex(), schemaVersion: 3 }))
  let calls = 0
  const view = scope.run(() => useReferenceComparison(() => current.value, () => 0, async () => {
    calls++
    return report()
  }))!
  for (const urls of [
    { ...comparisonIndex(), schemaVersion: 3 },
    { ...comparisonIndex(), comparisonJsonUrl: '' },
    { ...comparisonIndex(), candidateCount: 9 },
    { unexpected: 'not an index' }
  ]) {
    current.value = stage(1, urls)
    await flush()
    assert.equal(view.kind.value, 'invalid')
    assert.ok(view.error.value)
    assert.equal(view.report.value, null)
  }
  current.value = { ...stage(), output: { urls: null, inline: null, parseErrors: { urls: '坏 JSON' } } }
  await flush()
  assert.equal(view.kind.value, 'invalid')
  assert.match(view.error.value, /索引解析失败.*坏 JSON/)
  assert.equal(calls, 0)
})

test('network and malformed-report failures preserve the index summary and allow explicit retry', async t => {
  const scope = scoped(t)
  let attempt = 0
  const view = scope.run(() => useReferenceComparison(() => stage(), () => 0, async () => {
    attempt++
    if (attempt === 1) throw new Error('HTTP 500')
    if (attempt === 2) return { status: 0, data: report() }
    if (attempt === 3) return { ...report(), schemaVersion: 3 }
    return report()
  }))!
  await flush()
  assert.match(view.error.value, /HTTP 500/)
  for (let i = 0; i < 2; i++) {
    await view.reload()
    assert.ok(view.error.value)
    assert.equal(view.kind.value, 'v2')
    assert.equal(view.index.value?.candidateCount, 1)
    assert.equal(view.report.value, null)
    assert.equal(view.loading.value, false)
  }
  await view.reload()
  assert.equal(view.error.value, '')
  assert.equal(view.report.value?.comparisons.length, 1)
})

test('stage switching aborts previous reads and ignores late old successes', async t => {
  const scope = scoped(t)
  const current = ref(stage(1, comparisonIndex('old.json')))
  const pending = deferred<Record<string, any>>()
  const signals: AbortSignal[] = []
  const view = scope.run(() => useReferenceComparison(() => current.value, () => 0, async (key, signal) => {
    signals.push(signal!)
    return key === 'old.json' ? pending.promise : report('NEW_RESULT')
  }))!
  current.value = stage(2, comparisonIndex('new.json'))
  assert.equal(signals[0].aborted, true)
  await flush()
  assert.equal(view.report.value?.comparisons[0].referenceAccession, 'NEW_RESULT')
  pending.resolve(report('OLD_RESULT'))
  await flush()
  assert.equal(view.report.value?.comparisons[0].referenceAccession, 'NEW_RESULT')
  assert.equal(view.error.value, '')
})

test('same-key refresh and index replacement cancel old errors without overwriting current success', async t => {
  const scope = scoped(t)
  const current = ref(stage())
  const revision = ref(0)
  const pending = deferred<Record<string, any>>()
  const signals: AbortSignal[] = []
  let calls = 0
  const view = scope.run(() => useReferenceComparison(() => current.value, () => revision.value, async (_key, signal) => {
    signals.push(signal!)
    calls++
    return calls === 1 ? pending.promise : report(`RESULT_${calls}`)
  }))!
  revision.value++
  await flush()
  assert.equal(signals[0].aborted, true)
  assert.equal(calls, 2)
  pending.reject(new Error('late error'))
  await flush()
  assert.equal(view.error.value, '')
  assert.equal(view.report.value?.comparisons[0].referenceAccession, 'RESULT_2')
  current.value.output.urls = comparisonIndex()
  await flush()
  assert.equal(calls, 3)
  current.value.output.urls!.comparisonTsvUrl = 'updated-summary.tsv'
  await flush()
  assert.equal(calls, 4)
  assert.equal(view.index.value?.comparisonTsvUrl, 'updated-summary.tsv')
})

test('changing to another stage type clears the result and cancels an outstanding comparison read', async t => {
  const scope = scoped(t)
  const current = ref(stage())
  const pending = deferred<Record<string, any>>()
  let signal!: AbortSignal
  const view = scope.run(() => useReferenceComparison(() => current.value, () => 0, async (_key, requestSignal) => {
    signal = requestSignal!
    return pending.promise
  }))!
  current.value = { ...stage(2), stageType: 20 }
  assert.equal(signal.aborted, true)
  pending.resolve(report())
  await flush()
  assert.equal(view.report.value, null)
  assert.equal(view.index.value, null)
  assert.equal(view.loading.value, false)
  assert.equal(view.error.value, '')
})

test('scope disposal aborts loading and suppresses late responses and reloads', async t => {
  const scope = scoped(t)
  const pending = deferred<Record<string, any>>()
  let signal!: AbortSignal
  let calls = 0
  const view = scope.run(() => useReferenceComparison(() => stage(), () => 0, async (_key, requestSignal) => {
    calls++
    signal = requestSignal!
    return pending.promise
  }))!
  assert.equal(view.loading.value, true)
  scope.stop()
  assert.equal(signal.aborted, true)
  pending.resolve(report())
  await flush()
  assert.equal(view.report.value, null)
  assert.equal(view.loading.value, false)
  await view.reload()
  assert.equal(calls, 1)
})
