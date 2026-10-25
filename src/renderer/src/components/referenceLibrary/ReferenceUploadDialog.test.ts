import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, defineComponent, h, nextTick, reactive } from 'vue'
import type {
  ReferenceLibraryItem,
  ReferenceLibraryTarget,
  ReferenceLibraryUpload
} from '../../api/referenceLibrary'

// The shared loader compiles the actual SFC script/template/styles. Only the upload
// transport is mocked; these tests never contact a backend or read sequence content.
const api = require('../../api/referenceLibrary')
const ReferenceUploadDialog = require('./ReferenceUploadDialog.vue').default

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
  insert: (child, parent, anchor) => {
    detach(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child)
    else parent.children.splice(index, 0, child)
    child.parent = parent
  },
  remove: detach,
  parentNode: (target) => target.parent,
  nextSibling: (target) =>
    target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null
})
function find(root: HostNode, predicate: (candidate: HostNode) => boolean): HostNode | undefined {
  if (predicate(root)) return root
  for (const child of root.children) {
    const match = find(child, predicate)
    if (match) return match
  }
}
function text(root: HostNode): string {
  return (root.text ?? '') + root.children.map(text).join('')
}
function mount(target: ReferenceLibraryTarget | null = null) {
  const root = node('root')
  const props = reactive({ modelValue: true, target })
  const created: ReferenceLibraryItem[] = []
  const lookups: string[] = []
  const visibility: boolean[] = []
  const navigationLocks: boolean[] = []
  const app = renderer.createApp({
    render: () =>
      h(ReferenceUploadDialog, {
        ...props,
        onCreated: (item: ReferenceLibraryItem) => created.push(item),
        onLookup: (accession: string) => lookups.push(accession),
        onNavigationLock: (locked: boolean) => navigationLocks.push(locked),
        'onUpdate:modelValue': (value: boolean) => {
          visibility.push(value)
          props.modelValue = value
        }
      })
  })
  for (const [name, tag] of Object.entries({
    'el-dialog': 'dialog',
    'el-form': 'form',
    'el-form-item': 'label',
    'el-input': 'input',
    'el-input-number': 'number',
    'el-select': 'select',
    'el-option': 'option',
    'el-checkbox': 'checkbox',
    'el-button': 'button',
    'el-alert': 'aside',
    'el-progress': 'progress',
    'el-popconfirm': 'popconfirm'
  })) {
    app.component(
      name,
      defineComponent({
        inheritAttrs: false,
        setup:
          (_, { attrs, slots }) =>
          () =>
            h(
              tag,
              {
                ...attrs,
                modelValue: Object.hasOwn(attrs, 'modelValue')
                  ? attrs.modelValue
                  : attrs['model-value']
              },
              [slots.default?.(), slots.title?.(), slots.footer?.(), slots.reference?.()]
            )
      })
    )
  }
  app.mount(root)
  function byId(id: string): HostNode {
    const result = find(root, (candidate) => candidate.props['data-testid'] === id)
    assert.ok(result, `Missing control ${id}`)
    return result
  }
  async function update(id: string, value: unknown): Promise<void> {
    byId(id).props['onUpdate:modelValue'](value)
    await nextTick()
  }
  async function file(name = 'test.fa'): Promise<File> {
    const selected = new File(['non-biological test marker'], name)
    byId('upload-file').props.onChange({ target: { files: [selected], value: name } })
    await nextTick()
    return selected
  }
  async function valid(accession = 'LOCAL_TEST'): Promise<File> {
    const selected = await file()
    if (!props.target) {
      await update('tax-id', 123)
      await update('organism-name', '测试分类名称')
    }
    await update('accession', accession)
    return selected
  }
  function submit(): Promise<void> {
    const form = find(root, (candidate) => candidate.type === 'form')!
    return form.props.onSubmit({ preventDefault() {} })
  }
  return {
    app,
    root,
    props,
    created,
    lookups,
    visibility,
    navigationLocks,
    byId,
    update,
    file,
    valid,
    submit
  }
}
const item: ReferenceLibraryItem = {
  referenceId: 501,
  accession: 'LOCAL_TEST',
  sourceDb: 'USER_UPLOAD',
  taxId: 123,
  orgType: 0,
  organismName: null,
  genomeLength: null,
  segment: null,
  completeness: null,
  isAnnotated: false,
  enabled: true,
  fastaObjectName: null
}

test('upload dialog validates required fields without making a request and explains the scope', async (t) => {
  const original = api.uploadReferenceLibrary
  let calls = 0
  api.uploadReferenceLibrary = async () => {
    calls++
    throw new Error('must not request')
  }
  const view = mount()
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  await view.submit()
  await nextTick()
  assert.equal(calls, 0)
  assert.deepEqual(view.navigationLocks, [false])
  assert.match(text(view.root), /请选择一个参考序列文件/)
  assert.equal(view.byId('enabled').props.modelValue, true)
  assert.match(text(view.root), /256 MiB/)
  assert.match(text(view.root), /ZIP 请仅放一个文件/)
  assert.match(text(view.root), /不会自动推断/)
  assert.equal(view.byId('upload-file').props.multiple, undefined)
  assert.equal(find(view.root, (candidate) => candidate.props['data-testid'] === 'org-type'), undefined)
  assert.doesNotMatch(text(view.root), /细菌/)
  assert.match(text(view.root), /全局病毒参考上传/)
  await view.file()
  await view.submit()
  await nextTick()
  assert.match(text(view.root), /Tax ID 必须是正整数/)
  assert.equal(calls, 0)
})

test('replacement, submission locking, 100% processing, and successful form reset', async (t) => {
  const original = api.uploadReferenceLibrary
  let finish!: (response: unknown) => void
  let progress!: (percent: number | null) => void
  let uploaded!: ReferenceLibraryUpload
  let calls = 0
  api.uploadReferenceLibrary = (input: ReferenceLibraryUpload, options: any) => {
    calls++
    uploaded = input
    progress = options.onUploadProgress
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const view = mount()
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  await view.valid()
  const replacement = await view.file('replacement.zip')
  await view.update('enabled', false)
  const request = view.submit()
  await nextTick()
  assert.equal(uploaded.file, replacement)
  assert.equal(uploaded.enabled, false)
  assert.equal(uploaded.orgType, 0)
  assert.equal(uploaded.taxId, 123)
  assert.equal(uploaded.targetTaxId, undefined)
  assert.equal(uploaded.pipelineType, undefined)
  assert.notEqual(uploaded.confirmAddTaxonomyMember, true)
  assert.equal(calls, 1)
  assert.deepEqual(view.navigationLocks, [false, true])
  for (const id of [
    'upload-file',
    'tax-id',
    'accession',
    'organism-name',
    'segment',
    'completeness',
    'enabled',
    'remove-file',
    'close-upload',
    'submit-upload'
  ]) {
    assert.equal(view.byId(id).props.disabled, true, `${id} locked`)
  }
  await view.submit()
  view.byId('close-upload').props.onClick()
  const dialog = find(view.root, (candidate) => candidate.type === 'dialog')!
  dialog.props['onUpdate:modelValue'](false)
  let closeCalls = 0
  dialog.props['before-close'](() => {
    closeCalls++
  })
  assert.equal(calls, 1)
  assert.equal(closeCalls, 0)
  assert.deepEqual(view.visibility, [])
  progress(100)
  await nextTick()
  assert.match(text(view.root), /服务端校验并导入中/)
  assert.equal(view.created.length, 0)
  assert.equal(view.byId('submit-upload').props.disabled, true)
  finish({ status: 0, data: item, failMsg: null })
  await request
  await nextTick()
  assert.deepEqual(view.created, [item])
  assert.match(text(view.byId('selected-file')), /未选择文件/)
  assert.equal(view.byId('tax-id').props.modelValue, null)
  assert.equal(view.byId('accession').props.modelValue, '')
  assert.equal(view.byId('enabled').props.modelValue, true)
  assert.equal(view.byId('submit-upload').props.disabled, false)
  assert.deepEqual(view.navigationLocks, [false, true, false])
})

for (const status of [1, 3, 4]) {
  test(`documented failure status ${status} retains form and permits manual retry`, async (t) => {
    const original = api.uploadReferenceLibrary
    let calls = 0
    api.uploadReferenceLibrary = async () => {
      calls++
      return { status, data: null, failMsg: '<b>服务端普通文本错误</b>' }
    }
    const view = mount()
    t.after(() => {
      api.uploadReferenceLibrary = original
      view.app.unmount()
    })
    await view.valid()
    await view.submit()
    await nextTick()
    assert.equal(view.byId('submit-upload').props.disabled, false)
    assert.deepEqual(view.navigationLocks, [false, true, false])
    assert.equal(view.byId('accession').props.modelValue, 'LOCAL_TEST')
    assert.match(text(view.byId('selected-file')), /test.fa/)
    assert.match(text(view.root), /<b>服务端普通文本错误<\/b>/)
    assert.equal(
      find(view.root, (candidate) => candidate.type === 'b'),
      undefined
    )
    assert.equal(view.byId('lookup-accession').props.modelValue, 'LOCAL_TEST')
    assert.equal(calls, 1)
    await view.submit()
    assert.equal(calls, 2)
  })
}

test('uncertain upload stays suspended across edits and closing until lookup plus explicit confirmation', async (t) => {
  const original = api.uploadReferenceLibrary
  let calls = 0
  api.uploadReferenceLibrary = async () => {
    calls++
    return { status: 2, data: null, failMsg: '导入提交状态待确认' }
  }
  const view = mount()
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  await view.valid('  ORIGINAL_ID  ')
  await view.submit()
  await nextTick()
  assert.equal(view.byId('submit-upload').props.disabled, true)
  assert.deepEqual(view.navigationLocks, [false, true])
  assert.equal(view.byId('allow-retry').props.disabled, true)
  view.byId('allow-retry').props.onClick()
  await view.submit()
  assert.equal(calls, 1)
  await view.update('accession', 'NEW_ID')
  await view.file('changed.fna')
  assert.equal(view.byId('submit-upload').props.disabled, true)
  assert.equal(view.byId('lookup-accession').props.modelValue, 'ORIGINAL_ID')
  view.byId('close-upload').props.onClick()
  await nextTick()
  view.props.modelValue = true
  await nextTick()
  assert.equal(view.byId('submit-upload').props.disabled, true)
  assert.equal(view.byId('accession').props.modelValue, 'NEW_ID')
  assert.deepEqual(
    view.navigationLocks,
    [false, true],
    'closing and editing do not release navigation'
  )
  view.byId('lookup').props.onClick()
  await nextTick()
  assert.deepEqual(view.lookups, ['ORIGINAL_ID'])
  assert.equal(view.props.modelValue, false)
  assert.equal(calls, 1)
  view.props.modelValue = true
  await nextTick()
  assert.equal(view.byId('submit-upload').props.disabled, true)
  assert.equal(view.byId('allow-retry').props.disabled, false)
  view.byId('allow-retry').props.onClick()
  await nextTick()
  assert.equal(view.byId('submit-upload').props.disabled, false)
  assert.deepEqual(view.navigationLocks, [false, true, false])
  assert.equal(calls, 1, 'confirming is not a retry request')
  await view.submit()
  assert.equal(calls, 2)
  assert.deepEqual(view.navigationLocks, [false, true, false, true])
})

test('ending a verified upload requires confirmation and clears only local state without another request', async (t) => {
  const original = api.uploadReferenceLibrary
  let calls = 0
  api.uploadReferenceLibrary = async () => {
    calls++
    return { status: 2, data: null, failMsg: '导入提交状态待确认' }
  }
  const view = mount()
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  await view.valid('CHECKED_ID')
  await view.update('organism-name', 'test metadata')
  await view.update('segment', 'test segment')
  await view.update('completeness', 'declared text')
  await view.update('enabled', false)
  await view.submit()
  await nextTick()
  assert.equal(view.byId('end-upload').props.disabled, true)
  assert.match(view.byId('end-upload-confirm').props.title, /不会撤销服务端可能已保存的记录/)
  view.byId('end-upload-confirm').props.onConfirm()
  await nextTick()
  assert.equal(view.byId('submit-upload').props.disabled, true, 'cannot end before lookup')
  assert.equal(view.props.modelValue, true)
  view.byId('lookup').props.onClick()
  await nextTick()
  view.props.modelValue = true
  await nextTick()
  assert.equal(view.byId('end-upload').props.disabled, false)
  assert.deepEqual(view.navigationLocks, [false, true])
  assert.equal(view.byId('accession').props.modelValue, 'CHECKED_ID')
  assert.equal(calls, 1, 'querying and returning do not upload or clear the form')
  view.byId('end-upload-confirm').props.onConfirm()
  await nextTick()
  assert.equal(view.props.modelValue, false)
  assert.deepEqual(view.navigationLocks, [false, true, false])
  assert.deepEqual(view.created, [])
  assert.equal(calls, 1)
  view.props.modelValue = true
  await nextTick()
  assert.match(text(view.byId('selected-file')), /未选择文件/)
  assert.equal(view.byId('tax-id').props.modelValue, null)
  for (const id of ['accession', 'organism-name', 'segment', 'completeness']) {
    assert.equal(view.byId(id).props.modelValue, '')
  }
  assert.equal(view.byId('enabled').props.modelValue, true)
  assert.equal(view.byId('submit-upload').props.disabled, false)
  assert.equal(
    find(view.root, (candidate) => candidate.props['data-testid'] === 'lookup-accession'),
    undefined
  )
  assert.doesNotMatch(text(view.root), /导入提交状态待确认|已暂停重新提交|你已确认完成核实/)
  await view.submit()
  await nextTick()
  assert.equal(calls, 1, 'fresh submission validates the now-empty form')
  assert.match(text(view.root), /请选择一个参考序列文件/)
})

test('unknown generated accession is not extracted from error text; empty lookup shows recent records', async (t) => {
  const original = api.uploadReferenceLibrary
  api.uploadReferenceLibrary = async () => ({
    status: 2,
    data: null,
    failMsg: '请按 accession 查询：CUSTOM_do_not_parse'
  })
  const view = mount()
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  await view.valid('')
  await view.submit()
  await nextTick()
  assert.equal(view.byId('lookup-accession').props.modelValue, '')
  assert.match(text(view.byId('lookup')), /查看近期全部记录/)
  view.byId('lookup').props.onClick()
  await nextTick()
  assert.deepEqual(view.lookups, [''])
  await view.update('lookup-accession', 'MANUALLY_COPIED_ID')
  assert.equal(view.byId('allow-retry').props.disabled, true)
  view.byId('lookup').props.onClick()
  await nextTick()
  assert.deepEqual(view.lookups, ['', 'MANUALLY_COPIED_ID'])
  assert.equal(view.created.length, 0)
})

for (const [label, response, rejects, uncertain] of [
  ['network failure', new Error('network disconnected'), true, true],
  ['timeout', Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }), true, true],
  [
    'HTTP 500 status 2',
    { isAxiosError: true, response: { status: 500, data: { status: 2, failMsg: '待确认' } } },
    true,
    true
  ],
  [
    'HTTP 400 status 4',
    { isAxiosError: true, response: { status: 400, data: { status: 4, failMsg: '格式无效' } } },
    true,
    false
  ],
  [
    'HTTP gateway HTML',
    { isAxiosError: true, response: { status: 502, data: '<html>gateway</html>' } },
    true,
    true
  ],
  ['unknown response', { status: 9, data: null, failMsg: null }, false, true],
  ['missing successful data', { status: 0, data: null, failMsg: null }, false, true],
  ['malformed successful item', { status: 0, data: {}, failMsg: null }, false, true]
] as const) {
  test(`${label} is classified without automatic retransmission`, async (t) => {
    const original = api.uploadReferenceLibrary
    let calls = 0
    api.uploadReferenceLibrary = async () => {
      calls++
      if (rejects) throw response
      return response
    }
    const view = mount()
    t.after(() => {
      api.uploadReferenceLibrary = original
      view.app.unmount()
    })
    await view.valid()
    await view.submit()
    await nextTick()
    assert.equal(calls, 1)
    assert.equal(view.created.length, 0)
    assert.equal(view.byId('submit-upload').props.disabled, uncertain)
    assert.doesNotMatch(text(view.root), /<html>gateway<\/html>/)
    if (uncertain) {
      await view.submit()
      assert.equal(calls, 1)
      assert.match(text(view.root), /服务端可能已经保存记录/)
    }
  })
}

test('late response after unmount emits no success into a different page', async (t) => {
  const original = api.uploadReferenceLibrary
  let finish!: (response: unknown) => void
  api.uploadReferenceLibrary = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const view = mount()
  t.after(() => {
    api.uploadReferenceLibrary = original
  })
  await view.valid()
  const request = view.submit()
  assert.deepEqual(view.navigationLocks, [false, true])
  view.app.unmount()
  assert.deepEqual(view.navigationLocks, [false, true, false])
  finish({ status: 0, data: item, failMsg: null })
  await request
  assert.deepEqual(view.created, [])
  assert.deepEqual(
    view.navigationLocks,
    [false, true, false],
    'late completion does not change navigation'
  )
})

const target: ReferenceLibraryTarget = {
  taxId: 700001,
  pipelineType: 100,
  label: '测试专项'
}

for (const scoped of [false, true]) {
  test(`${scoped ? 'target' : 'global'} upload requires an explicitly nonblank classification name`, async t => {
    const original = api.uploadReferenceLibrary
    let calls = 0
    api.uploadReferenceLibrary = async () => { calls++; return { status: 0, data: item, failMsg: null } }
    const view = mount(scoped ? target : null)
    t.after(() => { api.uploadReferenceLibrary = original; view.app.unmount() })
    assert.equal(view.byId('organism-name').props.modelValue, scoped ? target.label : '')
    const label = find(view.root, candidate => candidate.props.label === '分类名称（必填）')
    assert.ok(label)
    assert.notEqual(label.props.required, undefined)
    assert.equal(find(view.root, candidate => candidate.props.label === '分类名称（可选）'), undefined)
    await view.valid()
    for (const empty of ['', '   ', '\t\n']) {
      await view.update('organism-name', empty)
      await view.submit()
      await nextTick()
      assert.equal(calls, 0)
      assert.match(text(view.root), /分类名称/)
      assert.equal(view.byId('organism-name').props.modelValue, empty, 'clearing must not silently restore a fallback')
    }
    await view.update('organism-name', '用户填写的分类名称')
    await view.submit()
    assert.equal(calls, 1)
  })
}

test('switching targets updates automatic names and clears a target suggestion when returning to global upload', async t => {
  const view = mount()
  t.after(() => view.app.unmount())
  view.props.target = target
  await nextTick()
  assert.equal(view.byId('organism-name').props.modelValue, target.label)
  view.props.target = { taxId: 700002, pipelineType: 100, label: '第二专项' }
  await nextTick()
  assert.equal(view.byId('organism-name').props.modelValue, '第二专项')
  view.props.target = null
  await nextTick()
  assert.equal(view.byId('organism-name').props.modelValue, '')
})

test('switching targets or reopening a form preserves a name edited by the user', async t => {
  const view = mount(target)
  t.after(() => view.app.unmount())
  await view.update('organism-name', '自定义分类名称')
  view.props.target = { taxId: 700002, pipelineType: 100, label: '第二专项' }
  await nextTick()
  assert.equal(view.byId('organism-name').props.modelValue, '自定义分类名称')
  view.props.modelValue = false
  await nextTick()
  view.props.modelValue = true
  await nextTick()
  assert.equal(view.byId('organism-name').props.modelValue, '自定义分类名称')
  view.props.target = null
  await nextTick()
  assert.equal(view.byId('organism-name').props.modelValue, '自定义分类名称')
})

function membershipRequired(input: ReferenceLibraryUpload) {
  return {
    status: 1,
    data: null,
    failMsg: '需要确认归属',
    code: 'REFERENCE_TARGET_MEMBERSHIP_CONFIRMATION_REQUIRED',
    confirmation: {
      targetTaxId: input.targetTaxId,
      pipelineType: input.pipelineType,
      taxId: input.taxId
    }
  }
}

test('clearing a name while awaiting membership confirmation cancels consent and blocks resubmission', async t => {
  const original = api.uploadReferenceLibrary
  let calls = 0
  api.uploadReferenceLibrary = async (input: ReferenceLibraryUpload) => {
    calls++
    return membershipRequired(input)
  }
  const view = mount(target)
  t.after(() => { api.uploadReferenceLibrary = original; view.app.unmount() })
  await view.valid()
  await view.submit()
  await nextTick()
  const approve = view.byId('confirm-membership').props.onClick
  await view.update('organism-name', '')
  await approve()
  await view.submit()
  await nextTick()
  assert.equal(calls, 1)
  assert.match(text(view.root), /分类名称/)
  assert.equal(find(view.root, candidate => candidate.props['data-testid'] === 'membership-confirmation'), undefined)
})

test('target upload hides taxId input and autofills both taxIds with fixed virus category', async (t) => {
  const original = api.uploadReferenceLibrary
  let uploaded!: ReferenceLibraryUpload
  api.uploadReferenceLibrary = async (input: ReferenceLibraryUpload) => {
    uploaded = input
    return { status: 0, data: { ...item, taxId: target.taxId }, failMsg: null }
  }
  const view = mount(target)
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  assert.equal(find(view.root, (candidate) => candidate.props['data-testid'] === 'tax-id'), undefined)
  assert.equal(find(view.root, (candidate) => candidate.props['data-testid'] === 'org-type'), undefined)
  assert.match(text(view.root), /上传到专项：测试专项/)
  assert.match(text(view.root), /不会修改已有参考的分类/)
  const file = await view.valid()
  await view.submit()
  await nextTick()
  assert.equal(uploaded.file, file)
  assert.equal(uploaded.taxId, target.taxId)
  assert.equal(uploaded.targetTaxId, target.taxId)
  assert.equal(uploaded.pipelineType, target.pipelineType)
  assert.equal(uploaded.orgType, 0)
  assert.equal(uploaded.confirmAddTaxonomyMember, false)
  assert.equal(uploaded.organismName, target.label)
  assert.equal(view.byId('organism-name').props.modelValue, target.label, 'successful reset restores the target default')
  assert.equal(view.created.length, 1)
  assert.equal(find(view.root, (candidate) => candidate.props['data-testid'] === 'membership-confirmation'), undefined)
})

test('membership approval alone resubmits original file and fields with explicit true', async (t) => {
  const original = api.uploadReferenceLibrary
  const uploads: ReferenceLibraryUpload[] = []
  api.uploadReferenceLibrary = async (input: ReferenceLibraryUpload) => {
    uploads.push(input)
    return uploads.length === 1
      ? membershipRequired(input)
      : { status: 0, data: item, failMsg: null }
  }
  const view = mount(target)
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  const file = await view.valid('TEST_SNAPSHOT')
  await view.update('organism-name', '用户声明名称')
  await view.update('segment', '用户声明节段')
  await view.update('completeness', '用户声明完整性')
  await view.update('enabled', false)
  await view.submit()
  await nextTick()
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].confirmAddTaxonomyMember, false)
  assert.match(text(view.byId('membership-confirmation')), /已有及后续参考纳入当前专项范围/)
  assert.match(text(view.root), /其他专项选项也可能受影响/)
  assert.doesNotMatch(text(view.root), /提交结果待核实，已暂停/)
  assert.deepEqual(view.navigationLocks, [false, true, false])
  assert.equal(view.byId('submit-upload').props.disabled, true)
  assert.equal(view.byId('close-upload').props.disabled, false)
  await view.submit()
  assert.equal(uploads.length, 1)
  const approve = view.byId('confirm-membership').props.onClick
  const resubmission = approve()
  await approve()
  await resubmission
  await nextTick()
  assert.equal(uploads.length, 2, 'double approval does not submit twice')
  assert.deepEqual(uploads[1], { ...uploads[0], confirmAddTaxonomyMember: true })
  assert.equal(uploads[1].file, file)
  assert.deepEqual(view.created, [item])
  assert.deepEqual(view.navigationLocks, [false, true, false, true, false])
})

test('cancelling membership preserves file and form and does not resubmit or authorize the next request', async (t) => {
  const original = api.uploadReferenceLibrary
  const uploads: ReferenceLibraryUpload[] = []
  api.uploadReferenceLibrary = async (input: ReferenceLibraryUpload) => {
    uploads.push(input)
    return membershipRequired(input)
  }
  const view = mount(target)
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  const file = await view.valid()
  await view.submit()
  await nextTick()
  const oldApprove = view.byId('confirm-membership').props.onClick
  view.byId('cancel-membership').props.onClick()
  await nextTick()
  await oldApprove()
  assert.equal(uploads.length, 1)
  assert.match(text(view.byId('selected-file')), /test.fa/)
  assert.equal(view.byId('accession').props.modelValue, 'LOCAL_TEST')
  assert.equal(view.byId('submit-upload').props.disabled, false)
  await view.submit()
  assert.equal(uploads.length, 2)
  assert.equal(uploads[1].confirmAddTaxonomyMember, false)
  assert.equal(uploads[1].file, file)
})

for (const edit of ['accession', 'organism-name', 'segment', 'completeness', 'enabled', 'file']) {
  test(`editing ${edit} invalidates a pending membership authorization`, async (t) => {
    const original = api.uploadReferenceLibrary
    const uploads: ReferenceLibraryUpload[] = []
    api.uploadReferenceLibrary = async (input: ReferenceLibraryUpload) => {
      uploads.push(input)
      return membershipRequired(input)
    }
    const view = mount(target)
    t.after(() => {
      api.uploadReferenceLibrary = original
      view.app.unmount()
    })
    await view.valid()
    await view.submit()
    await nextTick()
    const oldApprove = view.byId('confirm-membership').props.onClick
    if (edit === 'file') await view.file('replacement.fa')
    else await view.update(edit, edit === 'enabled' ? false : 'CHANGED_VALUE')
    await oldApprove()
    assert.equal(uploads.length, 1)
    assert.equal(find(view.root, (candidate) => candidate.props['data-testid'] === 'membership-confirmation'), undefined)
    assert.equal(view.byId('submit-upload').props.disabled, false)
    await view.submit()
    assert.equal(uploads[1].confirmAddTaxonomyMember, false)
  })
}

for (const close of ['button', 'dialog', 'prop']) {
  test(`closing through ${close} discards membership confirmation without a retry`, async (t) => {
    const original = api.uploadReferenceLibrary
    let calls = 0
    api.uploadReferenceLibrary = async (input: ReferenceLibraryUpload) => {
      calls++
      return membershipRequired(input)
    }
    const view = mount(target)
    t.after(() => {
      api.uploadReferenceLibrary = original
      view.app.unmount()
    })
    await view.valid()
    await view.submit()
    await nextTick()
    const oldApprove = view.byId('confirm-membership').props.onClick
    if (close === 'button') view.byId('close-upload').props.onClick()
    else if (close === 'dialog') {
      const dialog = find(view.root, (candidate) => candidate.type === 'dialog')!
      dialog.props['before-close'](() => { view.props.modelValue = false })
    } else view.props.modelValue = false
    await nextTick()
    view.props.modelValue = true
    await nextTick()
    await oldApprove()
    assert.equal(calls, 1)
    assert.equal(view.byId('submit-upload').props.disabled, false)
    assert.match(text(view.byId('selected-file')), /test.fa/)
    assert.equal(find(view.root, (candidate) => candidate.props['data-testid'] === 'membership-confirmation'), undefined)
  })
}

test('target change clears membership snapshot, including two pipeline types sharing a taxId', async (t) => {
  const original = api.uploadReferenceLibrary
  const uploads: ReferenceLibraryUpload[] = []
  api.uploadReferenceLibrary = async (input: ReferenceLibraryUpload) => {
    uploads.push(input)
    return membershipRequired(input)
  }
  const view = mount({ ...target, taxId: 2697049 })
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  await view.valid()
  await view.submit()
  await nextTick()
  const oldApprove = view.byId('confirm-membership').props.onClick
  view.props.target = { taxId: 2697049, pipelineType: 101, label: '另一专项' }
  await nextTick()
  await oldApprove()
  assert.equal(uploads.length, 1)
  assert.equal(view.byId('submit-upload').props.disabled, false)
  assert.equal(find(view.root, (candidate) => candidate.props['data-testid'] === 'membership-confirmation'), undefined)
  await view.submit()
  assert.equal(uploads.length, 2)
  assert.equal(uploads[1].pipelineType, 101)
  assert.equal(uploads[1].confirmAddTaxonomyMember, false)
  view.props.target = null
  await nextTick()
  await view.update('tax-id', 700002)
  await view.update('organism-name', '全局分类名称')
  await view.submit()
  assert.equal(uploads[2].taxId, 700002)
  assert.equal(uploads[2].targetTaxId, undefined)
  assert.equal(uploads[2].pipelineType, undefined)
  assert.notEqual(uploads[2].confirmAddTaxonomyMember, true)
})

for (const mismatch of ['code', 'status', 'data', 'targetTaxId', 'pipelineType', 'taxId', 'missing']) {
  test(`membership response with invalid ${mismatch} never grants confirmation controls`, async (t) => {
    const original = api.uploadReferenceLibrary
    let calls = 0
    api.uploadReferenceLibrary = async (input: ReferenceLibraryUpload) => {
      calls++
      const response: any = membershipRequired(input)
      if (mismatch === 'code') response.code = 'OTHER_BUSINESS_FAILURE'
      else if (mismatch === 'status') response.status = 4
      else if (mismatch === 'data') response.data = {}
      else if (mismatch === 'missing') delete response.confirmation
      else response.confirmation[mismatch]++
      return response
    }
    const view = mount(target)
    t.after(() => {
      api.uploadReferenceLibrary = original
      view.app.unmount()
    })
    await view.valid()
    await view.submit()
    await nextTick()
    assert.equal(calls, 1)
    assert.equal(find(view.root, (candidate) => candidate.props['data-testid'] === 'confirm-membership'), undefined)
    assert.equal(view.created.length, 0)
    assert.match(text(view.root), /需要确认归属/)
  })
}

test('target switch while uploading rejects stale confirmation and preserves original result verification', async (t) => {
  const original = api.uploadReferenceLibrary
  let finish!: (response: unknown) => void
  let uploaded!: ReferenceLibraryUpload
  let reportProgress!: (value: number) => void
  api.uploadReferenceLibrary = (input: ReferenceLibraryUpload, options: any) => {
    uploaded = input
    reportProgress = options.onUploadProgress
    return new Promise((resolve) => { finish = resolve })
  }
  const view = mount(target)
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  await view.valid('ORIGINAL_SCOPE_ID')
  const request = view.submit()
  await nextTick()
  view.props.target = { taxId: 700003, pipelineType: 100, label: '新的专项' }
  await nextTick()
  reportProgress(100)
  finish(membershipRequired(uploaded))
  await request
  await nextTick()
  assert.equal(find(view.root, (candidate) => candidate.props['data-testid'] === 'confirm-membership'), undefined)
  assert.match(text(view.root), /本次提交范围：测试专项/)
  assert.equal(view.byId('organism-name').props.modelValue, target.label, 'an unresolved upload retains the submitted name')
  assert.equal(view.byId('lookup-accession').props.modelValue, 'ORIGINAL_SCOPE_ID')
  assert.equal(view.byId('submit-upload').props.disabled, true)
  assert.deepEqual(view.navigationLocks, [false, true])
  assert.deepEqual(view.created, [])
  view.byId('lookup').props.onClick()
  assert.deepEqual(view.lookups, ['ORIGINAL_SCOPE_ID'])
})

test('network error after explicit membership approval remains uncertain and does not auto retry', async (t) => {
  const original = api.uploadReferenceLibrary
  const uploads: ReferenceLibraryUpload[] = []
  api.uploadReferenceLibrary = async (input: ReferenceLibraryUpload) => {
    uploads.push(input)
    if (uploads.length === 1) return membershipRequired(input)
    throw new Error('network disconnected')
  }
  const view = mount(target)
  t.after(() => {
    api.uploadReferenceLibrary = original
    view.app.unmount()
  })
  await view.valid()
  await view.submit()
  await nextTick()
  await view.byId('confirm-membership').props.onClick()
  await nextTick()
  assert.equal(uploads.length, 2)
  assert.equal(uploads[1].confirmAddTaxonomyMember, true)
  assert.equal(view.byId('submit-upload').props.disabled, true)
  assert.match(text(view.root), /提交结果待核实/)
  assert.deepEqual(view.navigationLocks, [false, true, false, true])
  view.byId('lookup').props.onClick()
  await nextTick()
  view.props.modelValue = true
  await nextTick()
  view.byId('allow-retry').props.onClick()
  await view.submit()
  assert.equal(uploads.length, 3)
  assert.equal(uploads[2].confirmAddTaxonomyMember, false, 'fresh manual retry does not retain earlier consent')
})
