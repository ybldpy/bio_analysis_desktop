import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { backendService } from './backendService'
import { requestBuildAnalysisTasks, validateEnabledReferenceIds } from './analysisPipeline'

const tasks = [{ name: '示例01', sequencingPlatform: 1001 as const }, { name: '示例02' }]

function captureRequests(t: TestContext, result: unknown = { status: 0, data: [801, 802], failMsg: '' }) {
  const calls: { url: string; body: any }[] = []
  t.mock.method(backendService, 'post', (async (url: string, body: any) => {
    calls.push({ url, body })
    return result
  }) as any)
  t.mock.method(globalThis, 'setTimeout', ((fn: () => void) => {
    fn()
    return 0
  }) as any)
  return calls
}

test('batch creation copies selected reference IDs into each virus pipelineParameters', async t => {
  const calls = captureRequests(t)
  for (const pipelineType of [100, 101]) {
    const ids = [501, 503]
    const pending = requestBuildAnalysisTasks(tasks, 123, pipelineType, {
      taxId: pipelineType === 101 ? 2697049 : 700001, enabledReferenceIds: ids
    })
    ids.push(505)
    assert.deepEqual(await pending, { status: 0, data: [801, 802], failMsg: '' })
    const { url, body } = calls.at(-1)!
    assert.equal(new URL(backendService.getUri({ url })).pathname, '/pipeline/batchCreatePipelines')
    assert.equal(body.projectId, 123)
    assert.equal(body.pipelineType, pipelineType)
    assert.equal(Object.hasOwn(body, 'enabledReferenceIds'), false)
    assert.equal(body.pipelines.length, 2)
    for (const [index, pipeline] of body.pipelines.entries()) {
      assert.equal(pipeline.pipelineName, tasks[index].name)
      assert.deepEqual(pipeline.pipelineParameters.enabledReferenceIds, [501, 503])
      assert.deepEqual(pipeline.pipelineParameters.extraParams, {})
      assert.equal(pipeline.pipelineParameters.sequencingPlatform, index === 0 ? 1001 : 0)
      assert.equal(pipeline.pipelineParameters.taxId, pipelineType === 101 ? 2697049 : 700001)
    }
    assert.notEqual(body.pipelines[0].pipelineParameters.enabledReferenceIds, ids)
    assert.notEqual(body.pipelines[0].pipelineParameters.enabledReferenceIds,
      body.pipelines[1].pipelineParameters.enabledReferenceIds)
  }
})

test('invalid explicit lists reject before any HTTP request without filtering IDs', async t => {
  const calls = captureRequests(t)
  for (const enabledReferenceIds of [[], [0], [-1], [1.5], [501, 501], [null], ['501'],
    [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1], new Array(2), '501', {}]) {
    await assert.rejects(requestBuildAnalysisTasks(tasks, 123, 100, {
      taxId: 700001, enabledReferenceIds: enabledReferenceIds as any
    }), /参考序列/)
  }
  assert.equal(calls.length, 0)
})

test('API preserves omitted and explicit-null legacy semantics for virus callers', async t => {
  const calls = captureRequests(t)
  await requestBuildAnalysisTasks(tasks, 123, 100, { taxId: 700001 })
  await requestBuildAnalysisTasks(tasks, 123, 101, { taxId: 2697049, enabledReferenceIds: null })
  assert.equal(Object.hasOwn(calls[0].body.pipelines[0].pipelineParameters, 'enabledReferenceIds'), false)
  assert.equal(calls[1].body.pipelines[0].pipelineParameters.enabledReferenceIds, null)
})

test('non-supported pipeline types never submit reference allowlists', async t => {
  const calls = captureRequests(t)
  for (const pipelineType of [102, 200, 400, 401]) {
    await requestBuildAnalysisTasks(tasks, 123, pipelineType, { referenceId: 71, enabledReferenceIds: [] })
    assert.deepEqual(calls.at(-1)!.body.pipelines[0].pipelineParameters,
      { referenceId: 71, sequencingPlatform: 1001 })
  }
})

test('business rejection preserves backend error and submitted IDs, with no fallback request', async t => {
  const failure = { status: 1, data: null, failMsg: '指定参考已停用，请重新确认' }
  const calls = captureRequests(t, failure)
  const ids = [501, 503]
  const result = await requestBuildAnalysisTasks(tasks, 123, 100, { taxId: 700001, enabledReferenceIds: ids })
  assert.equal(result, failure)
  assert.deepEqual(ids, [501, 503])
  assert.equal(calls.length, 1)
})

test('explicit UI selection validator requires a nonempty list, not default-range sentinels', () => {
  for (const ids of [undefined, null, []]) assert.throws(() => validateEnabledReferenceIds(ids), /至少/)
  assert.doesNotThrow(() => validateEnabledReferenceIds([501, Number.MAX_SAFE_INTEGER]))
})
