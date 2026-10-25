import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { compileScript, compileStyle, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ElementPlus, { ID_INJECTION_KEY, ZINDEX_INJECTION_KEY } from 'element-plus'
import { Upload, Refresh } from '@element-plus/icons-vue'
import ts from 'typescript'
import * as vue from 'vue'
import {
  getReferenceDownloadName, getReferenceLibraryErrorMessage,
  type ReferenceLibraryItem, type ReferenceLibraryTarget
} from '../api/referenceLibrary'

const filename = resolve('src/renderer/src/views/ReferenceLibraryView.vue')
const item: ReferenceLibraryItem = {
  referenceId: 12, accession: 'LOCAL_DISPLAY_12', sourceDb: 'USER_UPLOAD', taxId: 123,
  orgType: 0, organismName: '示例名称', genomeLength: 0, segment: null, completeness: null,
  isAnnotated: false, enabled: false, fastaObjectName: 'refseq/custom/display/reference.fna'
}

function compileFile(path: string, inlineTemplate = false) {
  const parsed = parse(readFileSync(path, 'utf8'), { filename: path })
  assert.deepEqual(parsed.errors, [])
  for (const style of parsed.descriptor.styles) {
    assert.deepEqual(compileStyle({ source: style.content, filename: path, id: path, scoped: style.scoped }).errors, [])
  }
  return ts.transpileModule(compileScript(parsed.descriptor, { id: path, inlineTemplate }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
}

const viewSetup = compileFile(filename)
const viewRender = compileFile(filename, true)
const appFilename = resolve('src/renderer/src/App.vue')
const appSetup = compileFile(appFilename)

function libraryState() {
  const calls: unknown[][] = []
  const fn = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return Promise.resolve() }
  return {
    calls,
    filters: vue.reactive({ taxId: '', enabled: '', accession: '' }),
    selectedTarget: vue.ref<ReferenceLibraryTarget | null>(null),
    selectTarget: fn('selectTarget'), isGlobalLookup: vue.ref(false),
    returnToManagement: fn('returnToManagement'),
    page: vue.ref(1), pageSize: vue.ref(20), total: vue.ref(0), items: vue.ref<ReferenceLibraryItem[]>([]),
    loading: vue.ref(false), hasLoaded: vue.ref(true), listError: vue.ref(''), filterError: vue.ref(''),
    search: fn('search'), resetFilters: fn('resetFilters'), changePage: fn('changePage'),
    changePageSize: fn('changePageSize'), refresh: fn('refresh'), lookupAccession: fn('lookupAccession'),
    toggleEnabled: fn('toggleEnabled'), pendingIds: vue.reactive(new Set<number>()),
    operationError: vue.ref(''), operationMessage: vue.ref(''), detailVisible: vue.ref(false),
    detailLoading: vue.ref(false), detailError: vue.ref(''), detailItem: vue.ref<ReferenceLibraryItem | null>(null),
    openDetail: fn('openDetail'), refreshDetail: fn('refreshDetail'), closeDetail: fn('closeDetail')
  }
}

interface ViewOptions {
  targetContextConfirmed?: boolean
  fetchTargets?: () => Promise<unknown>
  download?: (item: ReferenceLibraryItem) => Promise<Blob>
  renderTableRows?: boolean
}

function loadView(state: ReturnType<typeof libraryState>, inlineTemplate = false, options: ViewOptions = {}) {
  const mounted: (() => void)[] = []
  const beforeUnmount: (() => void)[] = []
  const apiCalls = { targets: 0, downloads: [] as ReferenceLibraryItem[] }
  const messages = { success: [] as string[], error: [] as string[] }
  const componentModule = { exports: {} as any }
  const realRequire = createRequire(filename)
  new Function('require', 'module', 'exports', inlineTemplate ? viewRender : viewSetup)(
    (name: string) => {
      if (name === '../composables/useReferenceLibrary') return { useReferenceLibrary: () => state }
      if (name === '../common/referenceLibraryConfig') return {
        referenceLibraryDeployment: { targetContextConfirmed: options.targetContextConfirmed ?? true }
      }
      if (name === '../api/analysisPipeline') return {
        fetchVirusTargets: () => {
          apiCalls.targets++
          return options.fetchTargets?.() ?? Promise.resolve({ status: 0, data: [], failMsg: null })
        }
      }
      if (name === '../api/referenceLibrary') return {
        getReferenceDownloadName, getReferenceLibraryErrorMessage,
        downloadReferenceLibraryFile: (item: ReferenceLibraryItem) => {
          apiCalls.downloads.push(item)
          return options.download?.(item) ?? Promise.resolve(new Blob(['download test fixture']))
        }
      }
      if (name === 'element-plus' && !inlineTemplate) return { ElMessage: {
        success: (message: string) => messages.success.push(message),
        error: (message: string) => messages.error.push(message)
      } }
      if (name === '../components/referenceLibrary/ReferenceUploadDialog.vue') {
        return { __esModule: true, default: vue.defineComponent({ name: 'UploadStub', render: () => null }) }
      }
      if (name === 'vue' && !inlineTemplate) return {
        ...vue, onMounted: (fn: () => void) => mounted.push(fn),
        onBeforeUnmount: (fn: () => void) => beforeUnmount.push(fn)
      }
      return realRequire(name)
    }, componentModule, componentModule.exports
  )
  return { component: componentModule.exports.default, mounted, beforeUnmount, apiCalls, messages }
}

async function render(state: ReturnType<typeof libraryState>, options: ViewOptions = {}) {
  const { component } = loadView(state, true, options)
  // Drawer content is rendered in place so assertions inspect the real detail markup.
  component.components = {
    ElDrawer: vue.defineComponent({
      props: ['modelValue'], setup: (props, { slots }) => () => props.modelValue ? vue.h('aside', slots.default?.()) : null
    })
  }
  // Element Plus registers columns after mount. SSR-only row stubs exercise this page's slots.
  if (options.renderTableRows) Object.assign(component.components, {
    ElTable: vue.defineComponent({ setup: (_, { slots }) => () => vue.h('div', slots.default?.()) }),
    ElTableColumn: vue.defineComponent({ setup: (_, { slots }) => () => vue.h('div',
      state.items.value.map(row => slots.default?.({ row }))) }),
    ElSwitch: vue.defineComponent({ props: ['disabled'], setup: props => () => vue.h('button', {
      'data-enable-switch': '', disabled: props.disabled
    }) })
  })
  const app = vue.createSSRApp(component)
  app.use(ElementPlus)
  app.component('Upload', Upload)
  app.component('Refresh', Refresh)
  app.provide(ID_INJECTION_KEY, { prefix: 1, current: 0 })
  app.provide(ZINDEX_INJECTION_KEY, { current: 0 })
  return renderToString(app)
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve))
const target: ReferenceLibraryTarget = { label: '测试专项', taxId: 700001, pipelineType: 100 }
const catalog = (data: unknown[]) => ({ status: 0, data, failMsg: null })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setupView(options: ViewOptions = {}) {
  const library = libraryState()
  const loaded = loadView(library, false, options)
  const events: unknown[][] = []
  const state = loaded.component.setup({}, { expose() {}, emit: (...args: unknown[]) => events.push(args) })
  return { ...loaded, library, state, events }
}

function browserDownloads(t: TestContext) {
  const anchors: { href: string; download: string; clicks: number; removed: boolean; click(): void; remove(): void }[] = []
  const appended: unknown[] = []
  const created: Blob[] = []
  const revoked: string[] = []
  const timers: { callback: () => void; delay: number }[] = []
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: (name: string) => {
      assert.equal(name, 'a')
      const anchor = { href: '', download: '', clicks: 0, removed: false,
        click() { this.clicks++ }, remove() { this.removed = true } }
      anchors.push(anchor)
      return anchor
    },
    body: { appendChild: (element: unknown) => appended.push(element) }
  } })
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else delete (globalThis as { document?: unknown }).document
  })
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { created.push(blob); return 'blob:test-download' })
  t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url))
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => {
    timers.push({ callback, delay })
    return 1 as unknown as ReturnType<typeof setTimeout>
  })
  return { anchors, appended, created, revoked, timers }
}

test('management page reads on mount, keeps upload mounted, and refreshes/details only after creation', async () => {
  const library = libraryState()
  const { component, mounted, apiCalls } = loadView(library)
  const events: unknown[][] = []
  const state = component.setup({}, { expose() {}, emit: (...args: unknown[]) => events.push(args) })
  assert.deepEqual(library.calls, [])
  mounted.forEach(fn => fn())
  await settle()
  assert.deepEqual(library.calls, [['refresh']])
  assert.equal(apiCalls.targets, 1)
  state.uploadVisible.value = true
  state.handleCreated(item)
  assert.equal(state.uploadVisible.value, false)
  assert.deepEqual(library.calls.slice(1), [['refresh'], ['openDetail', 12]])
  state.handleLookup('LOCAL_DISPLAY_12')
  assert.deepEqual(library.calls.at(-1), ['lookupAccession', 'LOCAL_DISPLAY_12'])
  state.handleLookup('')
  assert.deepEqual(library.calls.at(-1), ['lookupAccession', ''])
  state.handleDetailVisibleChange(false)
  assert.deepEqual(library.calls.at(-1), ['closeDetail'])
  state.handleNavigationLock(true)
  assert.equal(state.uploadNavigationLocked.value, true)
  state.handleNavigationLock(false)
  assert.deepEqual(events, [['navigation-lock', true], ['navigation-lock', false]])
  assert.equal(state.displayLength(0), '0 bp')
  assert.equal(state.displayLength(null), '未提供')
  assert.equal(state.categoryName(0), '病毒')
  assert.equal(state.categoryName(1), '细菌')
})

test('page empty/error states describe exact scope and never pretend a failed load is an empty library', async () => {
  const state = libraryState()
  const empty = await render(state)
  assert.match(empty, /参考库的全局设置/)
  assert.match(empty, /不自动包含下级分类/)
  assert.match(empty, /没有符合条件的参考记录/)
  state.hasLoaded.value = false
  state.listError.value = '服务暂时不可用'
  const failed = await render(state)
  assert.match(failed, /服务暂时不可用/)
  assert.match(failed, /重新加载/)
  assert.doesNotMatch(failed, /没有符合条件的参考记录/)
})

test('details show declared metadata and object keys as plain text, with a disabled download for missing keys', async () => {
  const state = libraryState()
  state.detailVisible.value = true
  state.detailItem.value = { ...item, organismName: '<script>alert(1)</script>' }
  let html = await render(state)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /refseq\/custom\/display\/reference\.fna/)
  assert.match(html, /0 bp/)
  assert.match(html, /下载 FASTA/)
  assert.match(html, /不保留原 gzip／ZIP 包装/)
  assert.doesNotMatch(html, /href=["'][^"']*refseq/)
  state.detailItem.value = { ...item, fastaObjectName: null }
  html = await render(state)
  assert.match(html, /文件位置不可用/)
  assert.match(html, /<button[^>]*disabled[^>]*>[\s\S]*?下载 FASTA/)
})

test('App exposes the resource page and prevents losing an active or unresolved upload through navigation', () => {
  const componentModule = { exports: {} as any }
  const warnings: string[] = []
  const views = new Map<string, object>()
  new Function('require', 'module', 'exports', appSetup)(
    (name: string) => {
      if (name === 'vue') return vue
      if (name === 'element-plus') return { ElMessage: { warning: (message: string) => warnings.push(message) } }
      if (name.endsWith('.vue')) {
        const component = { name }
        views.set(name, component)
        return { __esModule: true, default: component }
      }
      throw new Error(`Unexpected import ${name}`)
    }, componentModule, componentModule.exports
  )
  const state = componentModule.exports.default.setup({}, { expose() {} })
  assert.ok(state.menuGroups.flatMap(group => group.items).some(item => item.id === 'references'))
  state.navigate('references')
  assert.equal(state.activePage.value, 'references')
  assert.equal(state.pageTitle.value, '参考序列库')
  assert.equal(state.currentComponent.value, views.get('./views/ReferenceLibraryView.vue'))
  state.referenceNavigationLocked.value = true
  state.navigate('new-task')
  assert.equal(state.activePage.value, 'references')
  assert.match(warnings[0], /待核实/)
  state.referenceNavigationLocked.value = false
  state.navigate('new-task')
  assert.equal(state.activePage.value, 'new-task')
  assert.equal(state.pageTitle.value, '新建分析任务')
})

test('target catalog includes only 100/101, uses pair identity, and collapses duplicate pairs', async () => {
  const sameTaxId = { taxId: 2697049, label: '通用专项', pipelineType: 100 }
  const covid = { ...sameTaxId, label: '新冠专项', pipelineType: 101 }
  const { state, apiCalls, library } = setupView({ fetchTargets: async () => catalog([
    target, sameTaxId, covid, { ...covid, label: '新冠专项最新版' },
    { label: '污水专项', taxId: 2697049, pipelineType: 102 },
    { label: '其他流程', taxId: 123, pipelineType: 200 }
  ]) })
  await state.loadTargets()
  assert.equal(apiCalls.targets, 1)
  assert.equal(state.targetsLoading.value, false)
  assert.equal(state.targetsError.value, '')
  assert.deepEqual(state.targets.value.map(state.targetKey), ['100:700001', '100:2697049', '101:2697049'])
  assert.equal(state.targets.value[2].label, '新冠专项最新版')
  assert.equal(state.targetKey(null), '')
  state.handleTargetChange('101:2697049')
  assert.deepEqual(library.calls, [['selectTarget', { ...covid, label: '新冠专项最新版' }]])
  state.handleTargetChange('100:2697049')
  assert.deepEqual(library.calls.at(-1), ['selectTarget', sameTaxId])
  state.handleTargetChange('102:2697049')
  assert.equal(library.calls.length, 2)
  state.handleTargetChange('')
  assert.deepEqual(library.calls.at(-1), ['selectTarget', null])
})

test('empty target catalog is not a fabricated target or a failure', async () => {
  const { state, library } = setupView()
  await state.loadTargets()
  assert.deepEqual(state.targets.value, [])
  assert.equal(state.targetsError.value, '')
  assert.deepEqual(library.calls, [])
  const html = await render(library)
  assert.match(html, /暂无可用病毒专项/)
  assert.match(html, /未自动添加选项/)
  assert.doesNotMatch(html, /筛选类别/)
})

test('invalid target 101 combination and malformed supported target metadata reject the catalog', async () => {
  for (const invalid of [
    { ...target, pipelineType: 101 },
    { ...target, taxId: 0 },
    { ...target, taxId: 1.5 },
    { ...target, taxId: '700001' },
    { ...target, label: ' ' },
    { ...target, label: null }
  ]) {
    const { state, library } = setupView({ fetchTargets: async () => catalog([invalid]) })
    await state.loadTargets()
    assert.deepEqual(state.targets.value, [])
    assert.ok(state.targetsError.value)
    assert.equal(state.targetsLoading.value, false)
    assert.deepEqual(library.calls, [])
  }
})

test('catalog errors preserve selected scope and rows, never silently switch or refresh the whole library', async () => {
  for (const fetchTargets of [
    async () => ({ status: 1, data: null, failMsg: '专项目录不可用' }),
    async () => { throw new Error('network offline') },
    async () => ({ status: 0, data: {}, failMsg: null })
  ]) {
    const { state, library } = setupView({ fetchTargets })
    library.selectedTarget.value = target
    library.items.value = [item]
    await state.loadTargets()
    assert.ok(state.targetsError.value)
    assert.deepEqual(state.targets.value, [])
    assert.deepEqual(library.selectedTarget.value, target)
    assert.deepEqual(library.items.value, [item])
    assert.deepEqual(library.calls, [])
    assert.equal(state.selectedTargetAvailable.value, false)
    state.openUpload()
    assert.equal(state.uploadVisible.value, false)
  }
})

test('a removed catalog choice is unavailable for new uploads without changing selected scope', async () => {
  const { state, library } = setupView({ fetchTargets: async () => catalog([]) })
  library.selectedTarget.value = target
  await state.loadTargets()
  assert.equal(state.selectedTargetAvailable.value, false)
  assert.deepEqual(library.selectedTarget.value, target)
  assert.deepEqual(library.calls, [])
  const html = await render(library)
  assert.match(html, /不会自动改查全库/)
  assert.match(html, /测试专项 · 专项参考/)
})

test('stale catalog success/failure and completions after unmount cannot overwrite current catalog state', async () => {
  const first = deferred<unknown>()
  const second = deferred<unknown>()
  const last = deferred<unknown>()
  const queue = [first, second, last]
  const { state, beforeUnmount } = setupView({ fetchTargets: () => queue.shift()!.promise })
  const old = state.loadTargets()
  const current = state.loadTargets()
  second.resolve(catalog([target]))
  await current
  first.reject(new Error('old catalog failed'))
  await old
  assert.equal(state.targetsError.value, '')
  assert.deepEqual(state.targets.value, [target])
  const pending = state.loadTargets()
  beforeUnmount.forEach(fn => fn())
  last.resolve(catalog([]))
  await pending
  assert.deepEqual(state.targets.value, [target])
})

test('upload lock blocks target changes and catalog refresh but can reopen unresolved upload', async () => {
  const { state, library, apiCalls, events } = setupView({ fetchTargets: async () => catalog([target]) })
  await state.loadTargets()
  library.selectedTarget.value = target
  assert.equal(state.selectedTargetAvailable.value, true)
  state.openUpload()
  assert.equal(state.uploadVisible.value, true)
  state.uploadVisible.value = false
  state.handleNavigationLock(true)
  state.handleTargetChange('')
  state.handleTargetChange('100:700001')
  await state.loadTargets()
  assert.equal(apiCalls.targets, 1)
  assert.deepEqual(library.calls, [])
  assert.deepEqual(events, [['navigation-lock', true]])
  state.targets.value = []
  assert.equal(state.selectedTargetAvailable.value, false)
  state.openUpload()
  assert.equal(state.uploadVisible.value, true)
  state.handleNavigationLock(false)
  state.handleTargetChange('')
  assert.deepEqual(library.calls, [['selectTarget', null]])
})

test('target loading blocks selection until the catalog response is resolved', async () => {
  const request = deferred<unknown>()
  const { state, library } = setupView({ fetchTargets: () => request.promise })
  const pending = state.loadTargets()
  state.handleTargetChange('')
  assert.equal(state.targetsLoading.value, true)
  assert.deepEqual(library.calls, [])
  request.resolve(catalog([target]))
  await pending
  state.handleTargetChange('100:700001')
  assert.deepEqual(library.calls, [['selectTarget', target]])
})

test('disabled deployment gate prevents target API reads and scoped selections', async () => {
  const { state, library, mounted, apiCalls } = setupView({ targetContextConfirmed: false })
  mounted.forEach(fn => fn())
  await state.loadTargets()
  state.handleTargetChange('100:700001')
  state.handleTargetChange('')
  assert.equal(apiCalls.targets, 0)
  assert.deepEqual(library.calls, [['refresh']])
  assert.equal(state.targetContextEnabled, false)
  const html = await render(library, { targetContextConfirmed: false })
  assert.match(html, /专项功能待部署确认/)
  assert.match(html, /当前仅提供全局病毒参考管理/)
  assert.doesNotMatch(html, /刷新专项/)
})

test('global verification is explicitly labeled and successful upload returns to management without losing detail access', async () => {
  const { state, library, messages } = setupView()
  library.selectedTarget.value = target
  library.isGlobalLookup.value = true
  library.filters.accession = 'CHECK_12'
  const html = await render(library)
  assert.match(html, /全局上传结果核实：不限专项、类别、实际 Tax ID 和启用状态/)
  assert.match(html, /此处只读核实，不是当前专项的参考范围/)
  assert.match(html, /返回当前专项管理/)
  assert.match(html, /CHECK_12/)
  assert.doesNotMatch(html, /实际参考 Tax ID（精确）/)
  state.handleCreated(item)
  assert.deepEqual(library.calls, [['returnToManagement'], ['openDetail', 12]])
  assert.deepEqual(messages.success, ['参考序列已追加成功'])
})

test('global verification rows are read-only; only the management scope exposes enabled switches', async () => {
  const library = libraryState()
  library.items.value = [{ ...item, orgType: 1 }]
  library.isGlobalLookup.value = true
  let html = await render(library, { renderTableRows: true })
  assert.match(html, /<button[^>]*data-enable-switch[^>]*disabled/)
  library.isGlobalLookup.value = false
  library.items.value = [item]
  html = await render(library, { renderTableRows: true })
  assert.match(html, /<button[^>]*data-enable-switch/)
  assert.doesNotMatch(html, /<button[^>]*data-enable-switch[^>]*disabled/)
})

test('download ignores missing object keys and prevents duplicate in-flight requests', async (t) => {
  const browser = browserDownloads(t)
  const request = deferred<Blob>()
  const { state, apiCalls, messages } = setupView({ download: () => request.promise })
  await state.downloadReference({ ...item, fastaObjectName: null })
  await state.downloadReference({ ...item, fastaObjectName: ' ' })
  assert.equal(apiCalls.downloads.length, 0)
  const pending = state.downloadReference(item)
  assert.equal(state.downloadingIds.has(item.referenceId), true)
  await state.downloadReference(item)
  assert.equal(apiCalls.downloads.length, 1)
  const blob = new Blob(['download test fixture'], { type: 'application/octet-stream' })
  request.resolve(blob)
  await pending
  assert.equal(state.downloadingIds.has(item.referenceId), false)
  assert.deepEqual(browser.created, [blob])
  assert.equal(browser.anchors[0].href, 'blob:test-download')
  assert.equal(browser.anchors[0].download, 'LOCAL_DISPLAY_12.fasta')
  assert.equal(browser.anchors[0].clicks, 1)
  assert.equal(browser.anchors[0].removed, true)
  assert.deepEqual(browser.appended, browser.anchors)
  assert.deepEqual(browser.revoked, [])
  assert.equal(browser.timers.length, 1)
  assert.equal(browser.timers[0].delay, 1000)
  browser.timers[0].callback()
  assert.deepEqual(browser.revoked, ['blob:test-download'])
  assert.deepEqual(messages.error, [])
})

test('download names describe the stored FASTA rather than an uploaded gzip or ZIP wrapper', async (t) => {
  const browser = browserDownloads(t)
  const { state } = setupView()
  await state.downloadReference({ ...item, accession: 'archive.fna.gz' })
  assert.equal(browser.anchors[0].download, 'archive.fasta')
  assert.doesNotMatch(browser.anchors[0].href, /refseq|reference\.fna/)
})

test('download rejection never creates or saves an error Blob and clears pending state for manual retry', async (t) => {
  const browser = browserDownloads(t)
  const { state, messages, apiCalls } = setupView({ download: async () => {
    throw { failMsg: '文件接口返回错误信息而非 FASTA' }
  } })
  await state.downloadReference(item)
  assert.deepEqual(browser.created, [])
  assert.deepEqual(browser.anchors, [])
  assert.equal(state.downloadingIds.size, 0)
  assert.deepEqual(messages.error, ['文件接口返回错误信息而非 FASTA'])
  assert.equal(apiCalls.downloads.length, 1)
  await state.downloadReference(item)
  assert.equal(apiCalls.downloads.length, 2)
})

test('a completed download does not trigger browser saving after page unmount', async (t) => {
  const browser = browserDownloads(t)
  const request = deferred<Blob>()
  const { state, beforeUnmount, messages } = setupView({ download: () => request.promise })
  const pending = state.downloadReference(item)
  beforeUnmount.forEach(fn => fn())
  request.resolve(new Blob(['download test fixture']))
  await pending
  assert.deepEqual(browser.created, [])
  assert.deepEqual(browser.anchors, [])
  assert.equal(state.downloadingIds.size, 0)
  assert.deepEqual(messages.error, [])
})
