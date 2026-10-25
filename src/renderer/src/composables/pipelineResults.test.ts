import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { usePipelineResults, type PipelineResultsTransport } from './usePipelineResults'
import { useStageMetrics } from './useStageMetrics'
import type { AnalysisPipeline, AnalysisPipelineStage } from '../common/analysisPipeline'

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve))
  await nextTick()
}
const pipeline = (id: number): AnalysisPipeline => ({
  pipelineId: id,
  pipelineType: 100,
  status: 1,
  analysisPipelineName: `任务${id}`,
  createTime: new Date(),
  projectId: 1
})
const stage = (id: number, type = 20): AnalysisPipelineStage => ({
  stageId: id,
  stageType: type,
  stageName: `阶段${id}`,
  status: 4,
  startTime: null,
  output: { urls: { metricsUrl: `result/${id}.json` }, inline: null }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { resolve, reject, promise }
}

test('initial failure then retry retains the requested stage and same-status refresh updates output', async () => {
  const scope = effectScope()
  let failed = true
  let revision = 1
  const transport: PipelineResultsTransport = {
    pipeline: async (id) => pipeline(id),
    stages: async () => {
      if (failed) throw new Error('暂时不可用')
      return [stage(11), { ...stage(22), stageName: `版本${revision}` }]
    }
  }
  const view = scope.run(() =>
    usePipelineResults(
      () => 1,
      () => 22,
      transport
    )
  )!
  await flush()
  assert.equal(view.error.value, '暂时不可用')
  failed = false
  await view.refresh()
  assert.equal(view.selectedStageId.value, 22)
  revision = 2
  await view.refresh()
  assert.equal(view.selectedStage.value?.stageName, '版本2')
  scope.stop()
})

test('switching tasks ignores older responses and scope disposal aborts requests', async () => {
  const scope = effectScope()
  const id = ref(1)
  const old = deferred<AnalysisPipelineStage[]>()
  const signals: AbortSignal[] = []
  const view = scope.run(() =>
    usePipelineResults(
      () => id.value,
      () => undefined,
      {
        pipeline: async (value) => pipeline(value),
        stages: async (value, signal) => {
          signals.push(signal!)
          return value === 1 ? old.promise : [stage(22)]
        }
      }
    )
  )!
  id.value = 2
  await flush()
  assert.equal(signals[0].aborted, true)
  assert.equal(view.pipeline.value?.pipelineId, 2)
  old.resolve([stage(11)])
  await flush()
  assert.equal(view.selectedStageId.value, 22)
  scope.stop()
  assert.equal(signals[1].aborted, true)
})

test('invalid stage falls back, empty stages stay empty, refresh failure preserves loaded results', async () => {
  const scope = effectScope()
  let mode = 0
  const view = scope.run(() =>
    usePipelineResults(
      () => 1,
      () => 999,
      {
        pipeline: async (id) => pipeline(id),
        stages: async () => {
          if (mode === 1) throw new Error('刷新失败')
          return mode === 2 ? [] : [stage(11)]
        }
      }
    )
  )!
  await flush()
  assert.equal(view.selectedStageId.value, 11)
  assert.match(view.selectionMessage.value, /不存在/)
  mode = 1
  await view.refresh()
  assert.equal(view.selectedStageId.value, 11)
  assert.equal(view.stages.value.length, 1)
  assert.equal(view.error.value, '刷新失败')
  mode = 2
  await view.refresh()
  assert.equal(view.selectedStageId.value, null)
  assert.equal(view.stages.value.length, 0)
  scope.stop()
})

test('metric reads do not preload unrelated stages, and old stage results cannot overwrite current metrics', async () => {
  const scope = effectScope()
  const current = ref(stage(1))
  const revision = ref(0)
  const first = deferred<Record<string, any>>()
  const keys: string[] = []
  const signals: AbortSignal[] = []
  const resource = scope.run(() =>
    useStageMetrics(
      () => current.value,
      () => revision.value,
      async (key, signal) => {
        keys.push(key)
        signals.push(signal!)
        return key === 'result/1.json' ? first.promise : { mappingFraction: 0.7 }
      }
    )
  )!
  current.value = stage(2)
  await flush()
  first.resolve({ mappingFraction: 0.1 })
  await flush()
  assert.equal(signals[0].aborted, true)
  assert.equal(resource.metrics.value?.mappingFraction, 0.7)
  revision.value++
  await flush()
  assert.equal(keys.length, 3)
  current.value = stage(3, 30)
  await flush()
  assert.equal(keys.length, 3)
  assert.equal(resource.metrics.value, null)
  scope.stop()
})

test('metric errors are local and retryable; running and malformed stages do not read files', async () => {
  const scope = effectScope()
  const current = ref(stage(1))
  let fail = true
  let calls = 0
  const resource = scope.run(() =>
    useStageMetrics(
      () => current.value,
      () => 0,
      async () => {
        calls++
        if (fail) throw new Error('报告读取失败')
        return { variantRecords: 0 }
      }
    )
  )!
  await flush()
  assert.equal(resource.error.value, '报告读取失败')
  fail = false
  await resource.reload()
  assert.equal(resource.metrics.value?.variantRecords, 0)
  current.value = { ...stage(2), status: 2 }
  await flush()
  current.value = {
    ...stage(3),
    output: { urls: null, inline: null, parseErrors: { urls: '坏 JSON' } }
  }
  await flush()
  assert.equal(calls, 2)
  scope.stop()
})
