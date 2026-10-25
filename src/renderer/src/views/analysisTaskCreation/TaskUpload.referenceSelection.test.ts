import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as pipelineApi from '../../api/analysisPipeline'
import { setTaskUploadRequest, takeTaskUploadRequest, type TaskUploadRequest } from './taskCreationCommon'

const filename = resolve('src/renderer/src/views/analysisTaskCreation/TaskUpload.vue')
const parsed = parse(readFileSync(filename, 'utf8'), { filename })
assert.deepEqual(parsed.errors, [])
const setupCode = ts.transpileModule(compileScript(parsed.descriptor, { id: filename }).content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText

function request(): TaskUploadRequest {
  return {
    project: { pid: 123, projectName: '测试项目' } as TaskUploadRequest['project'],
    referenceGenome: null, virusTarget: { label: '测试专项', taxId: 700001, pipelineType: 100 },
    enabledReferenceIds: [501, 503], customerReferenceGenome: null, analysisType: 100,
    tasks: [{ name: '测试任务01', type: 1, sequencingPlatform: 0,
      inputSlots: [{ type: 1, r1: new File(['file selection fixture only'], 'sample.fastq'), r2: null, contigs: null }] }]
  }
}

function uploadView(input: TaskUploadRequest | null, respond?: (...args: any[]) => Promise<unknown>) {
  const calls: any[][] = []
  const errors: string[] = []
  const mounted: (() => void)[] = []
  const componentModule = { exports: {} as any }
  const realRequire = createRequire(filename)
  new Function('require', 'module', 'exports', setupCode)(
    (name: string) => {
      if (name === 'vue') return { ...vue, onMounted: (fn: () => void) => mounted.push(fn) }
      if (name === 'element-plus') return { ElMessage: { error: (message: string) => errors.push(message) } }
      if (name === './taskCreationCommon') return { takeTaskUploadRequest: () => input }
      if (name === '../../api/analysisPipeline') return {
        ...pipelineApi,
        requestBuildAnalysisTasks: async (...args: any[]) => {
          calls.push(args)
          return respond ? respond(...args) : { status: 1, data: null, failMsg: '参考列表校验失败' }
        }
      }
      return realRequire(name)
    }, componentModule, componentModule.exports
  )
  const state = componentModule.exports.default.setup({}, { expose() {}, emit() {} })
  return { state, calls, errors, mounted }
}

test('transfer context copies reference IDs while retaining selected file objects', () => {
  const input = request()
  setTaskUploadRequest(input)
  input.enabledReferenceIds!.push(999)
  const transferred = takeTaskUploadRequest()!
  assert.deepEqual(transferred.enabledReferenceIds, [501, 503])
  assert.equal(transferred.tasks[0].inputSlots[0].r1, input.tasks[0].inputSlots[0].r1)
  assert.equal(takeTaskUploadRequest(), null)
})

test('TaskUpload snapshots IDs and retains the same selection and backend error after failed creation and retry', async () => {
  const input = request()
  const { state, calls, errors } = uploadView(input)
  input.enabledReferenceIds!.push(999)
  assert.equal(await state.createTasks(), false)
  assert.equal(state.phase.value, 'creation-failed')
  assert.equal(state.creationErrorMessage.value, '参考列表校验失败')
  assert.deepEqual(state.enabledReferenceIds, [501, 503])
  assert.deepEqual(calls[0][3], { taxId: 700001, enabledReferenceIds: [501, 503] })
  calls[0][3].enabledReferenceIds.push(777)
  assert.equal(await state.createTasks(), false)
  assert.deepEqual(calls[1][3].enabledReferenceIds, [501, 503])
  assert.deepEqual(errors, ['参考列表校验失败', '参考列表校验失败'])
  assert.equal(state.tasks[0].taskAssingedId, null)
})

test('TaskUpload rejects missing, empty, duplicate, and malformed virus selections without calling creation', async t => {
  t.mock.method(console, 'error', () => {})
  for (const ids of [undefined, null, [], [501, 501], ['501'], [0]]) {
    const input = request()
    input.enabledReferenceIds = ids as any
    const { state, calls } = uploadView(input)
    assert.equal(await state.createTasks(), false)
    assert.equal(calls.length, 0)
    assert.equal(state.phase.value, 'creation-failed')
    assert.match(state.creationErrorMessage.value, /参考序列/)
  }
})

test('TaskUpload preserves JSON failMsg for HTTP errors without clearing IDs', async t => {
  t.mock.method(console, 'error', () => {})
  const { state, calls } = uploadView(request(), async () => {
    throw Object.assign(new Error('Request failed with status code 400'), {
      response: { data: { failMsg: '参考 503 已停用' } }
    })
  })
  assert.equal(await state.createTasks(), false)
  assert.equal(state.creationErrorMessage.value, '参考 503 已停用')
  assert.deepEqual(state.enabledReferenceIds, [501, 503])
  assert.equal(calls.length, 1)
})

test('TaskUpload preserves non-virus reference creation and does not forward allowlists', async () => {
  const input = request()
  input.analysisType = 200
  input.virusTarget = null
  input.referenceGenome = { refId: 71 } as TaskUploadRequest['referenceGenome']
  const { state, calls } = uploadView(input, async () => ({ status: 0, data: [801], failMsg: '' }))
  assert.equal(await state.createTasks(), true)
  assert.deepEqual(calls[0][3], { referenceId: 71 })
  assert.equal(state.tasks[0].taskAssingedId, 801)
  assert.equal(state.phase.value, 'uploading')
})

test('TaskUpload summary shows selected reference count for virus tasks', () => {
  const template = parsed.descriptor.template!.content
  assert.match(template, /v-if="isVirusAnalysis" label="本次参考范围"/)
  assert.match(template, /已选择 \{\{ enabledReferenceIds\?\.length \?\? 0 \}\} 条参考序列/)
})
