import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { AxiosError, isCancel, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { backendService } from './backendService'
import {
  REFERENCE_UPLOAD_MAX_BYTES,
  REFERENCE_TARGET_MEMBERSHIP_CONFIRMATION_REQUIRED,
  buildReferenceUploadFormData,
  downloadReferenceLibraryFile,
  getReferenceDownloadName,
  getReferenceLibraryErrorMessage,
  getReferenceLibraryFailureStatus,
  getReferenceLibraryItem,
  isReferenceMembershipConfirmation,
  queryReferenceLibrary,
  setReferenceLibraryEnabled,
  uploadReferenceLibrary,
  validateReferenceUpload,
  type ReferenceLibraryItem,
  type ReferenceLibraryUpload
} from './referenceLibrary'

function useAdapter(t: TestContext, next: AxiosAdapter): void {
  const previous = backendService.defaults.adapter
  backendService.defaults.adapter = next
  t.after(() => { backendService.defaults.adapter = previous })
}

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200) {
  return { config, data, status, statusText: status === 200 ? 'OK' : 'Error', headers: {} }
}

const item: ReferenceLibraryItem = {
  referenceId: 501,
  accession: 'DEMO_001',
  sourceDb: 'USER_UPLOAD',
  taxId: 123,
  orgType: 0,
  organismName: null,
  genomeLength: 1,
  segment: null,
  completeness: null,
  isAnnotated: false,
  enabled: false,
  fastaObjectName: null
}

function upload(overrides: Partial<ReferenceLibraryUpload> = {}): ReferenceLibraryUpload {
  return {
    // Content deliberately is not a biological fixture: the client checks file metadata only.
    file: new File(['upload fixture only'], 'reference.fa', { type: 'text/plain' }),
    taxId: 123,
    orgType: 0,
    organismName: '示例分类名称',
    enabled: true,
    ...overrides
  }
}

test('query uses the new endpoint and exact JSON filters, preserves false and row offset', async t => {
  const controller = new AbortController()
  const accession = 'A&B%2F:C_1'
  const expected = { status: 0, data: { total: 1, start: 40, pageSize: 20, items: [item] }, failMsg: null }
  useAdapter(t, async config => {
    assert.equal(config.method, 'post')
    assert.equal(config.url, '/referenceGenome/library/query')
    assert.equal(new URL(backendService.getUri(config)).pathname, '/referenceGenome/library/query')
    assert.equal(config.signal, controller.signal)
    assert.equal(config.timeout, 30000)
    assert.deepEqual(JSON.parse(config.data), {
      start: 40, pageSize: 20, taxId: 123, orgType: 0, enabled: false, accession
    })
    return response(config, expected)
  })
  const result = await queryReferenceLibrary({
    start: 40, pageSize: 20, taxId: 123, orgType: 0, enabled: false, accession: ` ${accession} `
  }, controller.signal)
  assert.deepEqual(result, expected, 'the shared interceptor has already removed the Axios data envelope')
})

test('query defaults include disabled records and leave empty optional filters out', async t => {
  const expected = { status: 0, data: { total: 0, start: 0, pageSize: 20, items: [] }, failMsg: null }
  let calls = 0
  useAdapter(t, async config => {
    calls++
    assert.deepEqual(JSON.parse(config.data), { start: 0, pageSize: 20 })
    return response(config, expected)
  })
  assert.deepEqual(await queryReferenceLibrary(), expected)
  assert.deepEqual(await queryReferenceLibrary({ taxId: null, orgType: null, enabled: null, accession: ' ' }), expected)
  assert.equal(calls, 2)
})

test('invalid query bounds and IDs do not send requests', async t => {
  let calls = 0
  useAdapter(t, async config => { calls++; return response(config, {}) })
  for (const query of [
    { start: -1 }, { start: 0.5 }, { pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 },
    { taxId: 0 }, { taxId: 1.5 }, { orgType: 100 as any }, { enabled: 'false' as any },
    { accession: 'A'.repeat(65) }, { accession: 'A\nB' }
  ]) {
    await assert.rejects(queryReferenceLibrary(query))
  }
  await assert.rejects(getReferenceLibraryItem(0), /正整数/)
  await assert.rejects(getReferenceLibraryItem(1.5), /正整数/)
  await assert.rejects(setReferenceLibraryEnabled(-1, false), /正整数/)
  await assert.rejects(setReferenceLibraryEnabled(501, null as any), /true 或 false/)
  assert.equal(calls, 0)
})

test('detail and enabled actions use referenceId and submit a real JSON boolean', async t => {
  const controller = new AbortController()
  const calls: string[] = []
  useAdapter(t, async config => {
    calls.push(config.url!)
    assert.equal(config.timeout, 30000)
    if (config.method === 'get') {
      assert.equal(config.url, '/referenceGenome/library/501')
      assert.equal(config.signal, controller.signal)
      assert.equal(config.data, undefined)
    } else {
      assert.equal(config.url, '/referenceGenome/library/501/enabled')
      assert.deepEqual(JSON.parse(config.data), { enabled: false })
    }
    return response(config, { status: 0, data: item, failMsg: null })
  })
  assert.deepEqual((await getReferenceLibraryItem(501, controller.signal)).data, item)
  assert.equal((await setReferenceLibraryEnabled(501, false)).data?.enabled, false)
  assert.deepEqual(calls, ['/referenceGenome/library/501', '/referenceGenome/library/501/enabled'])
})

test('HTTP 200 business status codes remain unchanged, including null data', async t => {
  let status = 0
  useAdapter(t, async config => response(config, {
    status,
    data: status === 0 ? item : null,
    failMsg: status === 0 ? null : `失败 ${status}`
  }))
  for (status of [0, 1, 2, 3, 4]) {
    const result = await setReferenceLibraryEnabled(501, true)
    assert.equal(result.status, status)
    assert.deepEqual(result.data, status === 0 ? item : null)
    assert.equal(getReferenceLibraryFailureStatus(result), status)
    if (status !== 0) assert.equal(getReferenceLibraryErrorMessage(result, 'fallback'), `失败 ${status}`)
  }
})

test('HTTP 400/500 remain rejected and preserve JSON messages and business codes', async t => {
  let httpStatus = 400
  let bodyStatus = 4
  const failure = new AxiosError('request failed', 'ERR_BAD_RESPONSE')
  const message = '导入提交状态待确认，请按 accession 查询后再重试：CUSTOM_test'
  useAdapter(t, async config => {
    failure.response = response(config, { status: bodyStatus, data: null, failMsg: message }, httpStatus)
    throw failure
  })
  for (const pair of [[400, 4], [500, 2]]) {
    ;[httpStatus, bodyStatus] = pair
    await assert.rejects(queryReferenceLibrary(), error => error === failure)
    assert.equal(getReferenceLibraryFailureStatus(failure), bodyStatus)
    assert.equal(getReferenceLibraryErrorMessage(failure, 'fallback'), message)
  }
})

test('error helpers do not expose HTML, raw text, stack messages or HTTP codes as business codes', () => {
  const html = '<html><body>internal gateway path</body></html>'
  const failure = new AxiosError(html, 'ERR_BAD_RESPONSE')
  failure.response = { data: html, status: 500, statusText: 'Error', headers: {}, config: {} as any }
  for (const value of [html, failure, null, undefined, [], new Error(html), { failMsg: '' }, { failMsg: null }]) {
    assert.equal(getReferenceLibraryErrorMessage(value, '上传失败，请核实状态'), '上传失败，请核实状态')
    assert.equal(getReferenceLibraryFailureStatus(value), null)
  }
  assert.equal(getReferenceLibraryErrorMessage({ failMsg: '  参数无效  ' }, 'fallback'), '参数无效')
  for (const status of ['4', -1, NaN, Infinity, 1.5]) {
    assert.equal(getReferenceLibraryFailureStatus({ status }), null)
  }
})

test('HTTP 413 without a JSON message explains the upload size limit without exposing HTML', () => {
  const failure = new AxiosError('Request failed with status code 413', 'ERR_BAD_REQUEST')
  failure.response = {
    data: '<html>gateway internal error page</html>',
    status: 413,
    statusText: 'Content Too Large',
    headers: {},
    config: {} as any
  }
  assert.equal(
    getReferenceLibraryErrorMessage(failure, '上传失败'),
    '上传被服务器或网关拒绝：请求超过大小限制'
  )
  assert.equal(getReferenceLibraryFailureStatus(failure), null)
  failure.response.data = { status: 4, data: null, failMsg: '文件超过当前服务端配置的上限' }
  assert.equal(getReferenceLibraryErrorMessage(failure, '上传失败'), '文件超过当前服务端配置的上限')
  assert.equal(getReferenceLibraryFailureStatus(failure), 4)
  for (const status of [400, 500]) {
    failure.response.status = status
    failure.response.data = '<html>do not display this</html>'
    assert.equal(getReferenceLibraryErrorMessage(failure, '读取失败'), '读取失败')
    assert.equal(getReferenceLibraryFailureStatus(failure), null)
  }
})

test('upload file validation checks supported suffix, nonempty size and the exact byte limit only', () => {
  assert.equal(REFERENCE_UPLOAD_MAX_BYTES, 268435456)
  assert.match(validateReferenceUpload(upload({ file: null })), /请选择/)
  assert.match(validateReferenceUpload(upload({ file: new File([], 'empty.fa') })), /不能为空/)
  for (const name of ['x.fa', 'x.FASTA', 'x.fna', 'x.fasta.gz', 'x.GZIP', 'single-file.ZIP']) {
    assert.equal(validateReferenceUpload(upload({ file: new File(['fixture'], name) })), '', name)
  }
  for (const name of ['x.fastq', 'x.fa.txt', 'x.zip.bak', 'x', 'x.tar']) {
    assert.match(validateReferenceUpload(upload({ file: new File(['fixture'], name) })), /请选择/)
  }
  const file = new File(['metadata size fixture'], 'size.fa')
  Object.defineProperty(file, 'size', { value: REFERENCE_UPLOAD_MAX_BYTES, configurable: true })
  assert.equal(validateReferenceUpload(upload({ file })), '')
  Object.defineProperty(file, 'size', { value: REFERENCE_UPLOAD_MAX_BYTES + 1 })
  assert.match(validateReferenceUpload(upload({ file })), /256 MiB/)
})

test('metadata validation requires numeric IDs, an orgType and a boolean enabled flag', () => {
  for (const taxId of [null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '123' as any]) {
    assert.match(validateReferenceUpload(upload({ taxId })), /Tax ID/)
  }
  for (const orgType of [null, 2, 100, 200, '0', '1']) {
    assert.match(validateReferenceUpload(upload({ orgType: orgType as any })), /类别/)
  }
  assert.match(validateReferenceUpload(upload({ enabled: null as any })), /启用/)
  assert.equal(validateReferenceUpload(upload({ taxId: 1, orgType: 1, enabled: false })), '')
  assert.equal(validateReferenceUpload(upload({ taxId: 1, orgType: 0, enabled: false })), '')
})

test('metadata is trimmed and validated against documented lengths and characters', () => {
  const limits = { accession: 64, organismName: 255, segment: 64, completeness: 32 }
  for (const [field, maximum] of Object.entries(limits)) {
    assert.equal(validateReferenceUpload(upload({ [field]: ` ${'A'.repeat(maximum)} ` })), '', field)
    assert.match(validateReferenceUpload(upload({ [field]: 'A'.repeat(maximum + 1) })), /不能超过/)
    assert.match(validateReferenceUpload(upload({ [field]: 'A\u0000B' })), /控制字符/)
    assert.match(validateReferenceUpload(upload({ [field]: 'A\u0085B' })), /控制字符/)
  }
  assert.equal(validateReferenceUpload(upload({ accession: ' A1._:-z ', organismName: ' 示例名称 ', segment: '\t ' })), '')
  for (const accession of ['_starts-with-underscore', 'has space', 'path/name', 'not&allowed']) {
    assert.match(validateReferenceUpload(upload({ accession })), /accession/)
  }
})

test('global and target uploads require a nonblank text classification name before any request', async t => {
  let requests = 0
  useAdapter(t, async config => { requests++; return response(config, {}) })
  for (const context of [{}, { taxId: 700001, targetTaxId: 700001, pipelineType: 100 as const }]) {
    const missingName = upload(context)
    delete (missingName as Partial<ReferenceLibraryUpload>).organismName
    const invalidInputs = [
      missingName,
      ...[undefined, null, '', '   ', '\t\n ', 123, {}, []].map(organismName =>
        upload({ ...context, organismName: organismName as any })
      )
    ]
    for (const input of invalidInputs) {
      assert.equal(validateReferenceUpload(input), '请填写分类名称')
      assert.throws(() => buildReferenceUploadFormData(input), /请填写分类名称/)
      await assert.rejects(uploadReferenceLibrary(input), /请填写分类名称/)
    }
  }
  assert.equal(requests, 0)
})

test('FormData includes only independent allowed fields, omits blank optional values and retains false', () => {
  const input = upload({
    enabled: false, accession: ' DEMO_001 ', organismName: ' 示例名称 ', segment: '   ', completeness: ''
  })
  const form = buildReferenceUploadFormData({ ...input, sourceDb: 'must-not-be-sent' } as ReferenceLibraryUpload)
  assert.deepEqual(Array.from(form.keys()), ['file', 'taxId', 'orgType', 'enabled', 'organismName', 'accession'])
  assert.equal(form.get('file'), input.file)
  assert.equal(form.get('taxId'), '123')
  assert.equal(form.get('orgType'), '0')
  assert.equal(form.get('enabled'), 'false')
  assert.equal(form.get('accession'), 'DEMO_001')
  assert.equal(form.get('organismName'), '示例名称')
  assert.equal(form.has('sourceDb'), false)
  assert.equal(form.has('metadata'), false)
  assert.throws(() => buildReferenceUploadFormData(upload({ file: null })), /请选择/)
})

test('validation and FormData building never read sequence or archive contents', () => {
  const input = upload()
  for (const method of ['text', 'arrayBuffer', 'stream']) {
    Object.defineProperty(input.file!, method, {
      value: () => { throw new Error('client must not read sequence contents') }
    })
  }
  assert.equal(validateReferenceUpload(input), '')
  assert.equal(buildReferenceUploadFormData(input).get('file'), input.file)
})

test('upload has no request timeout, uses browser multipart headers and waits past send progress 100', async t => {
  const controller = new AbortController()
  const progress: Array<number | null> = []
  let finish!: () => void
  let calls = 0
  const interceptor = backendService.interceptors.request.use(config => {
    assert.equal(config.headers.get('Content-Type'), undefined, 'no manual multipart header before Axios dispatch')
    return config
  })
  t.after(() => backendService.interceptors.request.eject(interceptor))
  useAdapter(t, async config => {
    calls++
    assert.equal(config.url, '/referenceGenome/library/upload')
    assert.equal(config.method, 'post')
    assert.equal(config.timeout, 0)
    assert.equal(config.signal, controller.signal)
    assert.ok(config.data instanceof FormData)
    assert.equal(config.data.get('enabled'), 'false')
    for (const event of [
      { loaded: 1 }, { loaded: 1, total: 10 }, { loaded: 999, total: 1000 },
      { loaded: 1000, total: 1000 }, { loaded: 1001, total: 1000 }, { loaded: 0, total: 0 }
    ]) config.onUploadProgress!(event as any)
    return new Promise(resolve => {
      finish = () => resolve(response(config, { status: 0, data: item, failMsg: null }))
    })
  })
  let settled = false
  const pending = uploadReferenceLibrary(upload({ enabled: false }), {
    signal: controller.signal,
    onUploadProgress: percent => progress.push(percent)
  }).then(result => { settled = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(progress, [null, 10, 99, 100, 100, null])
  assert.equal(settled, false, 'sending all bytes does not mean the import has committed')
  finish()
  assert.deepEqual((await pending).data, item)
  assert.equal(calls, 1)
})

test('upload HTTP failure and cancellation stay rejected, and no automatic retry occurs', async t => {
  let calls = 0
  const failure = new AxiosError('network failed', 'ERR_NETWORK')
  useAdapter(t, async () => { calls++; throw failure })
  await assert.rejects(uploadReferenceLibrary(upload()), error => error === failure)
  assert.equal(calls, 1)
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(uploadReferenceLibrary(upload(), { signal: cancelled.signal }), isCancel)
  assert.equal(calls, 1, 'pre-cancelled upload must not reach the adapter')
  await assert.rejects(uploadReferenceLibrary(upload({ taxId: 0 })), /Tax ID/)
  assert.equal(calls, 1)
})

test('read cancellation reaches Axios and cannot resolve as an empty successful list', async t => {
  const controller = new AbortController()
  useAdapter(t, async config => {
    assert.equal(config.signal, controller.signal)
    controller.abort()
    return response(config, { status: 0, data: { total: 0, start: 0, pageSize: 20, items: [] }, failMsg: null })
  })
  await assert.rejects(queryReferenceLibrary({}, controller.signal), isCancel)
})

test('target queries send both context fields, retain orgType zero, and keep actual taxId separate', async t => {
  const requests: unknown[] = []
  useAdapter(t, async config => {
    requests.push(JSON.parse(config.data))
    return response(config, { status: 0, data: { total: 0, start: 0, pageSize: 20, items: [] }, failMsg: null })
  })
  await queryReferenceLibrary({ targetTaxId: 700001, pipelineType: 100, orgType: 0, taxId: 700002 })
  await queryReferenceLibrary({ targetTaxId: 2697049, pipelineType: 101, orgType: 0, enabled: false })
  await queryReferenceLibrary({ targetTaxId: null, pipelineType: null, orgType: 1 })
  assert.deepEqual(requests, [
    { start: 0, pageSize: 20, taxId: 700002, orgType: 0, targetTaxId: 700001, pipelineType: 100 },
    { start: 0, pageSize: 20, orgType: 0, enabled: false, targetTaxId: 2697049, pipelineType: 101 },
    { start: 0, pageSize: 20, orgType: 1 }
  ])
})

test('incomplete, invalid and wastewater contexts fail without a whole-library fallback', async t => {
  let requests = 0
  useAdapter(t, async config => { requests++; return response(config, {}) })
  for (const context of [
    { targetTaxId: 700001 }, { pipelineType: 100 }, { targetTaxId: 0, pipelineType: 100 },
    { targetTaxId: 1.5, pipelineType: 100 }, { targetTaxId: 700001, pipelineType: 102 },
    { targetTaxId: 700001, pipelineType: 101 }, { targetTaxId: '700001', pipelineType: 100 },
    { targetTaxId: 700001, pipelineType: '100' }
  ]) {
    await assert.rejects(queryReferenceLibrary(context as any), /专项|Tax ID/)
    assert.match(validateReferenceUpload(upload(context as any)), /专项|Tax ID/)
  }
  await assert.rejects(queryReferenceLibrary({ orgType: 2 as any }), /类别/)
  assert.equal(requests, 0)
})

test('target uploads keep required auto-filled taxId and only serialize explicitly requested approval', () => {
  const input = upload({ taxId: 700001, targetTaxId: 700001, pipelineType: 100 })
  const initial = buildReferenceUploadFormData(input)
  assert.equal(initial.get('file'), input.file)
  assert.equal(initial.get('taxId'), '700001')
  assert.equal(initial.get('targetTaxId'), '700001')
  assert.equal(initial.get('pipelineType'), '100')
  assert.equal(initial.get('orgType'), '0')
  assert.equal(initial.get('organismName'), '示例分类名称')
  assert.equal(initial.has('confirmAddTaxonomyMember'), false)
  for (const confirmed of [false, true]) {
    const form = buildReferenceUploadFormData({ ...input, confirmAddTaxonomyMember: confirmed })
    assert.equal(form.get('confirmAddTaxonomyMember'), String(confirmed))
    assert.equal(form.get('file'), input.file)
  }
  assert.equal(validateReferenceUpload(upload({
    taxId: 2697049, targetTaxId: 2697049, pipelineType: 101
  })), '')
})

test('global uploads omit target context and reject approval without a target', () => {
  const form = buildReferenceUploadFormData(upload())
  assert.equal(form.get('taxId'), '123')
  assert.equal(form.get('organismName'), '示例分类名称')
  for (const field of ['targetTaxId', 'pipelineType', 'confirmAddTaxonomyMember']) {
    assert.equal(form.has(field), false)
  }
  assert.match(validateReferenceUpload(upload({ confirmAddTaxonomyMember: true })), /没有专项/)
  assert.match(validateReferenceUpload(upload({ confirmAddTaxonomyMember: 'true' as any })), /布尔/)
  assert.match(validateReferenceUpload(upload({
    taxId: 700001, targetTaxId: 700001, pipelineType: 100, orgType: 1
  })), /病毒/)
  assert.match(validateReferenceUpload(upload({ targetTaxId: 700001, pipelineType: 100 })), /一致/)
})

test('membership confirmation matches exact code, status, empty data and the submitted context', () => {
  const input = upload({ taxId: 700001, targetTaxId: 700001, pipelineType: 100 })
  const expected = {
    status: 1,
    data: null,
    failMsg: 'This text may change',
    code: REFERENCE_TARGET_MEMBERSHIP_CONFIRMATION_REQUIRED,
    confirmation: { targetTaxId: 700001, pipelineType: 100, taxId: 700001 }
  }
  assert.equal(isReferenceMembershipConfirmation(expected, input), true)
  for (const invalid of [
    null, undefined, {}, { ...expected, status: 0 }, { ...expected, status: '1' },
    { ...expected, data: {} }, { ...expected, data: undefined },
    { ...expected, code: undefined }, { ...expected, code: expected.code.toLowerCase() },
    { ...expected, confirmation: null }, { ...expected, confirmation: [] },
    { ...expected, confirmation: { ...expected.confirmation, targetTaxId: 700002 } },
    { ...expected, confirmation: { ...expected.confirmation, pipelineType: 101 } },
    { ...expected, confirmation: { ...expected.confirmation, taxId: 700002 } },
    { ...expected, confirmation: { ...expected.confirmation, taxId: '700001' } }
  ]) assert.equal(isReferenceMembershipConfirmation(invalid, input), false)
  assert.equal(isReferenceMembershipConfirmation(expected, upload()), false)
  assert.equal(isReferenceMembershipConfirmation(expected, { ...input, targetTaxId: 700002 }), false)
})

test('optional confirmation fields survive upload transport without changing ordinary responses', async t => {
  const expected = {
    status: 1, data: null, failMsg: '请确认', code: REFERENCE_TARGET_MEMBERSHIP_CONFIRMATION_REQUIRED,
    confirmation: { targetTaxId: 700001, pipelineType: 100, taxId: 700001 }
  }
  useAdapter(t, async config => response(config, expected))
  const input = upload({ taxId: 700001, targetTaxId: 700001, pipelineType: 100, confirmAddTaxonomyMember: false })
  const result = await uploadReferenceLibrary(input)
  assert.deepEqual(result, expected)
  assert.equal(isReferenceMembershipConfirmation(result, input), true)
})

test('download uses shared transport and encodes a raw special object key exactly once', async t => {
  const key = 'refseq/custom/A & B%2F#中文/reference.fna'
  const payload = new Blob(['download fixture only'], { type: 'application/octet-stream' })
  useAdapter(t, async config => {
    assert.equal(config.url, '/stageOutput/download')
    assert.equal(config.method, 'get')
    assert.equal(config.responseType, 'blob')
    assert.equal(config.headers.get('Accept'), 'application/octet-stream')
    assert.deepEqual(config.params, { outputUrl: key })
    const url = new URL(backendService.getUri(config))
    assert.equal(url.searchParams.get('outputUrl'), key)
    assert.equal(url.searchParams.size, 1)
    return response(config, payload)
  })
  assert.equal(await downloadReferenceLibraryFile({ ...item, fastaObjectName: key }), payload)
})

test('missing download keys do not request files and safe names always describe stored FASTA', async t => {
  let requests = 0
  useAdapter(t, async config => { requests++; return response(config, {}) })
  for (const key of [null, '', '  ']) {
    await assert.rejects(downloadReferenceLibraryFile({ ...item, fastaObjectName: key }), /文件位置不可用/)
  }
  assert.equal(requests, 0)
  assert.equal(getReferenceDownloadName(item), 'DEMO_001.fasta')
  assert.equal(getReferenceDownloadName({ ...item, accession: 'sample.fna.gz' }), 'sample.fasta')
  assert.equal(getReferenceDownloadName({ ...item, accession: 'sample.zip' }), 'sample.fasta')
  assert.equal(getReferenceDownloadName({ ...item, accession: '' }), 'reference-501.fasta')
  assert.equal(getReferenceDownloadName({ ...item, accession: 'CON' }), '_CON.fasta')
  const safe = getReferenceDownloadName({ ...item, accession: '../unsafe\\name\u0000:a?.fna.gz' })
  assert.equal(safe.includes('\u0000'), false)
  assert.doesNotMatch(safe, /[<>:"/\\|?*]/)
  assert.match(safe, /\.fasta$/)
})

test('JSON, HTML, empty and non-file successful responses cannot be downloaded as FASTA', async t => {
  let payload: unknown
  useAdapter(t, async config => response(config, payload))
  const fileItem = { ...item, fastaObjectName: 'refseq/reference.fna' }
  for (payload of [
    new Blob(['{"status":1,"data":null,"failMsg":"文件不存在"}'], { type: 'application/json' }),
    new Blob(['{"status":1,"failMsg":"文件不存在"}'], { type: 'application/octet-stream' }),
    { status: 1, data: null, failMsg: '文件不存在' }
  ]) {
    await assert.rejects(downloadReferenceLibraryFile(fileItem), error =>
      getReferenceLibraryErrorMessage(error, 'fallback') === '文件不存在'
    )
  }
  for (payload of [
    new Blob(['<!doctype html><html>internal error</html>'], { type: 'text/html' }),
    new Blob(['\ufeff  <html>internal error</html>'], { type: 'application/octet-stream' }),
    new Blob(['<!-- proxy response --><div>internal error</div>'], { type: 'application/octet-stream' }),
    new Blob(['[]'], { type: 'application/octet-stream' }),
    new Blob(), '<html>not a file</html>', null
  ]) {
    await assert.rejects(downloadReferenceLibraryFile(fileItem), error => {
      assert.doesNotMatch(getReferenceLibraryErrorMessage(error, 'fallback'), /internal error|<html>/)
      return true
    })
  }
})

test('HTTP file download errors preserve small JSON failMsg but never surface HTML or auto-retry', async t => {
  const failure = new AxiosError('failed', 'ERR_BAD_RESPONSE')
  let payload: unknown = new Blob(['{"status":1,"failMsg":"参考文件已不可用"}'], { type: 'application/json' })
  let requests = 0
  useAdapter(t, async config => {
    requests++
    failure.response = response(config, payload, 404)
    throw failure
  })
  const fileItem = { ...item, fastaObjectName: 'refseq/reference.fna' }
  await assert.rejects(downloadReferenceLibraryFile(fileItem), /参考文件已不可用/)
  payload = new Blob(['<html>private gateway path</html>'], { type: 'text/html' })
  await assert.rejects(downloadReferenceLibraryFile(fileItem), error => {
    assert.equal(getReferenceLibraryErrorMessage(error, 'fallback'), '参考文件下载失败，请确认文件仍可用')
    return true
  })
  assert.equal(requests, 2)
})

test('file response validation samples only a bounded prefix instead of decoding a large download', async t => {
  const payload = new Blob(['download fixture only'.repeat(10000)], { type: 'application/octet-stream' })
  Object.defineProperty(payload, 'text', {
    value: () => { throw new Error('must not decode complete file') }
  })
  useAdapter(t, async config => response(config, payload))
  assert.equal(await downloadReferenceLibraryFile({ ...item, fastaObjectName: 'refseq/reference.fna' }), payload)
})
