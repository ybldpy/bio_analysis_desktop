import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as pipelineApi from '../api/analysisPipeline'

const filename = resolve('src/renderer/src/views/TaskDetailView.vue')
const parsed = parse(readFileSync(filename, 'utf8'), { filename })
assert.deepEqual(parsed.errors, [])
const compiled = ts.transpileModule(
  compileScript(parsed.descriptor, { id: 'task-detail-test' }).content,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }
).outputText

const stage = (stageId: number, stageType = 44, status = 4) => ({
  stageId, stageType, status, stageName: `Stage ${stageId}`, startTime: null,
  output: { urls: null, inline: null }
})
const pipeline = (id: number, pipelineType = 100) => ({
  pipelineId: id, pipelineType, analysisPipelineName: `Pipeline ${id}`, createTime: new Date(), status: 1
})

function deferred() {
  let resolve!: (value: any) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await vue.nextTick()
}

function setup(
  requestPipeline: (id: number, signal: AbortSignal) => Promise<any> = async id => pipeline(id),
  requestPipelineStages: (id: number, signal: AbortSignal) => Promise<any[]> = async () => []
) {
  const events: any[] = []
  const errors: unknown[] = []
  const mounted: (() => void)[] = []
  const unmounted: (() => void)[] = []
  let poll: (() => void) | undefined
  let timerCleared = false
  const instances: any[] = []
  class Graph {
    nodes = new Map<string, any>()
    edges: any[] = []
    disposed = false
    static registerNode() {}
    constructor() { instances.push(this) }
    use() {}
    addNode(config: any) {
      const cell = { ...config, isNode: () => true, attr: (attrs: any) => { cell.attrs = attrs } }
      this.nodes.set(config.id, cell)
      return cell
    }
    addEdge(config: any) { this.edges.push(config) }
    getCellById(id: string) { return this.nodes.get(id) }
    on() {}
    resetSelection() {}
    zoomToFit() {}
    dispose() { this.disposed = true }
  }
  const realRequire = createRequire(filename)
  const componentModule = { exports: {} as any }
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', compiled)(
    (name: string) => {
      if (name === 'vue') return {
        ...vue,
        onMounted: (fn: () => void) => mounted.push(fn),
        onBeforeUnmount: (fn: () => void) => unmounted.push(fn)
      }
      if (name === '../api/analysisPipeline') return { ...pipelineApi, requestPipeline, requestPipelineStages }
      if (name === '../common/analysisPipeline.js') return { getAnalysisPipelineTypeName: () => '测试分析' }
      if (name === '@antv/x6') return { Graph, Selection: class {} }
      if (name === 'element-plus') return { ElMessage: { error: (error: unknown) => errors.push(error) } }
      return realRequire(name)
    },
    componentModule, componentModule.exports,
    (fn: () => void) => { poll = fn; return 1 },
    () => { timerCleared = true }
  )
  const props = vue.reactive({ pipelineId: 1 })
  const scope = vue.effectScope()
  const state = scope.run(() => componentModule.exports.default.setup(props, {
    expose() {}, emit: (...args: any[]) => events.push(args)
  }))
  mounted.forEach(fn => fn())
  return {
    state, props, events, errors, instances,
    poll: () => poll?.(),
    unmount: () => { unmounted.forEach(fn => fn()); scope.stop() },
    get timerCleared() { return timerCleared }
  }
}

test('empty stage lists load successfully and both result links preserve task context', async () => {
  const page = setup()
  await flush()
  assert.equal(page.state.pipelineLoading.value, false)
  assert.equal(page.state.initPipelineAndStagesFailed.value, false)
  assert.equal(page.state.currentFocusStage.value, null)
  page.state.openResults()
  page.state.openResults(12)
  assert.deepEqual(page.events, [
    ['view-results', { pipelineId: 1 }],
    ['view-results', { pipelineId: 1, stageId: 12 }]
  ])
  page.unmount()
  assert.equal(page.timerCleared, true)
})

test('same-status refresh replaces metadata, preserves focus, and accepts added or removed stages', async () => {
  let stages: any[] = [stage(1), stage(2)]
  const page = setup(undefined, async () => stages)
  await flush()
  page.state.currentFocusStage.value = page.state.pipelineStages.value[1]
  const endTime = new Date('2026-01-01T12:00:00Z')
  stages = [stage(1), { ...stage(2), stageName: 'Renamed', endTime, output: { inline: { version: 2 }, urls: null } }, stage(3)]
  await page.state.refreshPipeline(false)
  assert.equal(page.state.currentFocusStage.value.stageId, 2)
  assert.equal(page.state.currentFocusStage.value.stageName, 'Renamed')
  assert.equal(page.state.currentFocusStage.value.output.inline.version, 2)
  assert.equal(page.state.currentFocusStage.value.endTime.getTime(), endTime.getTime())
  assert.equal(page.state.pipelineStages.value.length, 3)
  stages = [stage(3)]
  await page.state.refreshPipeline(false)
  assert.equal(page.state.currentFocusStage.value.stageId, 3)
  assert.equal(page.state.initPipelineAndStagesFailed.value, false)
  page.unmount()
})

test('switching tasks aborts stale requests and unmount cancels in-flight work', async () => {
  const requests: { id: number; signal: AbortSignal; job: ReturnType<typeof deferred> }[] = []
  const page = setup((id: number, signal: AbortSignal) => {
    const job = deferred()
    requests.push({ id, signal, job })
    return job.promise
  }, async () => [stage(1)])
  page.props.pipelineId = 2
  await flush()
  assert.equal(requests[0].signal.aborted, true)
  requests[1].job.resolve(pipeline(2))
  await flush()
  requests[0].job.resolve(pipeline(1))
  await flush()
  assert.equal(page.state.analysisPipeline.value.pipelineId, 2)
  page.poll()
  assert.equal(requests.length, 3)
  page.poll()
  assert.equal(requests.length, 3, 'polling must not overlap')
  page.unmount()
  assert.equal(requests[2].signal.aborted, true)
  requests[2].job.resolve(pipeline(9))
  await flush()
  assert.equal(page.state.analysisPipeline.value.pipelineId, 2)
})

test('workflow displays reference selection and real assembly topology with unknown statuses', async () => {
  const page = setup(async id => pipeline(id, 101), async () => [stage(1, 44, 6), stage(2, 43, 999)])
  await flush()
  page.state.flowGraphContainer.value = {}
  await flush()
  const graph = page.instances.at(-1)
  assert.deepEqual(graph.edges.map((edge: any) => [edge.source, edge.target]), [['1', '2']])
  assert.match(graph.nodes.get('1').label, /不适用/)
  assert.match(graph.nodes.get('2').label, /未知状态/)
  page.state.currentFocusStage.value = page.state.pipelineStages.value[1]
  assert.match(page.state.currentStageStatus.value.label, /未知/)
  page.unmount()
  assert.equal(graph.disposed, true)
})

test('read workflow includes assembly and reference selection without inventing missing nodes', async () => {
  const types = [80, 0, 30, 44, 20, 40, 41, 72]
  const page = setup(async id => pipeline(id, 100), async () => types.map(type => stage(type, type)))
  await flush()
  page.state.flowGraphContainer.value = {}
  await flush()
  const graph = page.instances.at(-1)
  assert.deepEqual(graph.edges.map((edge: any) => `${edge.source}->${edge.target}`).sort(), [
    '80->0', '0->30', '30->44', '44->20', '20->40', '40->41', '40->72'
  ].sort())
  assert.equal(graph.nodes.size, types.length)
  page.unmount()
})

test('new FASTA workflows show the single actual comparison stage for both virus types', async () => {
  for (const type of [100, 101]) {
    const page = setup(async id => pipeline(id, type), async () => [stage(588, 43)])
    try {
      await flush()
      page.state.flowGraphContainer.value = {}
      await flush()
      const graph = page.instances.at(-1)
      assert.deepEqual([...graph.nodes.keys()], ['588'])
      assert.deepEqual(graph.edges, [])
      assert.equal(graph.nodes.get('588').x, 40)
    } finally {
      page.unmount()
    }
  }
})

test('initial errors can retry, while background errors preserve the last successful display', async context => {
  context.mock.method(console, 'error', () => {})
  let fail = true
  let calls = 0
  const page = setup(async id => {
    calls++
    if (fail) throw new Error('offline')
    return pipeline(id)
  })
  await flush()
  assert.equal(page.state.initPipelineAndStagesFailed.value, true)
  assert.equal(page.state.pipelineLoading.value, false)
  page.poll()
  assert.equal(calls, 1)
  fail = false
  await page.state.loadPipelineAndStages()
  assert.equal(page.state.initPipelineAndStagesFailed.value, false)
  assert.equal(page.state.analysisPipeline.value.pipelineId, 1)
  fail = true
  await page.state.refreshPipeline(false)
  assert.equal(page.state.initPipelineAndStagesFailed.value, false)
  assert.match(page.state.refreshError.value, /上次加载/)
  assert.equal(page.state.analysisPipeline.value.pipelineId, 1)
  page.unmount()
})

test('changes to stage membership rebuild the graph and keep the selected stage', async () => {
  let stages = [stage(1, 44), stage(2, 43)]
  const page = setup(undefined, async () => stages)
  await flush()
  page.state.flowGraphContainer.value = {}
  await flush()
  const original = page.instances.at(-1)
  page.state.currentFocusStage.value = page.state.pipelineStages.value[1]
  stages = [...stages, stage(3, 72)]
  await page.state.refreshPipeline(false)
  await flush()
  assert.equal(original.disposed, true)
  assert.equal(page.instances.at(-1).nodes.size, 3)
  assert.equal(page.state.currentFocusStage.value.stageId, 2)
  stages = []
  await page.state.refreshPipeline(false)
  await flush()
  assert.equal(page.instances.at(-1).disposed, true)
  assert.equal(page.state.currentFocusStage.value, null)
  page.unmount()
})
