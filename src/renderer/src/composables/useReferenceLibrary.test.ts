import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { effectScope } from 'vue'
import type {
  ReferenceLibraryItem,
  ReferenceLibraryPage,
  ReferenceLibraryQuery,
  ReferenceLibraryResponse,
  ReferenceLibraryTarget
} from '../api/referenceLibrary'
import { useReferenceLibrary, type ReferenceLibraryTransport } from './useReferenceLibrary'

function item(referenceId: number, enabled = true): ReferenceLibraryItem {
  return {
    referenceId,
    accession: `REF_${referenceId}`,
    sourceDb: 'test-metadata',
    taxId: 123,
    orgType: 0,
    organismName: null,
    genomeLength: null,
    segment: null,
    completeness: null,
    isAnnotated: false,
    enabled,
    fastaObjectName: null
  }
}

const ok = <T>(data: T): ReferenceLibraryResponse<T> => ({ status: 0, data, failMsg: null })
const failure = <T>(failMsg: string): ReferenceLibraryResponse<T> => ({
  status: 1,
  data: null,
  failMsg
})
function result(
  rows: ReferenceLibraryItem[] = [],
  total = rows.length,
  start = 0,
  pageSize = 20
): ReferenceLibraryResponse<ReferenceLibraryPage> {
  return ok({ total, start, pageSize, items: rows })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

function harness(t: TestContext) {
  const calls = {
    query: [] as { query: ReferenceLibraryQuery; signal?: AbortSignal }[],
    detail: [] as { id: number; signal?: AbortSignal }[],
    mutation: [] as { id: number; enabled: boolean }[]
  }
  const handlers: ReferenceLibraryTransport = {
    query: async () => result(),
    getItem: async (id) => ok(item(id)),
    setEnabled: async (id, enabled) => ok(item(id, enabled))
  }
  const transport: ReferenceLibraryTransport = {
    query: async (query = {}, signal) => {
      calls.query.push({ query: { ...query }, signal })
      return handlers.query(query, signal)
    },
    getItem: async (id, signal) => {
      calls.detail.push({ id, signal })
      return handlers.getItem(id, signal)
    },
    setEnabled: async (id, enabled) => {
      calls.mutation.push({ id, enabled })
      return handlers.setEnabled(id, enabled)
    }
  }
  const scope = effectScope()
  const state = scope.run(() => useReferenceLibrary(transport))!
  t.after(() => scope.stop())
  return { state, handlers, calls, scope }
}

test('does not load on creation; successful empty load differs from uninitialized state', async (t) => {
  const { state, calls } = harness(t)
  assert.equal(calls.query.length, 0)
  assert.equal(state.hasLoaded.value, false)
  assert.equal(await state.refresh(), true)
  assert.deepEqual(calls.query[0].query, { orgType: 0, start: 0, pageSize: 20 })
  assert.equal(state.hasLoaded.value, true)
  assert.equal(state.total.value, 0)
  assert.deepEqual(state.items.value, [])
  assert.equal(state.listError.value, '')
})

test('submits exact trimmed filters and keeps edited filters separate from applied filters', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)], 100)
  Object.assign(state.filters, {
    taxId: ' 123 ',
    enabled: 'disabled',
    accession: ' REF_1 '
  })
  await state.search()
  const conditions = { taxId: 123, orgType: 0, enabled: false, accession: 'REF_1' }
  assert.deepEqual(calls.query[0].query, { ...conditions, start: 0, pageSize: 20 })
  Object.assign(state.filters, { taxId: 'not submitted', accession: 'EDITING' })
  await state.changePage(3)
  assert.deepEqual(calls.query[1].query, { ...conditions, start: 40, pageSize: 20 })
  await state.refresh()
  assert.deepEqual(calls.query[2].query, calls.query[1].query)
  assert.equal(state.filters.taxId, 'not submitted')
  state.filters.taxId = '124'
  await state.search()
  assert.equal(state.page.value, 1)
  assert.equal(calls.query.at(-1)?.query.taxId, 124)
  assert.equal(calls.query.at(-1)?.query.accession, 'EDITING')
})

test('rejects invalid filters and pagination locally without changing the applied query', async (t) => {
  const { state, calls, handlers } = harness(t)
  handlers.query = async () => result([item(1)], 100)
  state.filters.taxId = '123'
  await state.search()
  for (const invalid of ['0', '-1', '1.5', '1e2', '9007199254740992']) {
    state.filters.taxId = invalid
    assert.equal(await state.search(), false, invalid)
    assert.match(state.filterError.value, /Tax ID/)
  }
  state.filters.taxId = ''
  for (const invalid of ['x'.repeat(65), 'ABC\u0000DEF']) {
    state.filters.accession = invalid
    assert.equal(await state.search(), false)
    assert.match(state.filterError.value, /accession/)
  }
  for (const invalid of [0, -1, 1.5, 101, NaN, Infinity]) {
    assert.equal(await state.changePageSize(invalid), false)
  }
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.equal(await state.changePage(invalid), false)
  }
  assert.equal(calls.query.length, 1)
  assert.equal(state.page.value, 1)
  assert.equal(state.pageSize.value, 20)
  await state.refresh()
  assert.equal(calls.query.at(-1)?.query.taxId, 123)
})

test('lookup is globally unfiltered; reset returns to virus management rather than global lookup', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)], 100)
  Object.assign(state.filters, { taxId: '123', enabled: 'enabled', accession: 'OLD' })
  await state.search()
  await state.changePage(4)
  await state.lookupAccession(' NEW ')
  assert.equal(state.page.value, 1)
  assert.deepEqual(calls.query.at(-1)?.query, { accession: 'NEW', start: 0, pageSize: 20 })
  assert.deepEqual(
    { ...state.filters },
    { taxId: '', enabled: '', accession: ' NEW ' }
  )
  await state.lookupAccession(' ')
  assert.deepEqual(calls.query.at(-1)?.query, { start: 0, pageSize: 20 })
  state.filters.taxId = '123'
  await state.resetFilters()
  assert.deepEqual({ ...state.filters }, { taxId: '', enabled: '', accession: '' })
  assert.deepEqual(calls.query.at(-1)?.query, { orgType: 0, start: 0, pageSize: 20 })
  assert.equal(state.isGlobalLookup.value, false)
})

test('page size resets page; total shrink corrects the row offset and zero total returns page one', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)], 100)
  await state.changePage(4)
  await state.changePageSize(10)
  assert.equal(state.page.value, 1)
  assert.deepEqual(calls.query.at(-1)?.query, { orgType: 0, start: 0, pageSize: 10 })
  handlers.query = async (query) => result(query?.start === 20 ? [item(21)] : [], 21)
  const before = calls.query.length
  await state.changePage(9)
  assert.deepEqual(
    calls.query.slice(before).map(({ query }) => query.start),
    [80, 20]
  )
  assert.equal(state.page.value, 3)
  assert.equal(state.total.value, 21)
  assert.equal(state.items.value[0].referenceId, 21)
  handlers.query = async () => result()
  await state.refresh()
  assert.equal(state.page.value, 1)
  assert.equal(state.total.value, 0)
  assert.deepEqual(state.items.value, [])
})

test('limits pagination correction to two retries while retaining the last known data', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(99)], 200)
  await state.refresh()
  const totals = [150, 110, 70]
  handlers.query = async () => result([], totals.shift()!)
  const before = calls.query.length
  assert.equal(await state.changePage(10), false)
  assert.deepEqual(
    calls.query.slice(before).map(({ query }) => query.start),
    [180, 140, 100]
  )
  assert.match(state.listError.value, /分页校正/)
  assert.equal(state.total.value, 200)
  assert.equal(state.items.value[0].referenceId, 99)
  assert.equal(state.loading.value, false)
})

test('business, HTTP and malformed list failures never masquerade as a successful empty library', async (t) => {
  const { state, handlers } = harness(t)
  handlers.query = async () => failure('list unavailable')
  assert.equal(await state.refresh(), false)
  assert.equal(state.listError.value, 'list unavailable')
  assert.equal(state.hasLoaded.value, false)
  handlers.query = async () => result([item(5)], 5)
  await state.refresh()
  const known = state.items.value
  handlers.query = async () => {
    throw new Error('offline')
  }
  assert.equal(await state.refresh(), false)
  assert.equal(state.items.value, known)
  assert.equal(state.total.value, 5)
  assert.equal(state.hasLoaded.value, true)
  assert.ok(state.listError.value)
  handlers.query = async () => ok({ total: -1, items: [], start: 0, pageSize: 20 })
  assert.equal(await state.refresh(), false)
  assert.match(state.listError.value, /格式/)
  assert.equal(state.items.value, known)
  handlers.query = async () => ({ status: 0, data: null, failMsg: null })
  assert.equal(await state.refresh(), false)
  assert.equal(state.total.value, 5)
})

test('new list requests abort previous reads and stale responses or errors cannot overwrite state', async (t) => {
  const { state, handlers, calls } = harness(t)
  const first = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  const second = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  const third = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  const fourth = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  const responses = [first, second, third, fourth]
  handlers.query = () => responses.shift()!.promise
  const old = state.refresh()
  const current = state.refresh()
  assert.equal(calls.query[0].signal?.aborted, true)
  first.resolve(result([item(1)]))
  assert.equal(await old, false)
  assert.equal(state.loading.value, true)
  assert.deepEqual(state.items.value, [])
  second.resolve(result([item(2)], 2))
  assert.equal(await current, true)
  const pending = state.refresh()
  const newest = state.refresh()
  fourth.resolve(failure('current failure'))
  await newest
  const error = state.listError.value
  assert.equal(error, 'current failure')
  third.reject(new Error('stale failure'))
  assert.equal(await pending, false)
  assert.equal(state.listError.value, error)
  assert.equal(state.items.value[0].referenceId, 2)
})

test('detail always uses independent GET and switching records isolates late responses', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.refresh()
  const first = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  const second = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.getItem = (id) => (id === 1 ? first.promise : second.promise)
  const old = state.openDetail(1)
  assert.equal(state.detailItem.value, null)
  assert.equal(calls.detail[0].id, 1)
  const current = state.openDetail(2)
  assert.equal(calls.detail[0].signal?.aborted, true)
  first.resolve(ok(item(1)))
  await old
  assert.equal(state.detailItem.value, null)
  assert.equal(state.detailLoading.value, true)
  second.resolve(ok({ ...item(2), organismName: 'server detail' }))
  assert.equal(await current, true)
  assert.equal(state.detailItem.value?.organismName, 'server detail')
  assert.equal(state.detailId.value, 2)
  assert.equal(state.detailLoading.value, false)
})

test('detail failures preserve known same-ID data but never reuse another record', async (t) => {
  const { state, handlers } = harness(t)
  await state.openDetail(1)
  const known = state.detailItem.value
  handlers.getItem = async () => failure('detail unavailable')
  assert.equal(await state.refreshDetail(), false)
  assert.equal(state.detailItem.value, known)
  assert.equal(state.detailError.value, 'detail unavailable')
  assert.equal(await state.openDetail(2), false)
  assert.equal(state.detailItem.value, null)
  handlers.getItem = async () => ok(item(3))
  assert.equal(await state.refreshDetail(), false)
  assert.match(state.detailError.value, /格式/)
  assert.equal(state.detailItem.value, null)
  assert.equal(await state.openDetail(0), false)
  assert.equal(state.detailId.value, null)
})

test('closing detail cancels its request and ignores later completion', async (t) => {
  const { state, handlers, calls } = harness(t)
  const request = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.getItem = () => request.promise
  const pending = state.openDetail(1)
  state.closeDetail()
  assert.equal(calls.detail[0].signal?.aborted, true)
  request.resolve(ok(item(1)))
  assert.equal(await pending, false)
  assert.equal(state.detailVisible.value, false)
  assert.equal(state.detailItem.value, null)
  assert.equal(state.detailLoading.value, false)
  assert.equal(state.detailError.value, '')
})

test('toggle is non-optimistic, blocks duplicate IDs and trusts the server response before verifying', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.refresh()
  await state.openDetail(1)
  const mutation = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  const verification = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  handlers.setEnabled = () => mutation.promise
  handlers.query = () => verification.promise
  const pending = state.toggleEnabled(state.items.value[0], false)
  assert.equal(state.items.value[0].enabled, true)
  assert.equal(state.detailItem.value?.enabled, true)
  assert.equal(state.pendingIds.has(1), true)
  assert.equal(await state.toggleEnabled(item(1), false), false)
  assert.equal(calls.mutation.length, 1)
  const server = { ...item(1, false), organismName: 'updated by server' }
  mutation.resolve(ok(server))
  await settle()
  assert.equal(state.items.value[0], server)
  assert.equal(state.detailItem.value, server)
  assert.equal(state.pendingIds.has(1), true)
  assert.match(state.operationMessage.value, /禁用/)
  verification.resolve(result([server]))
  assert.equal(await pending, true)
  assert.equal(state.pendingIds.has(1), false)
  assert.equal(state.operationError.value, '')
})

test('toggle accepts disabling the only listed row and refresh removes rows outside applied filters', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  state.filters.enabled = 'enabled'
  await state.search()
  handlers.query = async () => result()
  assert.equal(await state.toggleEnabled(state.items.value[0], false), true)
  assert.deepEqual(calls.mutation, [{ id: 1, enabled: false }])
  assert.equal(calls.query.at(-1)?.query.enabled, true)
  assert.equal(state.total.value, 0)
  assert.deepEqual(state.items.value, [])
  assert.equal(state.page.value, 1)
})

test('successful toggle refresh corrects a shrunken last page', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(21)], 21)
  await state.changePage(2)
  const before = calls.query.length
  handlers.query = async (query) => result(query?.start === 0 ? [item(1)] : [], 20)
  await state.toggleEnabled(item(21), false)
  assert.deepEqual(
    calls.query.slice(before).map(({ query }) => query.start),
    [20, 0]
  )
  assert.equal(state.page.value, 1)
  assert.equal(state.total.value, 20)
})

test('toggle uses returned enabled state and permits an explicit request for the known state', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.refresh()
  handlers.setEnabled = async () => ok(item(1, true))
  assert.equal(await state.toggleEnabled(item(1, true), true), true)
  assert.deepEqual(calls.mutation[0], { id: 1, enabled: true })
  assert.equal(await state.toggleEnabled(item(1, true), false), true)
  assert.equal(state.items.value[0].enabled, true)
  assert.match(state.operationMessage.value, /启用/)
})

test('failed mutation keeps known state and verifies both current query and same-ID detail', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.refresh()
  await state.openDetail(1)
  const verifyList = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  const verifyDetail = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.setEnabled = async () => failure('could not commit')
  handlers.query = () => verifyList.promise
  handlers.getItem = () => verifyDetail.promise
  const pending = state.toggleEnabled(item(1), false)
  await settle()
  assert.equal(state.items.value[0].enabled, true)
  assert.equal(state.detailItem.value?.enabled, true)
  assert.equal(state.pendingIds.has(1), true)
  assert.match(state.operationError.value, /could not commit/)
  assert.equal(state.operationMessage.value, '')
  assert.equal(calls.query.length, 2)
  assert.equal(calls.detail.length, 2)
  verifyList.resolve(result([item(1, false)]))
  verifyDetail.resolve(ok(item(1, false)))
  assert.equal(await pending, false)
  assert.equal(state.items.value[0].enabled, false)
  assert.equal(state.detailItem.value?.enabled, false)
  assert.equal(state.pendingIds.has(1), false)
  assert.match(state.operationError.value, /could not commit/)
})

test('mutation, list verification and detail verification errors remain distinct', async (t) => {
  const { state, handlers } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.refresh()
  await state.openDetail(1)
  handlers.setEnabled = async () => {
    throw { isAxiosError: true, response: { data: { failMsg: 'mutation offline' } } }
  }
  handlers.query = async () => failure('list offline')
  handlers.getItem = async () => failure('detail offline')
  assert.equal(await state.toggleEnabled(item(1), false), false)
  assert.match(state.operationError.value, /mutation offline/)
  assert.equal(state.listError.value, 'list offline')
  assert.equal(state.detailError.value, 'detail offline')
  assert.equal(state.items.value[0].enabled, true)
  assert.equal(state.detailItem.value?.enabled, true)
  assert.equal(state.total.value, 1)
  assert.equal(state.pendingIds.size, 0)
})

test('malformed successful mutation is treated as uncertain and verified rather than applied', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.refresh()
  handlers.setEnabled = async () => ok(item(2, false))
  assert.equal(await state.toggleEnabled(item(1), false), false)
  assert.match(state.operationError.value, /有效状态/)
  assert.equal(state.items.value[0].referenceId, 1)
  assert.equal(calls.query.length, 2)
})

test('successful mutation invalidates an older matching detail GET', async (t) => {
  const { state, handlers, calls } = harness(t)
  const oldDetail = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.getItem = () => oldDetail.promise
  const pendingDetail = state.openDetail(1)
  handlers.query = async () => result([item(1, false)])
  await state.toggleEnabled(item(1), false)
  assert.equal(calls.detail[0].signal?.aborted, true)
  assert.equal(state.detailItem.value?.enabled, false)
  oldDetail.resolve(ok(item(1, true)))
  assert.equal(await pendingDetail, false)
  assert.equal(state.detailItem.value?.enabled, false)
  assert.equal(state.detailLoading.value, false)
})

test('different IDs may mutate concurrently without allowing same-ID duplication', async (t) => {
  const { state, handlers, calls } = harness(t)
  const first = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  const second = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.setEnabled = (id) => (id === 1 ? first.promise : second.promise)
  const pendingFirst = state.toggleEnabled(item(1), false)
  const pendingSecond = state.toggleEnabled(item(2), false)
  assert.deepEqual([...state.pendingIds].sort(), [1, 2])
  assert.equal(await state.toggleEnabled(item(2), true), false)
  first.resolve(failure('first failure'))
  await pendingFirst
  assert.deepEqual([...state.pendingIds], [2])
  second.resolve(failure('second failure'))
  await pendingSecond
  assert.match(state.operationError.value, /first failure/)
  assert.match(state.operationError.value, /second failure/)
  assert.equal(calls.mutation.length, 2)
  assert.equal(state.pendingIds.size, 0)
})

test('scope disposal aborts independent reads and ignores late responses and cleanup writes', async (t) => {
  const { state, handlers, calls, scope } = harness(t)
  const list = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  const detail = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.query = () => list.promise
  handlers.getItem = () => detail.promise
  const pendingList = state.refresh()
  const pendingDetail = state.openDetail(1)
  scope.stop()
  assert.equal(calls.query[0].signal?.aborted, true)
  assert.equal(calls.detail[0].signal?.aborted, true)
  list.resolve(result([item(1)]))
  detail.resolve(ok(item(1)))
  assert.equal(await pendingList, false)
  assert.equal(await pendingDetail, false)
  assert.deepEqual(state.items.value, [])
  assert.equal(state.detailItem.value, null)
  assert.equal(state.hasLoaded.value, false)
  // Disposal intentionally leaves the abandoned state untouched, including finally blocks.
  assert.equal(state.loading.value, true)
  assert.equal(state.detailLoading.value, true)
  assert.equal(await state.refresh(), false)
  assert.equal(await state.openDetail(2), false)
  assert.equal(calls.query.length, 1)
  assert.equal(calls.detail.length, 1)
})

test('an already submitted mutation is not canceled, but disposal forbids subsequent UI writes or verification', async (t) => {
  const { state, handlers, calls, scope } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.refresh()
  await state.openDetail(1)
  const mutation = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.setEnabled = () => mutation.promise
  const pending = state.toggleEnabled(item(1), false)
  scope.stop()
  mutation.resolve(ok(item(1, false)))
  assert.equal(await pending, false)
  assert.equal(calls.mutation.length, 1)
  assert.equal(calls.query.length, 1)
  assert.equal(calls.detail.length, 1)
  assert.equal(state.items.value[0].enabled, true)
  assert.equal(state.detailItem.value?.enabled, true)
  assert.equal(state.operationMessage.value, '')
  assert.equal(state.operationError.value, '')
  assert.equal(state.pendingIds.has(1), true)
})

const firstTarget: ReferenceLibraryTarget = { taxId: 700001, pipelineType: 100, label: '专项一' }
const secondTarget: ReferenceLibraryTarget = { taxId: 700002, pipelineType: 100, label: '专项二' }

test('target management keeps paired context and fixed virus category for search, paging and mutation verification', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)], 100)
  await state.selectTarget(firstTarget)
  Object.assign(state.filters, { taxId: '123', enabled: 'disabled', accession: ' REF_1 ' })
  await state.search()
  await state.changePage(3)
  await state.toggleEnabled(item(1), false)
  const context = { targetTaxId: 700001, pipelineType: 100, orgType: 0 }
  assert.deepEqual(calls.query[0].query, { ...context, start: 0, pageSize: 20 })
  const filtered = { ...context, taxId: 123, enabled: false, accession: 'REF_1' }
  assert.deepEqual(calls.query[1].query, { ...filtered, start: 0, pageSize: 20 })
  assert.deepEqual(calls.query[2].query, { ...filtered, start: 40, pageSize: 20 })
  assert.deepEqual(calls.query[3].query, calls.query[2].query)
  assert.equal(state.isGlobalLookup.value, false)
  assert.equal('orgType' in state.filters, false)
})

test('target change clears old results, detail, errors and filters before requesting the new scope', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)], 100)
  await state.selectTarget(firstTarget)
  await state.changePage(4)
  await state.openDetail(1)
  Object.assign(state.filters, { taxId: '123', enabled: 'disabled', accession: 'OLD' })
  state.operationError.value = 'old operation error'
  state.operationMessage.value = 'old operation success'
  state.listError.value = 'old read error'
  state.filterError.value = 'old form error'
  const next = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  handlers.query = () => next.promise
  const pending = state.selectTarget(secondTarget)
  assert.deepEqual(state.items.value, [])
  assert.equal(state.total.value, 0)
  assert.equal(state.page.value, 1)
  assert.equal(state.hasLoaded.value, false)
  assert.equal(state.loading.value, true)
  assert.equal(state.detailVisible.value, false)
  assert.equal(state.detailId.value, null)
  assert.equal(state.detailItem.value, null)
  assert.equal(state.operationError.value, '')
  assert.equal(state.operationMessage.value, '')
  assert.equal(state.listError.value, '')
  assert.equal(state.filterError.value, '')
  assert.deepEqual({ ...state.filters }, { taxId: '', enabled: '', accession: '' })
  assert.deepEqual(calls.query.at(-1)?.query, {
    targetTaxId: 700002, pipelineType: 100, orgType: 0, start: 0, pageSize: 20
  })
  next.resolve(failure('new target unavailable'))
  assert.equal(await pending, false)
  assert.equal(state.hasLoaded.value, false)
  assert.deepEqual(state.items.value, [])
  assert.equal(state.listError.value, 'new target unavailable')
  // A failure has no automatic whole-library fallback.
  assert.equal(calls.query.length, 3)
})

test('target identity includes pipelineType even when taxId is shared', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.selectTarget({ taxId: 2697049, pipelineType: 100, label: '通用目标' })
  await state.selectTarget({ taxId: 2697049, pipelineType: 101, label: '专项目标' })
  assert.deepEqual(calls.query.map(({ query }) => [query.targetTaxId, query.pipelineType]), [
    [2697049, 100], [2697049, 101]
  ])
  assert.equal(state.selectedTarget.value?.pipelineType, 101)
  await state.selectTarget(null)
  assert.equal(state.selectedTarget.value, null)
  assert.deepEqual(calls.query.at(-1)?.query, { orgType: 0, start: 0, pageSize: 20 })
})

test('late list and detail reads cannot restore the previous target after switching', async (t) => {
  const { state, handlers, calls } = harness(t)
  const oldList = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  const oldDetail = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  const current = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  handlers.query = (query) => query?.targetTaxId === 700001 ? oldList.promise : current.promise
  handlers.getItem = () => oldDetail.promise
  const firstRead = state.selectTarget(firstTarget)
  const detailRead = state.openDetail(1)
  const currentRead = state.selectTarget(secondTarget)
  assert.equal(calls.query[0].signal?.aborted, true)
  assert.equal(calls.detail[0].signal?.aborted, true)
  oldList.resolve(result([item(1)]))
  oldDetail.reject(new Error('old detail failed'))
  assert.equal(await firstRead, false)
  assert.equal(await detailRead, false)
  assert.equal(state.loading.value, true)
  assert.equal(state.detailError.value, '')
  assert.equal(state.detailItem.value, null)
  assert.deepEqual(state.items.value, [])
  current.resolve(result([item(2)]))
  assert.equal(await currentRead, true)
  assert.equal(state.items.value[0].referenceId, 2)
})

test('global verification omits all scope restrictions but preserves the selected upload target', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)], 100)
  await state.selectTarget(firstTarget)
  Object.assign(state.filters, { taxId: '123', enabled: 'enabled', accession: 'OLD' })
  await state.search()
  await state.lookupAccession(' LOOKUP ')
  assert.equal(state.isGlobalLookup.value, true)
  assert.deepEqual(state.selectedTarget.value, firstTarget)
  assert.deepEqual(calls.query.at(-1)?.query, { accession: 'LOOKUP', start: 0, pageSize: 20 })
  await state.changePage(2)
  assert.deepEqual(calls.query.at(-1)?.query, { accession: 'LOOKUP', start: 20, pageSize: 20 })
  await state.refresh()
  assert.deepEqual(calls.query.at(-1)?.query, { accession: 'LOOKUP', start: 20, pageSize: 20 })
  await state.lookupAccession(' ')
  assert.deepEqual(calls.query.at(-1)?.query, { start: 0, pageSize: 20 })
  assert.equal(state.isGlobalLookup.value, true)
  await state.returnToManagement()
  assert.equal(state.isGlobalLookup.value, false)
  assert.deepEqual(state.selectedTarget.value, firstTarget)
  assert.deepEqual(calls.query.at(-1)?.query, {
    targetTaxId: 700001, pipelineType: 100, orgType: 0, start: 0, pageSize: 20
  })
  assert.deepEqual({ ...state.filters }, { taxId: '', enabled: '', accession: '' })
})

test('search and reset leave global lookup for the selected management scope', async (t) => {
  const { state, calls } = harness(t)
  await state.selectTarget(firstTarget)
  await state.lookupAccession('OLD')
  state.filters.accession = ' NEW '
  state.filters.enabled = 'disabled'
  await state.search()
  assert.equal(state.isGlobalLookup.value, false)
  assert.deepEqual(calls.query.at(-1)?.query, {
    targetTaxId: 700001, pipelineType: 100, orgType: 0,
    accession: 'NEW', enabled: false, start: 0, pageSize: 20
  })
  await state.lookupAccession('OLD')
  await state.resetFilters()
  assert.equal(state.isGlobalLookup.value, false)
  assert.deepEqual(calls.query.at(-1)?.query, {
    targetTaxId: 700001, pipelineType: 100, orgType: 0, start: 0, pageSize: 20
  })
})

test('late global lookup cannot overwrite current target results or restore global mode', async (t) => {
  const { state, handlers, calls } = harness(t)
  await state.selectTarget(firstTarget)
  const lookup = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  handlers.query = () => lookup.promise
  const pending = state.lookupAccession('REF_1')
  handlers.query = async () => result([item(2)])
  await state.selectTarget(secondTarget)
  assert.equal(calls.query[1].signal?.aborted, true)
  lookup.resolve(result([item(1)]))
  assert.equal(await pending, false)
  assert.equal(state.isGlobalLookup.value, false)
  assert.equal(state.items.value[0].referenceId, 2)
  assert.deepEqual(state.selectedTarget.value, secondTarget)
})

test('a late enablement success re-reads shared records in the current target without applying old response rows', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.selectTarget(firstTarget)
  const mutation = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.setEnabled = () => mutation.promise
  const pending = state.toggleEnabled(item(1), false)
  await state.selectTarget(secondTarget)
  await state.openDetail(1)
  assert.equal(state.pendingIds.has(1), true)
  assert.equal(await state.toggleEnabled(item(1), true), false)
  const queryCount = calls.query.length
  const detailCount = calls.detail.length
  const verifyList = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  const verifyDetail = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.query = () => verifyList.promise
  handlers.getItem = () => verifyDetail.promise
  mutation.resolve(ok({ ...item(1, false), organismName: 'old mutation response' }))
  await settle()
  assert.equal(calls.query.length, queryCount + 1)
  assert.deepEqual(calls.query.at(-1)?.query, {
    targetTaxId: secondTarget.taxId, pipelineType: secondTarget.pipelineType,
    orgType: 0, start: 0, pageSize: 20
  })
  assert.equal(calls.detail.length, detailCount + 1)
  assert.equal(state.items.value[0].enabled, true, 'wait for current-scope verification')
  assert.equal(state.detailItem.value?.enabled, true)
  assert.equal(state.pendingIds.has(1), true)
  verifyList.resolve(result([{ ...item(1, false), organismName: 'fresh list' }]))
  verifyDetail.resolve(ok({ ...item(1, false), organismName: 'fresh detail' }))
  assert.equal(await pending, false)
  assert.equal(calls.mutation.length, 1)
  assert.equal(state.items.value[0].enabled, false)
  assert.equal(state.items.value[0].organismName, 'fresh list')
  assert.equal(state.detailItem.value?.enabled, false)
  assert.equal(state.detailItem.value?.organismName, 'fresh detail')
  assert.equal(state.operationError.value, '')
  assert.equal(state.operationMessage.value, '')
  assert.equal(state.pendingIds.has(1), false)
})

test('a late mutation failure verifies current global lookup without restoring target filters or old errors', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.selectTarget(firstTarget)
  const mutation = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.setEnabled = () => mutation.promise
  const pending = state.toggleEnabled(item(1), false)
  await state.lookupAccession('CHECK')
  await state.openDetail(1)
  const queryCount = calls.query.length
  handlers.query = async () => result([item(1, false)])
  handlers.getItem = async () => ok(item(1, false))
  mutation.reject(new Error('old mutation error'))
  assert.equal(await pending, false)
  assert.equal(calls.query.length, queryCount + 1)
  assert.deepEqual(calls.query.at(-1)?.query, { accession: 'CHECK', start: 0, pageSize: 20 })
  assert.equal(state.items.value[0].enabled, false)
  assert.equal(state.detailItem.value?.enabled, false)
  assert.equal(state.operationError.value, '')
  assert.equal(state.pendingIds.size, 0)
  assert.equal(state.isGlobalLookup.value, true)
})

test('cross-target mutation verification failures release the record lock and show current read errors only', async (t) => {
  const { state, handlers } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.selectTarget(firstTarget)
  const mutation = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.setEnabled = () => mutation.promise
  const pending = state.toggleEnabled(item(1), false)
  await state.selectTarget(secondTarget)
  await state.openDetail(1)
  handlers.query = async () => failure('current list unavailable')
  handlers.getItem = async () => failure('current detail unavailable')
  mutation.reject(new Error('old mutation failure'))
  assert.equal(await pending, false)
  assert.equal(state.pendingIds.has(1), false)
  assert.equal(state.listError.value, 'current list unavailable')
  assert.equal(state.detailError.value, 'current detail unavailable')
  assert.equal(state.operationError.value, '')
  assert.equal(state.operationMessage.value, '')
  assert.equal(state.items.value[0].enabled, true)
})

test('a failed old-scope enablement can have committed and fresh target reads recover the shared state', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.selectTarget(firstTarget)
  const mutation = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.setEnabled = () => mutation.promise
  const pending = state.toggleEnabled(item(1), false)
  await state.selectTarget(secondTarget)
  await state.openDetail(1)
  handlers.query = async () => result([item(1, false)])
  handlers.getItem = async () => ok(item(1, false))
  mutation.reject(new Error('network disconnected after commit'))
  assert.equal(await pending, false)
  assert.equal(calls.query.at(-1)?.query.targetTaxId, secondTarget.taxId)
  assert.equal(state.items.value[0].enabled, false)
  assert.equal(state.detailItem.value?.enabled, false)
  assert.equal(state.pendingIds.has(1), false)
  assert.equal(state.operationError.value, '')
  assert.equal(state.operationMessage.value, '')
})

test('cross-target mutation verification remains cancellable by another target selection', async (t) => {
  const { state, handlers, calls } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.selectTarget(firstTarget)
  const mutation = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.setEnabled = () => mutation.promise
  const pending = state.toggleEnabled(item(1), false)
  await state.selectTarget(secondTarget)
  await state.openDetail(1)
  const verifyList = deferred<ReferenceLibraryResponse<ReferenceLibraryPage>>()
  const verifyDetail = deferred<ReferenceLibraryResponse<ReferenceLibraryItem>>()
  handlers.query = () => verifyList.promise
  handlers.getItem = () => verifyDetail.promise
  mutation.resolve(ok(item(1, false)))
  await settle()
  const listSignal = calls.query.at(-1)?.signal
  const detailSignal = calls.detail.at(-1)?.signal
  handlers.query = async () => result([item(2)])
  await state.selectTarget(firstTarget)
  assert.equal(listSignal?.aborted, true)
  assert.equal(detailSignal?.aborted, true)
  verifyList.resolve(result([item(1, false)]))
  verifyDetail.resolve(ok(item(1, false)))
  assert.equal(await pending, false)
  assert.equal(state.items.value[0].referenceId, 2)
  assert.equal(state.detailItem.value, null)
  assert.equal(state.pendingIds.has(1), false)
  assert.equal(state.operationMessage.value, '')
})

test('same-target refresh failure retains data; selecting a different target never retains it', async (t) => {
  const { state, handlers } = harness(t)
  handlers.query = async () => result([item(1)])
  await state.selectTarget(firstTarget)
  const known = state.items.value
  handlers.query = async () => failure('not available')
  await state.refresh()
  assert.equal(state.items.value, known)
  assert.equal(state.hasLoaded.value, true)
  await state.selectTarget(secondTarget)
  assert.deepEqual(state.items.value, [])
  assert.equal(state.hasLoaded.value, false)
})
