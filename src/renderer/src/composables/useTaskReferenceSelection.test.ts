import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { effectScope } from 'vue'
import type {
  queryReferenceLibrary,
  ReferenceLibraryItem,
  ReferenceLibraryPage,
  ReferenceLibraryQuery,
  ReferenceLibraryResponse,
  ReferenceLibraryTarget
} from '../api/referenceLibrary'
import { useTaskReferenceSelection } from './useTaskReferenceSelection'

const target: ReferenceLibraryTarget = { taxId: 123, pipelineType: 100, label: '测试专项' }
const nextTarget: ReferenceLibraryTarget = { taxId: 456, pipelineType: 100, label: '其他专项' }
type Response = ReferenceLibraryResponse<ReferenceLibraryPage>

function item(referenceId: number): ReferenceLibraryItem {
  return {
    referenceId, accession: `TEST_${referenceId}`, sourceDb: null, taxId: 123,
    orgType: 0, organismName: null, genomeLength: null, segment: null,
    completeness: null, isAnnotated: false, enabled: true, fastaObjectName: null
  }
}
function result(ids: number[] = [], total = ids.length, start = 0): Response {
  return { status: 0, failMsg: null, data: { items: ids.map(item), total, start, pageSize: 100 } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

function harness(t: TestContext) {
  const calls: { query: ReferenceLibraryQuery; signal?: AbortSignal }[] = []
  const handler: { query: typeof queryReferenceLibrary } = { query: async () => result([1, 2]) }
  const scope = effectScope()
  const state = scope.run(() => useTaskReferenceSelection(async (query = {}, signal) => {
    calls.push({ query: { ...query }, signal })
    return handler.query(query, signal)
  }))!
  t.after(() => scope.stop())
  return { state, calls, handler, scope }
}

test('task reference selection requires a target, uses only enabled target context and initially selects all', async t => {
  const { state, calls, handler } = harness(t)
  assert.equal(state.ready.value, false)
  assert.equal(state.loaded.value, false)
  await state.refresh()
  assert.equal(calls.length, 0)
  handler.query = async () => {
    const response = result([1, 2])
    // Target membership is server-owned, not filtered by orgType or the target's own taxId.
    response.data!.items[1].orgType = 1
    response.data!.items[1].taxId = 789
    return response
  }
  await state.setTarget(target)
  assert.deepEqual(calls[0].query, {
    targetTaxId: 123, pipelineType: 100, enabled: true, start: 0, pageSize: 100
  })
  assert.deepEqual(state.selectedIds.value, [1, 2])
  assert.equal(state.selectedCount.value, 2)
  assert.equal(state.loaded.value, true)
  assert.equal(state.ready.value, true)
})

test('loads every page before publishing candidates or enabling submission', async t => {
  const { state, calls, handler } = harness(t)
  const tail = deferred<Response>()
  const first = Array.from({ length: 100 }, (_, index) => index + 1)
  handler.query = async query => query?.start === 0 ? result(first, 101) : tail.promise
  const loading = state.setTarget(target)
  await settle()
  assert.equal(state.loading.value, true)
  assert.equal(state.loaded.value, false)
  assert.equal(state.ready.value, false)
  assert.deepEqual(state.candidates.value, [])
  assert.deepEqual(state.selectedIds.value, [])
  assert.deepEqual(calls.map(call => call.query.start), [0, 100])
  state.selectAll()
  tail.resolve(result([101], 101, 100))
  await loading
  assert.equal(state.candidates.value.length, 101)
  assert.equal(state.selectedCount.value, 101)
  assert.equal(state.ready.value, true)
})

test('checkbox choices remain across local pages and all clearing blocks rather than restores defaults', async t => {
  const { state, handler, calls } = harness(t)
  handler.query = async () => result(Array.from({ length: 30 }, (_, i) => i + 1))
  await state.setTarget(target)
  state.setSelected(1, false)
  state.setSelected(25, false)
  state.setSelected(999, true)
  state.setSelected(2, true)
  assert.equal(state.selectedCount.value, 28)
  assert.equal(calls.length, 1)
  state.clearSelection()
  assert.deepEqual(state.selectedIds.value, [])
  assert.equal(state.ready.value, false)
  assert.match(state.validationMessage.value, /至少选择/)
  state.selectAll()
  assert.equal(state.selectedCount.value, 30)
  assert.equal(state.ready.value, true)
})

test('a successful empty result is loaded but never ready or claimed as selected all', async t => {
  const { state, handler } = harness(t)
  handler.query = async () => result()
  await state.setTarget(target)
  assert.equal(state.loaded.value, true)
  assert.equal(state.loading.value, false)
  assert.equal(state.error.value, '')
  assert.equal(state.ready.value, false)
  assert.match(state.validationMessage.value, /暂无全局启用的参考/)
})

test('business and HTTP failures block submission without fallback queries; first successful retry selects all', async t => {
  const { state, handler, calls } = harness(t)
  handler.query = async () => ({ status: 1, data: null, failMsg: '专项不可用' })
  await state.setTarget(target)
  assert.equal(state.error.value, '专项不可用')
  assert.equal(state.loaded.value, false)
  assert.equal(state.ready.value, false)
  handler.query = async () => { throw { response: { status: 500, data: '<html>Error</html>' } } }
  await state.refresh()
  assert.equal(state.error.value, '参考候选加载失败，请重试')
  assert.equal(calls.length, 2)
  handler.query = async () => result([3])
  await state.refresh()
  assert.deepEqual(state.selectedIds.value, [3])
  assert.equal(state.ready.value, true)
  assert.ok(calls.every(call => call.query.targetTaxId === 123))
})

test('a failed later page never publishes a partial list', async t => {
  const { state, handler } = harness(t)
  handler.query = async query => query?.start === 0 ? result([1], 2) :
    { status: 2, data: null, failMsg: '下一页读取失败' }
  await state.setTarget(target)
  assert.equal(state.error.value, '下一页读取失败')
  assert.equal(state.ready.value, false)
  assert.equal(state.loaded.value, false)
  assert.deepEqual(state.candidates.value, [])
  assert.deepEqual(state.selectedIds.value, [])
})

test('refresh preserves chosen IDs, new candidates remain unchecked and missing choices require explicit removal', async t => {
  const { state, handler } = harness(t)
  await state.setTarget(target)
  state.setSelected(2, false)
  handler.query = async () => result([2, 3])
  await state.refresh()
  assert.deepEqual(state.selectedIds.value, [1])
  assert.deepEqual(state.missingSelectedIds.value, [1])
  assert.equal(state.ready.value, false)
  assert.match(state.validationMessage.value, /确认移除/)
  state.selectAll()
  assert.deepEqual(state.selectedIds.value, [1, 2, 3])
  assert.equal(state.ready.value, false)
  state.removeUnavailableSelection()
  assert.deepEqual(state.selectedIds.value, [2, 3])
  assert.equal(state.ready.value, true)
})

test('failed refresh retains old choices and candidates for inspection but disables edits and submission', async t => {
  const { state, handler } = harness(t)
  await state.setTarget(target)
  state.setSelected(2, false)
  handler.query = async () => { throw new Error('network') }
  await state.refresh()
  assert.deepEqual(state.candidates.value.map(row => row.referenceId), [1, 2])
  assert.deepEqual(state.selectedIds.value, [1])
  state.clearSelection()
  state.selectAll()
  state.setSelected(1, false)
  state.removeUnavailableSelection()
  assert.deepEqual(state.selectedIds.value, [1])
  assert.equal(state.ready.value, false)
  handler.query = async () => result([1, 2, 3])
  await state.refresh()
  assert.deepEqual(state.selectedIds.value, [1])
  assert.equal(state.ready.value, true)
})

test('same target identity preserves selection; type or Tax ID changes clear and reload it', async t => {
  const { state, calls } = harness(t)
  await state.setTarget(target)
  state.clearSelection()
  await state.setTarget({ ...target, label: '更新显示名' })
  assert.equal(state.target.value?.label, '更新显示名')
  assert.deepEqual(state.selectedIds.value, [])
  assert.equal(calls.length, 1)
  await state.setTarget(nextTarget)
  assert.equal(calls.length, 2)
  assert.deepEqual(state.selectedIds.value, [1, 2])
  await state.setTarget({ taxId: 2697049, pipelineType: 101, label: '新冠' })
  assert.equal(calls.at(-1)?.query.pipelineType, 101)
  assert.equal(calls.at(-1)?.query.targetTaxId, 2697049)
})

test('switching targets aborts and ignores late success from the previous target', async t => {
  const { state, calls, handler } = harness(t)
  const old = deferred<Response>()
  handler.query = async query => query?.targetTaxId === 123 ? old.promise : result([3])
  const oldLoad = state.setTarget(target)
  await state.setTarget(nextTarget)
  assert.equal(calls[0].signal?.aborted, true)
  old.resolve(result([1]))
  await oldLoad
  assert.deepEqual(state.candidates.value.map(row => row.referenceId), [3])
  assert.deepEqual(state.selectedIds.value, [3])
  assert.equal(state.ready.value, true)
})

test('a newer refresh owns state even when an earlier failure arrives last', async t => {
  const { state, calls, handler } = harness(t)
  await state.setTarget(target)
  const old = deferred<Response>()
  handler.query = async () => old.promise
  const oldLoad = state.refresh()
  handler.query = async () => result([1, 3])
  await state.refresh()
  old.reject(new Error('late error'))
  await oldLoad
  assert.equal(calls[1].signal?.aborted, true)
  assert.equal(state.error.value, '')
  assert.deepEqual(state.candidates.value.map(row => row.referenceId), [1, 3])
  assert.equal(state.loaded.value, true)
  assert.equal(state.loading.value, false)
})

test('unsupported types and clearing the target stop queries and discard previous scope', async t => {
  const { state, calls } = harness(t)
  await state.setTarget(target)
  await state.setTarget({ ...target, pipelineType: 102 } as unknown as ReferenceLibraryTarget)
  assert.equal(state.target.value, null)
  assert.deepEqual(state.selectedIds.value, [])
  assert.deepEqual(state.candidates.value, [])
  assert.equal(state.ready.value, false)
  await state.refresh()
  await state.setTarget(null)
  assert.equal(calls.length, 1)
})

test('duplicate IDs, changing totals and incomplete pages are failures, not truncated allowlists', async t => {
  const { state, handler } = harness(t)
  const cases: [typeof queryReferenceLibrary, RegExp][] = [
    [async () => result([1, 1]), /重复/],
    [async query => query?.start === 0 ? result([1], 2) : result([2], 3, 1), /总数/],
    [async query => query?.start === 0 ? result([1], 2) : result([], 2, 1), /未完整/],
    [async () => result([1], 0), /未完整/],
    [async () => result([0]), /无效/],
    [async () => {
      const response = result([1])
      response.data!.items[0].enabled = false
      return response
    }, /未启用/],
    [async () => result([1], 1, 1), /格式/]
  ]
  for (const [query, pattern] of cases) {
    await state.setTarget(null)
    handler.query = query
    await state.setTarget(target)
    assert.match(state.error.value, pattern)
    assert.equal(state.ready.value, false)
    assert.equal(state.loaded.value, false)
    assert.deepEqual(state.selectedIds.value, [])
  }
})

test('scope disposal aborts pending loading and prevents late writes and further requests', async t => {
  const { state, scope, calls, handler } = harness(t)
  const pending = deferred<Response>()
  handler.query = async () => pending.promise
  const loading = state.setTarget(target)
  scope.stop()
  assert.equal(calls[0].signal?.aborted, true)
  pending.resolve(result([1]))
  await loading
  assert.deepEqual(state.candidates.value, [])
  assert.equal(state.ready.value, false)
  await state.refresh()
  await state.setTarget(nextTarget)
  assert.equal(calls.length, 1)
})
