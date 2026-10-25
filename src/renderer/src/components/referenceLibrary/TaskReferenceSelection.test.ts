import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computed, createRenderer, defineComponent, h, inject, nextTick, provide, reactive } from 'vue'
import type { ComputedRef } from 'vue'
import type { ReferenceLibraryItem } from '../../api/referenceLibrary'

const TaskReferenceSelection = require('./TaskReferenceSelection.vue').default

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
  createElement: type => node(type),
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
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
function find(root: HostNode, predicate: (candidate: HostNode) => boolean): HostNode | undefined {
  if (predicate(root)) return root
  for (const child of root.children) {
    const found = find(child, predicate)
    if (found) return found
  }
}
function text(root: HostNode): string {
  return (root.text ?? '') + root.children.map(text).join('')
}
function item(referenceId: number): ReferenceLibraryItem {
  return {
    referenceId, accession: `TEST_${referenceId}`, organismName: `测试名称 ${referenceId}`,
    sourceDb: 'USER_UPLOAD', taxId: 123, orgType: 0, genomeLength: 1000,
    segment: null, completeness: null, isAnnotated: false, enabled: true, fastaObjectName: null
  }
}
function mount(overrides: Record<string, unknown> = {}) {
  const root = node('root')
  const props = reactive({
    candidates: [item(501), item(503)], selectedIds: [501, 503],
    loading: false, loaded: true, error: '', missingSelectedIds: [] as number[], validationMessage: '',
    ...overrides
  })
  const events: Array<[string, ...unknown[]]> = []
  const app = renderer.createApp({
    render: () => h(TaskReferenceSelection, {
      ...props,
      onSelect: (id: number, selected: boolean) => events.push(['select', id, selected]),
      onRefresh: () => events.push(['refresh']),
      onSelectAll: () => events.push(['select-all']),
      onClearSelection: () => events.push(['clear-selection']),
      onRemoveUnavailable: () => events.push(['remove-unavailable'])
    })
  })
  for (const [name, tag] of Object.entries({
    'el-button': 'button', 'el-alert': 'alert', 'el-empty': 'empty',
    'el-checkbox': 'checkbox', 'el-pagination': 'pagination'
  })) {
    app.component(name, defineComponent({
      setup: (_, { attrs, slots }) => () => h(tag, { ...attrs }, slots.default?.())
    }))
  }
  app.component('el-table', defineComponent({
    setup(_, { attrs, slots }) {
      provide('table-test-rows', computed(() => attrs.data as ReferenceLibraryItem[]))
      return () => h('table', { ...attrs }, slots.default?.())
    }
  }))
  app.component('el-table-column', defineComponent({
    setup(_, { attrs, slots }) {
      const rows = inject<ComputedRef<ReferenceLibraryItem[]>>('table-test-rows')!
      return () => h('column', { ...attrs }, rows.value.map(row => slots.default?.({ row })))
    }
  }))
  app.mount(root)
  const optional = (id: string) => find(root, candidate => candidate.props['data-testid'] === id)
  function byId(id: string): HostNode {
    const result = optional(id)
    assert.ok(result, `Missing control: ${id}`)
    return result
  }
  return { app, root, props, events, byId, optional }
}

test('task reference panel renders full selection count, metadata, and batch-only scope', t => {
  const view = mount()
  t.after(() => view.app.unmount())
  assert.match(text(view.root), /本批次参考范围/)
  assert.match(text(view.root), /不会修改参考库的全局启用状态/)
  assert.match(text(view.root), /统一用于本批次每条流水线/)
  assert.match(text(view.root), /Reads 输入由后端选择后续参考/)
  assert.match(text(view.root), /FASTA 输入逐条比较全部候选，不选择最优参考/)
  assert.equal(text(view.byId('reference-count')), '已选 2 / 共 2 条参考')
  assert.match(text(view.root), /TEST_501/)
  assert.match(text(view.root), /测试名称 501/)
  assert.match(text(view.root), /USER_UPLOAD/)
  assert.match(text(view.root), /—/)
  assert.equal(view.byId('reference-choice-501').props['model-value'], true)
  assert.match(view.byId('reference-choice-501').props['aria-label'], /TEST_501/)
  assert.equal(find(view.root, candidate => candidate.type === 'table')!.props['row-key'], 'referenceId')
})

test('task reference panel emits row selection without mutating parent data', async t => {
  const view = mount()
  t.after(() => view.app.unmount())
  view.byId('reference-choice-501').props.onChange(false)
  assert.deepEqual(view.events, [['select', 501, false]])
  assert.deepEqual([...view.props.selectedIds], [501, 503])
  view.props.selectedIds = [503]
  await nextTick()
  assert.equal(view.byId('reference-choice-501').props['model-value'], false)
  assert.equal(text(view.byId('reference-count')), '已选 1 / 共 2 条参考')
  view.byId('reference-choice-501').props.onChange(true)
  assert.deepEqual(view.events[1], ['select', 501, true])
})

test('task reference panel emits full-set selection actions and explicit refresh', t => {
  const view = mount()
  t.after(() => view.app.unmount())
  view.byId('select-all-references').props.onClick()
  view.byId('clear-reference-selection').props.onClick()
  view.byId('refresh-references').props.onClick()
  assert.deepEqual(view.events, [['select-all'], ['clear-selection'], ['refresh']])
  assert.deepEqual([...view.props.selectedIds], [501, 503])
})

test('task reference panel distinguishes loading, partial error, uninitialized, and complete empty', async t => {
  const view = mount({ loading: true, loaded: false })
  t.after(() => view.app.unmount())
  assert.ok(view.optional('reference-loading'))
  assert.equal(view.optional('reference-count'), undefined)
  assert.equal(view.optional('reference-choice-501'), undefined)
  assert.equal(view.byId('refresh-references').props.disabled, true)
  view.props.loading = false
  view.props.error = '第二页加载失败'
  await nextTick()
  assert.ok(view.optional('reference-error'))
  assert.equal(view.optional('reference-empty'), undefined)
  assert.equal(view.optional('reference-count'), undefined)
  assert.equal(find(view.root, candidate => candidate.type === 'alert')!.props.title, '第二页加载失败')
  const retry = find(view.root, candidate => candidate.type === 'button' && text(candidate) === '重新加载')!
  retry.props.onClick()
  assert.deepEqual(view.events, [['refresh']])
  view.props.error = ''
  await nextTick()
  assert.ok(view.optional('reference-not-loaded'))
  view.props.loaded = true
  view.props.candidates = []
  view.props.selectedIds = []
  await nextTick()
  assert.ok(view.optional('reference-empty'))
  assert.match(view.byId('reference-empty').props.description, /暂无全局启用的参考/)
  assert.equal(view.optional('reference-count'), undefined)
  assert.equal(view.optional('select-all-references'), undefined)
})

test('task reference panel keeps cross-page choices controlled and size change resets page', async t => {
  const candidates = Array.from({ length: 55 }, (_, index) => item(index + 1))
  const view = mount({ candidates, selectedIds: [1, 21, 55] })
  t.after(() => view.app.unmount())
  assert.ok(view.optional('reference-choice-1'))
  assert.equal(view.optional('reference-choice-21'), undefined)
  view.byId('reference-pagination').props['onUpdate:currentPage'](2)
  await nextTick()
  assert.equal(view.byId('reference-choice-21').props['model-value'], true)
  assert.equal(view.optional('reference-choice-1'), undefined)
  view.byId('reference-choice-21').props.onChange(false)
  assert.deepEqual(view.events, [['select', 21, false]])
  view.props.selectedIds = [1, 55]
  view.byId('reference-pagination').props['onUpdate:currentPage'](1)
  await nextTick()
  assert.equal(view.byId('reference-choice-1').props['model-value'], true)
  assert.equal(text(view.byId('reference-count')), '已选 2 / 共 55 条参考')
  view.byId('reference-pagination').props['onUpdate:currentPage'](3)
  view.byId('reference-pagination').props.onSizeChange(50)
  await nextTick()
  assert.equal(view.byId('reference-pagination').props['current-page'], 1)
  assert.ok(view.optional('reference-choice-50'))
  assert.equal(view.optional('reference-choice-51'), undefined)
  assert.deepEqual(view.byId('reference-pagination').props['page-sizes'], [20, 50, 100])
})

test('task reference panel warns on missing selections without silently removing them', async t => {
  const view = mount({ candidates: [item(503)], selectedIds: [501, 503], missingSelectedIds: [501] })
  t.after(() => view.app.unmount())
  assert.match(text(view.byId('unavailable-selection')), /失效参考 ID：501/)
  assert.equal(text(view.byId('reference-count')), '已选 1 / 共 1 条参考')
  view.byId('remove-unavailable').props.onClick()
  assert.deepEqual(view.events, [['remove-unavailable']])
  assert.deepEqual([...view.props.selectedIds], [501, 503])
  view.props.selectedIds = []
  view.props.missingSelectedIds = []
  view.props.validationMessage = '请至少选择一条参考'
  await nextTick()
  assert.equal(text(view.byId('reference-count')), '已选 0 / 共 1 条参考')
  assert.equal(find(view.root, candidate => candidate.type === 'alert')!.props.title, '请至少选择一条参考')
  assert.equal(view.optional('unavailable-selection'), undefined)
})

test('task reference panel clamps local page after a shorter refreshed candidate list', async t => {
  const view = mount({ candidates: Array.from({ length: 50 }, (_, index) => item(index + 1)) })
  t.after(() => view.app.unmount())
  view.byId('reference-pagination').props['onUpdate:currentPage'](3)
  await nextTick()
  view.props.candidates = [item(501), item(503)]
  await nextTick()
  assert.equal(view.byId('reference-pagination').props['current-page'], 1)
  assert.ok(view.optional('reference-choice-501'))
})
