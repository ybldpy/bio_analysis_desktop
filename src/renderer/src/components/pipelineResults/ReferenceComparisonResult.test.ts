import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computed, createRenderer, defineComponent, h, inject, nextTick, provide, reactive, ref, shallowRef } from 'vue'
import type { ComputedRef } from 'vue'
import type { AnalysisPipelineStage } from '../../common/analysisPipeline'
import type { ReferenceComparisonCandidate, ReferenceComparisonIndex, ReferenceComparisonReport } from '../../common/referenceComparison'

// Exercise the actual compiled SFC. Report loading and downloads are stubbed; no network requests.
const stateModule = require('../../composables/useReferenceComparison')
const api = require('../../api/pipelineResults')
const ReferenceComparisonResult = require('./ReferenceComparisonResult.vue').default

interface HostNode {
  type: string
  text?: string
  parent: HostNode | null
  children: HostNode[]
  props: Record<string, any>
}
function node(type: string, text?: string): HostNode {
  return { type, text, parent: null, children: [], props: {} }
}
function detach(child: HostNode): void {
  if (!child.parent) return
  const index = child.parent.children.indexOf(child)
  if (index >= 0) child.parent.children.splice(index, 1)
  child.parent = null
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text),
  setText: (target, text) => { target.text = text },
  setElementText: (target, text) => { target.text = text; target.children = [] },
  patchProp: (target, key, _old, value) => { target.props[key] = value },
  insert: (child, parent, anchor) => {
    detach(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child)
    else parent.children.splice(index, 0, child)
    child.parent = parent
  },
  remove: detach,
  parentNode: target => target.parent,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null
})
function findAll(root: HostNode, predicate: (candidate: HostNode) => boolean): HostNode[] {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => findAll(child, predicate))]
}
function text(root: HostNode): string {
  return (root.text ?? '') + root.children.map(text).join('')
}
function candidate(id: number, overrides: Partial<ReferenceComparisonCandidate> = {}): ReferenceComparisonCandidate {
  return {
    referenceId: id, referenceAccession: 'DUPLICATE_ACCESSION', sourceDb: 'USER_UPLOAD', taxId: 123,
    organismName: `测试参考 ${id}`, segment: '1', segmentKey: 'SEGMENT_1', status: 'MATCHED',
    sequenceIdentity: 99.775, referenceCoverage: 0.5, alignedReferenceBases: 4000, referenceBases: 8000,
    matchingBases: 3991, alignmentBlockBases: 4000, alignmentCount: 1,
    alignmentPafUrl: `test/candidates/${id}/alignment.paf`, differenceTsvUrl: `test/candidates/${id}/difference.tsv`,
    ...overrides
  }
}
function report(rows = [candidate(1), candidate(2)]): ReferenceComparisonReport {
  return {
    schemaVersion: 2, candidateCount: rows.length,
    matchedCandidateCount: rows.filter(row => row.status === 'MATCHED').length,
    unmatchedCandidateCount: rows.filter(row => row.status === 'NO_MATCH').length, comparisons: rows
  }
}
function mount(data: ReferenceComparisonReport | null = report(), probeEmptySlots = false) {
  const original = stateModule.useReferenceComparison
  const state = {
    index: shallowRef<ReferenceComparisonIndex | null>(data ? {
      schemaVersion: 2, candidateCount: data.candidateCount,
      matchedCandidateCount: data.matchedCandidateCount, unmatchedCandidateCount: data.unmatchedCandidateCount,
      comparisonJsonUrl: 'test/comparison.json', comparisonTsvUrl: 'test/comparison.tsv'
    } : null), report: shallowRef(data),
    kind: ref<'v2' | 'legacy' | 'invalid' | 'empty'>('v2'), loading: ref(false), error: ref(''), message: ref(''),
    reloadCalls: 0, reload: () => { state.reloadCalls++ }
  }
  stateModule.useReferenceComparison = () => state
  const root = node('root')
  const stage: AnalysisPipelineStage = { stageId: 588, stageType: 43, stageName: '参考比较', status: 4, startTime: null, output: { urls: {}, inline: null } }
  const props = reactive({ stage, refreshVersion: 0, pipelineName: '测试任务' })
  const app = renderer.createApp({ render: () => h(ReferenceComparisonResult, props) })
  for (const [name, tag] of Object.entries({
    'el-button': 'button', 'el-alert': 'alert', 'el-empty': 'empty', 'el-tag': 'tag',
    'el-descriptions': 'descriptions', 'el-descriptions-item': 'description'
  })) {
    app.component(name, defineComponent({
      setup: (_, { attrs, slots }) => () => h(tag, { ...attrs }, slots.default?.())
    }))
  }
  app.component('el-table', defineComponent({
    setup(_, { attrs, slots }) {
      provide('comparison-test-rows', computed(() => attrs.data as ReferenceComparisonCandidate[]))
      return () => h('table', { ...attrs }, slots.default?.())
    }
  }))
  app.component('el-table-column', defineComponent({
    setup(_, { attrs, slots }) {
      const rows = inject<ComputedRef<ReferenceComparisonCandidate[]>>('comparison-test-rows')!
      return () => h('column', { ...attrs }, [
        ...rows.value.map((row, $index) => slots.default?.({ row, $index })),
        ...(probeEmptySlots ? [slots.default?.({ row: {}, $index: 99 }), slots.default?.({})] : [])
      ])
    }
  }))
  app.mount(root)
  const optional = (id: string) => findAll(root, candidate => candidate.props['data-testid'] === id)[0]
  function byId(id: string): HostNode {
    const result = optional(id)
    assert.ok(result, `Missing control: ${id}`)
    return result
  }
  return {
    root, props, state, byId, optional,
    unmount: () => { app.unmount(); stateModule.useReferenceComparison = original }
  }
}

test('comparison renders all seven metrics in ordinary columns with correct units and precision', t => {
  const view = mount()
  t.after(view.unmount)
  assert.equal(text(view.byId('candidate-count')), '2')
  assert.equal(text(view.byId('matched-count')), '2')
  assert.equal(text(view.byId('unmatched-count')), '0')
  const expected: Record<string, string> = {
    sequenceIdentity: '99.775%', referenceCoverage: '50%', alignedReferenceBases: '4,000', referenceBases: '8,000',
    matchingBases: '3,991', alignmentBlockBases: '4,000', alignmentCount: '1'
  }
  for (const [field, value] of Object.entries(expected)) {
    const cells = findAll(view.root, n => n.props['data-metric'] === field)
    assert.equal(cells.length, 2)
    assert.equal(text(cells[0]), value)
    assert.equal(cells[0].parent!.type, 'column')
    assert.notEqual(cells[0].parent!.props.type, 'expand')
  }
  for (const label of ['已对齐参考位置（bp）', '参考总长度（bp）', '累计匹配碱基（bp）', '累计比对块长度（bp）', '比对记录数']) {
    assert.ok(findAll(view.root, n => n.type === 'column' && n.props.label === label).length)
  }
  assert.match(text(view.root), /比对记录数不是变异数、reads 数或节段数/)
  assert.doesNotMatch(text(view.root), /9977\.5|99\.78%|质量达标|最优|最终参考|已选中/)
})

test('comparison preserves snapshot order and duplicate accession/segment rows, with all metadata and nullable fields', t => {
  const rows = [candidate(3), candidate(1, { referenceId: null, taxId: null, sourceDb: null, organismName: null, segment: null, segmentKey: null })]
  const view = mount(report(rows))
  t.after(view.unmount)
  assert.equal(view.byId('comparison-table').props['row-key'], 'alignmentPafUrl')
  assert.deepEqual(view.byId('comparison-table').props.data, rows)
  for (const label of ['参考记录 ID', '参考 Accession', '来源数据库', '实际 Tax ID', '参考名称', '原始节段', '节段分组键']) {
    const values = findAll(view.root, n => n.type === 'description' && n.props.label === label)
    assert.equal(values.length, 2)
    if (label !== '参考 Accession') assert.equal(text(values[1]), '—')
  }
  assert.match(text(view.root), /测试参考 3/)
  assert.match(text(view.root), /USER_UPLOAD/)
  assert.match(text(view.root), /SEGMENT_1/)
  assert.equal(findAll(view.root, n => n.type === 'tag' && text(n) === '有匹配 MATCHED').length, 2)
})

test('all NO_MATCH is a completed comparison, retaining zero metrics and every candidate download', t => {
  const rows = [1, 2].map(id => candidate(id, {
    status: 'NO_MATCH', sequenceIdentity: 0, referenceCoverage: 0, alignedReferenceBases: 0,
    matchingBases: 0, alignmentBlockBases: 0, alignmentCount: 0
  }))
  const view = mount(report(rows))
  t.after(view.unmount)
  assert.equal(view.byId('all-unmatched').props.title, '比较完成，未获得匹配')
  assert.match(view.byId('all-unmatched').props.description, /不表示样本质量合格/)
  assert.equal(text(view.byId('matched-count')), '0')
  assert.equal(text(view.byId('unmatched-count')), '2')
  assert.equal(findAll(view.root, n => n.type === 'tag' && text(n) === '未匹配 NO_MATCH').length, 2)
  for (const id of [1, 2]) {
    assert.equal(view.byId(`download-${id}-alignmentPafUrl`).props.disabled, false)
    assert.equal(view.byId(`download-${id}-differenceTsvUrl`).props.disabled, false)
  }
  assert.match(text(view.root), /PAF 可以为空文件/)
  assert.equal(text(findAll(view.root, n => n.props['data-metric'] === 'sequenceIdentity')[0]), '0%')
})

test('report loading, errors, legacy, empty and pending states do not invent candidates or measurements', async t => {
  const view = mount(null)
  t.after(view.unmount)
  view.state.loading.value = true
  await nextTick()
  assert.ok(view.optional('comparison-loading'))
  assert.equal(view.optional('candidate-count'), undefined)
  view.state.loading.value = false
  view.state.error.value = 'HTTP 500：报告获取失败'
  await nextTick()
  assert.ok(view.optional('comparison-error'))
  assert.equal(view.optional('comparison-empty'), undefined)
  view.byId('retry-report').props.onClick()
  assert.equal(view.state.reloadCalls, 1)
  view.state.kind.value = 'invalid'
  view.state.error.value = '暂不支持的参考比较结果版本：3'
  await nextTick()
  assert.match(findAll(view.root, n => n.type === 'alert')[0].props.title, /版本：3/)
  assert.equal(view.optional('comparison-legacy'), undefined)
  view.state.kind.value = 'legacy'
  view.state.error.value = ''
  await nextTick()
  assert.equal(view.byId('comparison-legacy').props.title, '历史结果未提供比较指标')
  assert.equal(view.optional('candidate-count'), undefined)
  view.state.kind.value = 'empty'
  view.state.message.value = '当前记录未提供参考比较结果。'
  await nextTick()
  assert.equal(view.byId('comparison-empty').props.description, '当前记录未提供参考比较结果。')
  for (const status of [0, 1, 2, 3, 5, 6]) {
    view.props.stage.status = status
    view.state.kind.value = 'v2'
    view.state.message.value = '阶段尚未完成、执行失败或不适用，暂不自动读取比较报告。'
    await nextTick()
    assert.match(view.byId('comparison-empty').props.description, /暂不自动读取比较报告/)
    assert.equal(view.optional('all-unmatched'), undefined)
  }
})

test('valid completed v2 index keeps summary counts during report loading and failure only', async t => {
  const view = mount(report([candidate(1), candidate(2, { status: 'NO_MATCH' })]))
  t.after(view.unmount)
  view.state.report.value = null
  view.state.loading.value = true
  await nextTick()
  assert.match(text(view.root), /阶段结果摘要/)
  assert.ok(view.optional('comparison-loading'))
  assert.equal(text(view.byId('candidate-count')), '2')
  assert.equal(text(view.byId('matched-count')), '1')
  assert.equal(text(view.byId('unmatched-count')), '1')
  assert.equal(view.optional('comparison-table'), undefined)
  view.state.loading.value = false
  view.state.error.value = '报告读取失败'
  await nextTick()
  assert.ok(view.optional('comparison-error'))
  assert.equal(text(view.byId('candidate-count')), '2')
  assert.equal(text(view.byId('matched-count')), '1')
  assert.equal(text(view.byId('unmatched-count')), '1')
  view.byId('retry-report').props.onClick()
  assert.equal(view.state.reloadCalls, 1)
  for (const kind of ['invalid', 'legacy', 'empty'] as const) {
    view.state.kind.value = kind
    await nextTick()
    assert.equal(view.optional('candidate-count'), undefined)
    assert.equal(view.optional('matched-count'), undefined)
    assert.equal(view.optional('unmatched-count'), undefined)
  }
  view.state.kind.value = 'v2'
  view.props.stage.status = 2
  await nextTick()
  assert.equal(view.optional('candidate-count'), undefined)
  view.props.stage.status = 4
  view.state.index.value = null
  await nextTick()
  assert.equal(view.optional('candidate-count'), undefined)
  assert.equal(view.optional('matched-count'), undefined)
  assert.equal(view.optional('unmatched-count'), undefined)
})

test('Element Plus empty slot probes cannot crash metric, metadata or download rendering', t => {
  const view = mount(report([candidate(1)]), true)
  t.after(view.unmount)
  assert.equal(view.byId('download-100-alignmentPafUrl').props.disabled, true)
  assert.equal(view.byId('download-100-differenceTsvUrl').props.disabled, true)
  assert.equal(findAll(view.root, n => n.props['data-metric'] === 'sequenceIdentity').length, 3)
  assert.equal(text(findAll(view.root, n => n.props['data-metric'] === 'sequenceIdentity')[2]), '—')
})

test('candidate downloads use independent raw keys and unique filenames; failure allows retry', async t => {
  const original = api.downloadStageFile
  const calls: Array<{ key: string; name: string; signal: AbortSignal }> = []
  api.downloadStageFile = async (key: string, name: string, signal: AbortSignal) => {
    calls.push({ key, name, signal })
    if (calls.length === 1) throw new Error('下载网络错误')
  }
  const view = mount()
  t.after(() => { view.unmount(); api.downloadStageFile = original })
  await view.byId('download-1-alignmentPafUrl').props.onClick()
  await nextTick()
  assert.match(text(view.root), /下载网络错误/)
  assert.match(text(view.byId('download-1-alignmentPafUrl')), /重试下载 PAF/)
  await view.byId('download-1-alignmentPafUrl').props.onClick()
  await view.byId('download-2-alignmentPafUrl').props.onClick()
  await view.byId('download-2-differenceTsvUrl').props.onClick()
  await nextTick()
  assert.doesNotMatch(text(view.root), /下载网络错误/)
  assert.match(text(view.root), /文件已获取，请在保存窗口中完成保存/)
  assert.equal(calls[0].key, 'test/candidates/1/alignment.paf')
  assert.equal(calls[2].key, 'test/candidates/2/alignment.paf')
  assert.match(calls[1].name, /stage588_candidate0001_alignment\.paf$/)
  assert.match(calls[2].name, /stage588_candidate0002_alignment\.paf$/)
  assert.match(calls[3].name, /stage588_candidate0002_difference\.tsv$/)
  assert.notEqual(calls[1].name, calls[2].name)
  assert.equal(calls[0].signal.aborted, false)
})

test('cancel, refresh and unmount abort in-flight candidate downloads and ignore stale completions', async t => {
  const original = api.downloadStageFile
  const calls: Array<{ signal: AbortSignal; finish: () => void }> = []
  api.downloadStageFile = (_key: string, _name: string, signal: AbortSignal) => new Promise<void>(resolve => {
    calls.push({ signal, finish: resolve })
  })
  const view = mount()
  let unmounted = false
  t.after(() => { if (!unmounted) view.unmount(); api.downloadStageFile = original })
  const first = view.byId('download-1-alignmentPafUrl').props.onClick()
  await nextTick()
  assert.equal(view.byId('download-1-alignmentPafUrl').props.loading, true)
  view.byId('cancel-1-alignmentPafUrl').props.onClick()
  assert.equal(calls[0].signal.aborted, true)
  await nextTick()
  assert.equal(view.byId('download-1-alignmentPafUrl').props.loading, false)
  assert.match(text(view.root), /已取消获取文件/)
  const second = view.byId('download-1-alignmentPafUrl').props.onClick()
  calls[0].finish()
  await first
  await nextTick()
  assert.equal(view.byId('download-1-alignmentPafUrl').props.loading, true)
  view.props.refreshVersion++
  await nextTick()
  assert.equal(calls[1].signal.aborted, true)
  calls[1].finish()
  await second
  assert.doesNotMatch(text(view.root), /文件已获取/)
  const third = view.byId('download-2-differenceTsvUrl').props.onClick()
  view.unmount()
  unmounted = true
  assert.equal(calls[2].signal.aborted, true)
  calls[2].finish()
  await third
})
