import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@vue/server-renderer'
import ElementPlus, { ID_INJECTION_KEY, ZINDEX_INJECTION_KEY } from 'element-plus'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive } from 'vue'
import { backendService } from '../../api/backendService'
import {
  createTaxonomyConfirmationState,
  reconcileTaxonomyConfirmation,
  type TaxonomyConfirmationContext
} from './taxonomyConfirmationState'

// The shared test loader compiles this SFC and its styles with the installed Vue compiler.
const TaxonomyConfirmation = require('./TaxonomyConfirmation.vue').default

function context(): TaxonomyConfirmationContext {
  return {
    pipeline: {
      pipelineId: 12,
      pipelineType: 200,
      status: 1,
      analysisPipelineName: '测试任务',
      projectId: 1,
      createTime: new Date()
    },
    stage: {
      stageId: 91,
      stageType: 10,
      stageName: '分类',
      status: 5,
      startTime: null,
      output: {
        urls: null,
        inline: { status: 1, candidates: [{ taxid: 123, name: '<b>测试候选</b>' }] }
      }
    },
    refreshing: false,
    refreshVersion: 1
  }
}

async function render(ctx = context(), state = createTaxonomyConfirmationState()) {
  const app = createSSRApp(TaxonomyConfirmation, { ...ctx, state })
  app.use(ElementPlus)
  app.provide(ID_INJECTION_KEY, { prefix: 1, current: 0 })
  app.provide(ZINDEX_INJECTION_KEY, { current: 0 })
  return renderToString(app)
}

test('confirmation SFC renders editable controls only for eligible first confirmations', async () => {
  const html = await render()
  assert.match(html, /确认所选候选/)
  assert.match(html, /最多 2000 字符/)
  assert.doesNotMatch(html, /重试原确认的下游调度/)
  const ctx = context()
  ctx.stage.output.inline!.status = 3
  ctx.stage.status = 6
  const blocked = await render(ctx)
  assert.match(blocked, /超出分类范围或不适用/)
  assert.doesNotMatch(blocked, /确认所选候选|重试原确认的下游调度/)
})

test('a saved audit alone does not render a recovery operation', async () => {
  const ctx = context()
  ctx.stage.output.inline!.manualConfirmation = { speciesTaxId: 123 }
  const html = await render(ctx)
  assert.match(html, /当前锁定的确认对象：TaxID 123/)
  assert.doesNotMatch(html, /确认所选候选|重试原确认的下游调度/)
})

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
function detach(child: HostNode) {
  if (!child.parent) return
  const index = child.parent.children.indexOf(child)
  if (index >= 0) child.parent.children.splice(index, 1)
  child.parent = null
}
function insert(child: HostNode, parent: HostNode, anchor?: HostNode | null) {
  detach(child)
  const index = anchor ? parent.children.indexOf(anchor) : -1
  if (index < 0) parent.children.push(child)
  else parent.children.splice(index, 0, child)
  child.parent = parent
}
const renderer = createRenderer<HostNode, HostNode>({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (target, text) => {
    target.text = text
  },
  setElementText: (target, text) => {
    target.text = text
    target.children = []
  },
  patchProp: (target, key, _previous, value) => {
    target.props[key] = value
  },
  insert,
  remove: detach,
  parentNode: (target) => target.parent,
  nextSibling: (target) =>
    target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null
})
function find(root: HostNode, type: string): HostNode | undefined {
  if (root.type === type) return root
  for (const child of root.children) {
    const match = find(child, type)
    if (match) return match
  }
}

function mount(
  ctx: TaxonomyConfirmationContext,
  state: ReturnType<typeof createTaxonomyConfirmationState>,
  onRefresh: () => void
) {
  const root = node('root')
  const app = renderer.createApp({
    render: () => h(TaxonomyConfirmation, { ...ctx, state, onRefresh })
  })
  for (const [name, tag] of Object.entries({
    'el-form': 'form',
    'el-form-item': 'label',
    'el-select': 'select',
    'el-option': 'option',
    'el-input': 'textarea',
    'el-button': 'button',
    'el-alert': 'aside'
  })) {
    app.component(
      name,
      defineComponent({
        inheritAttrs: false,
        setup:
          (_, { attrs, slots }) =>
          () =>
            h(tag, attrs, slots.default?.())
      })
    )
  }
  app.mount(root)
  return { app, root }
}

test('unmounted confirmation updates its stored state without emitting refresh into a new task', async (t) => {
  const previous = backendService.defaults.adapter
  t.after(() => {
    backendService.defaults.adapter = previous
  })
  let finish!: () => void
  let outgoing: unknown
  backendService.defaults.adapter = async (config) => {
    outgoing = JSON.parse(config.data)
    return new Promise((resolve) => {
      finish = () =>
        resolve({
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: {
            status: 2,
            data: {
              stageId: 91,
              taxId: 123,
              version: 2,
              downstreamScheduled: false,
              alreadyConfirmed: false
            },
            failMsg: '调度失败'
          }
        })
    })
  }
  const ctx = reactive(context())
  const state = reactive(createTaxonomyConfirmationState())
  let refreshes = 0
  const first = mount(ctx, state, () => {
    refreshes++
  })
  state.selectedTaxId = 123
  state.reason = '测试确认'
  await nextTick()
  const form = find(first.root, 'form')!
  const request = form.props.onSubmit({ preventDefault() {} })
  await nextTick()
  assert.equal(state.submitting, true)
  assert.deepEqual(outgoing, { stageId: 91, taxId: 123, reason: '测试确认' })
  first.app.unmount()
  finish()
  await request
  assert.equal(state.phase, 'saved')
  assert.equal(state.recoveryRequest?.taxId, 123)
  assert.equal(refreshes, 0)
  assert.equal(state.refreshAfterVersion, null)
  ctx.refreshVersion = 5
  const second = mount(ctx, state, () => {
    refreshes++
  })
  assert.equal(refreshes, 1, 'remount requests a post-response refresh')
  assert.equal(state.refreshAfterVersion, 5)
  assert.equal(state.needsRefresh, true)
  second.app.unmount()
})

test('an already-running refresh must finish before requesting post-response verification', async () => {
  const ctx = reactive(context())
  const state = reactive(createTaxonomyConfirmationState())
  reconcileTaxonomyConfirmation(state, ctx)
  state.phase = 'uncertain'
  state.needsRefresh = true
  ctx.refreshing = true
  let refreshes = 0
  const view = mount(ctx, state, () => {
    refreshes++
  })
  assert.equal(refreshes, 0)
  ctx.refreshVersion = 2
  ctx.refreshing = false
  await nextTick()
  assert.equal(refreshes, 1)
  assert.equal(state.refreshAfterVersion, 2)
  assert.equal(state.needsRefresh, true)
  ctx.refreshing = true
  await nextTick()
  ctx.refreshVersion = 3
  ctx.refreshing = false
  await nextTick()
  assert.equal(state.needsRefresh, false)
  assert.equal(state.phase, 'idle')
  assert.equal(refreshes, 1)
  view.app.unmount()
})
