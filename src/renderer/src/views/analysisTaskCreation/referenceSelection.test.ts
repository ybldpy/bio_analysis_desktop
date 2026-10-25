import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import type { ReferenceLibraryItem, ReferenceLibraryQuery, ReferenceLibraryResponse, ReferenceLibraryPage } from '../../api/referenceLibrary'
import type { VirusTarget } from '../../api/analysisPipeline'
import { useTaskReferenceSelection } from '../../composables/useTaskReferenceSelection'
import type { TaskUploadRequest } from './taskCreationCommon'

const filename = resolve('src/renderer/src/views/analysisTaskCreation/index.vue')
const parsed = parse(readFileSync(filename, 'utf8'), { filename })
assert.deepEqual(parsed.errors, [])
// Compile the real template too; interaction tests below expose setup state.
compileScript(parsed.descriptor, { id: filename, inlineTemplate: true })
const compiled = ts.transpileModule(compileScript(parsed.descriptor, { id: filename }).content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText
const regular: VirusTarget = { taxId: 2697049, pipelineType: 100, label: '常规测试专项' }
const covid: VirusTarget = { taxId: 2697049, pipelineType: 101, label: '新冠测试专项' }
type Response = ReferenceLibraryResponse<ReferenceLibraryPage>

function page(ids = [501, 503], total = ids.length, start = 0): Response {
  return { status: 0, failMsg: null, data: {
    total, start, pageSize: 100,
    items: ids.map(referenceId => ({
      referenceId, accession: `TEST_${referenceId}`, sourceDb: null, taxId: 2697049, orgType: 0,
      organismName: '显示夹具', genomeLength: null, segment: null, completeness: null,
      isAnnotated: false, enabled: true, fastaObjectName: null
    } satisfies ReferenceLibraryItem))
  } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const settle = () => new Promise<void>(yes => setImmediate(yes))

function setup(t: TestContext) {
  const queries: ReferenceLibraryQuery[] = []
  const warnings: string[] = []
  const events: unknown[][] = []
  const requests: TaskUploadRequest[] = []
  const handler = {
    query: async (_query: ReferenceLibraryQuery): Promise<Response> => page(),
    targets: async () => ({ status: 0, failMsg: '', data: [regular, covid] })
  }
  const realRequire = createRequire(filename)
  const componentModule = { exports: {} as any }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name === 'vue') return { ...vue, onBeforeMount() {} }
    if (name === 'element-plus') return { ElMessage: { warning: (msg: string) => warnings.push(msg) }, genFileId: () => 1 }
    if (name === '../../api/analysisPipeline') return { ...realRequire(name), fetchVirusTargets: () => handler.targets() }
    if (name === '../../components/referenceLibrary/TaskReferenceSelection.vue') return { __esModule: true, default: {} }
    if (name === '../../composables/useTaskReferenceSelection') return {
      useTaskReferenceSelection: () => useTaskReferenceSelection(async (query = {}) => {
        queries.push({ ...query })
        return handler.query(query)
      })
    }
    if (name === './taskCreationCommon') return { setTaskUploadRequest: (request: TaskUploadRequest) => requests.push(request) }
    return realRequire(name)
  }, componentModule, componentModule.exports)
  const scope = vue.effectScope()
  const state = scope.run(() => componentModule.exports.default.setup({}, {
    expose() {}, emit: (...args: unknown[]) => events.push(args)
  }))
  t.after(() => scope.stop())
  return { state, handler, queries, requests, warnings, events }
}

async function prepare(state: any) {
  state.batchNamePrefix.value = 'batch'
  state.analysisTasksBuildJob.projectId = 7
  state.projectList.value = [{ pid: 7, projectName: '测试项目', description: '' }]
  state.pipelineTypeSelection.typeId = 'virus'
  await state.loadVirusTargets()
  state.activeTask.value.inputSlots[0].type = 1
  const raw = new File(['filename-only fixture'], 'sample.fastq')
  state.activeTask.value.inputSlots[0].r1.push({ name: raw.name, raw })
  state.activeSectionId.value = state.sectionMap.virusTargetSelection
}

test('selecting a target loads enabled references and advances only after a complete selection', async t => {
  const { state, queries } = setup(t)
  await prepare(state)
  assert.equal(queries.length, 0)
  assert.equal(state.checkCurrentSectionSatisfied(state.sectionMap.virusTargetSelection).satisfied, false)
  state.selectVirusTarget(regular)
  assert.equal(state.referenceSelectionReady.value, false)
  await settle()
  assert.deepEqual(queries, [{ targetTaxId: 2697049, pipelineType: 100, enabled: true, start: 0, pageSize: 100 }])
  assert.deepEqual(state.enabledReferenceIds.value, [501, 503])
  assert.equal(state.referenceSelectionReady.value, true)
  state.next()
  assert.equal(state.activeSectionId.value, state.sectionMap.taskCreate)
})

test('same taxId with a different pipelineType clears selection immediately and ignores late responses', async t => {
  const { state, handler, queries } = setup(t)
  await prepare(state)
  const old = deferred<Response>()
  const current = deferred<Response>()
  handler.query = query => query.pipelineType === 100 ? old.promise : current.promise
  state.selectVirusTarget(regular)
  state.selectVirusTarget(covid)
  assert.equal(state.selectedVirusTarget.value.pipelineType, 101)
  assert.deepEqual(state.enabledReferenceIds.value, [])
  assert.equal(state.referenceSelectionReady.value, false)
  current.resolve(page([701]))
  await settle()
  old.resolve(page([501, 503]))
  await settle()
  assert.deepEqual(queries.map(query => query.pipelineType), [100, 101])
  assert.deepEqual(state.enabledReferenceIds.value, [701])
  assert.deepEqual(state.referenceCandidates.value.map(row => row.referenceId), [701])
})

test('batch submission copies current selected IDs even when all defaults are selected', async t => {
  const { state, requests, events } = setup(t)
  await prepare(state)
  state.selectVirusTarget(regular)
  await settle()
  state.submit()
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].enabledReferenceIds, [501, 503])
  assert.deepEqual(events, [['upload']])
  state.clearReferenceSelection()
  assert.deepEqual(requests[0].enabledReferenceIds, [501, 503], 'transferred IDs cannot be changed by editing the form')
})

test('deselections persist across steps and only selected IDs are transferred for the whole batch', async t => {
  const { state, requests } = setup(t)
  await prepare(state)
  state.selectVirusTarget(regular)
  await settle()
  state.setReferenceSelected(501, false)
  state.next()
  state.moveSectionBackward()
  assert.deepEqual(state.enabledReferenceIds.value, [503])
  state.next()
  state.addTask()
  state.activeTask.value.inputSlots[0].type = 1
  const raw = new File(['filename fixture'], 'second.fastq')
  state.activeTask.value.inputSlots[0].r1.push({ name: raw.name, raw })
  state.next()
  assert.equal(state.activeSectionId.value, state.sectionMap.comfirmation)
  state.submit()
  assert.equal(requests[0].tasks.length, 2)
  assert.deepEqual(requests[0].enabledReferenceIds, [503])
})

test('clear all blocks both the target step and final submission without fallback', async t => {
  const { state, requests, warnings } = setup(t)
  await prepare(state)
  state.selectVirusTarget(regular)
  await settle()
  state.clearReferenceSelection()
  state.next()
  assert.equal(state.activeSectionId.value, state.sectionMap.virusTargetSelection)
  state.submit()
  assert.equal(requests.length, 0)
  assert.ok(warnings.every(message => /至少选择/.test(message)))
  state.selectAllReferences()
  state.submit()
  assert.deepEqual(requests[0].enabledReferenceIds, [501, 503])
})

test('partial pagination, load errors and empty candidates cannot create a task', async t => {
  const { state, handler, requests, queries } = setup(t)
  await prepare(state)
  const tail = deferred<Response>()
  handler.query = query => query.start === 0 ? Promise.resolve(page([501], 2)) : tail.promise
  state.selectVirusTarget(regular)
  await settle()
  state.submit()
  assert.equal(requests.length, 0)
  assert.deepEqual(queries.map(query => query.start), [0, 1])
  tail.resolve({ status: 1, data: null, failMsg: '候选读取失败' })
  await settle()
  state.submit()
  assert.equal(requests.length, 0)
  assert.equal(state.referenceCandidatesError.value, '候选读取失败')
  handler.query = async () => page([])
  await state.refreshReferenceCandidates()
  state.submit()
  assert.equal(requests.length, 0)
  assert.match(state.referenceSelectionMessage.value, /暂无全局启用/)
})

test('switching away from virus clears local references and non-virus submission has no allowlist', async t => {
  const { state, queries, requests } = setup(t)
  await prepare(state)
  state.selectVirusTarget(regular)
  await settle()
  state.pipelineTypeSelection.typeId = 'bacteria'
  assert.deepEqual(state.enabledReferenceIds.value, [])
  assert.deepEqual(state.referenceCandidates.value, [])
  state.submit()
  assert.equal(requests[0].analysisType, 200)
  assert.equal(Object.hasOwn(requests[0], 'enabledReferenceIds'), false)
  assert.equal(queries.length, 1)
})

test('catalogue refresh retains same-context choices and excludes unsupported 102 targets', async t => {
  const { state, handler, queries } = setup(t)
  await prepare(state)
  state.selectVirusTarget(regular)
  await settle()
  state.setReferenceSelected(501, false)
  handler.targets = async () => ({ status: 0, failMsg: '', data: [
    { ...regular, label: '更新后的名称' }, covid,
    { taxId: 42, pipelineType: 102, label: '未接入类型' } as unknown as VirusTarget
  ] })
  await state.loadVirusTargets()
  assert.deepEqual(state.enabledReferenceIds.value, [503])
  assert.equal(queries.length, 1)
  assert.equal(state.virusTargets.value.length, 2)
  handler.targets = async () => ({ status: 0, failMsg: '', data: [covid] })
  await state.loadVirusTargets()
  assert.equal(state.selectedVirusTarget.value, null)
  assert.deepEqual(state.enabledReferenceIds.value, [])
  assert.equal(state.referenceSelectionReady.value, false)
})
