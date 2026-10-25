// HTTP/HTTPS are answered in memory. There is no network fallback, real upload or server mutation.
const { app, BrowserWindow, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

if (!process.env.BIO_REFERENCE_LIBRARY_SMOKE_USER_DATA) {
  throw new Error('Use run-electron-reference-library-smoke.cjs')
}
app.setPath('userData', process.env.BIO_REFERENCE_LIBRARY_SMOKE_USER_DATA)
app.commandLine.appendSwitch('disable-background-networking')
const root = path.resolve(__dirname, '..')
const artifacts = path.join(root, 'test-artifacts', 'electron-reference-library')
const requests = []
const queries = []
const detailsRead = []
const simulatedUpdates = []
const simulatedUploads = []
const simulatedDownloads = []
let blockedFileSaves = 0
const rendererErrors = []
const screenshots = []
const objectKey = 'offline-smoke/reference library/SMOKE+ENABLED #1.fa'
const marker = 'OFFLINE_SMOKE_TEST_ONLY_NOT_SEQUENCE_DATA\n'
const target = { label: '离线测试专项', taxId: 700001, pipelineType: 100 }
const targetMembers = new Set([123, 456])
let window
let ended = false
let domAssertions = 0
let rendererFailure = null
const deadline = setTimeout(() => finish(new Error('55-second smoke deadline exceeded')), 55000)
const records = [
  {
    referenceId: 902,
    accession: 'SMOKE_ENABLED',
    sourceDb: 'USER_UPLOAD',
    taxId: 123,
    orgType: 0,
    organismName: '离线参考甲（仅元数据）',
    genomeLength: 100,
    segment: null,
    completeness: '离线表单夹具',
    isAnnotated: false,
    enabled: true,
    fastaObjectName: objectKey
  },
  {
    referenceId: 901,
    accession: 'SMOKE_DISABLED',
    sourceDb: null,
    taxId: 456,
    orgType: 0,
    organismName: '离线参考乙（仅元数据）',
    genomeLength: null,
    segment: null,
    completeness: null,
    isAnnotated: false,
    enabled: false,
    fastaObjectName: null
  },
  {
    referenceId: 900,
    accession: 'SMOKE_GLOBAL_ONLY',
    sourceDb: 'USER_UPLOAD',
    taxId: 777,
    orgType: 1,
    organismName: '离线全局核实夹具（不属当前类别或专项）',
    genomeLength: null,
    segment: null,
    completeness: null,
    isAnnotated: false,
    enabled: false,
    fastaObjectName: null
  }
]
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*'
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers })
const ok = (data) => json({ status: 0, data, failMsg: null })
async function handle(request) {
  const url = new URL(request.url)
  requests.push({ url: request.url, method: request.method })
  if (url.origin !== 'http://wsl.test:8080') return json({ blocked: true }, 451)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (url.pathname === '/pipeline/virusTargets' && request.method === 'GET') {
    return ok([target, { label: '不在本期范围的离线选项', taxId: 700002, pipelineType: 102 }])
  }
  if (url.pathname === '/referenceGenome/library/query' && request.method === 'POST') {
    const body = await request.json()
    queries.push(body)
    if (body.targetTaxId != null || body.pipelineType != null) {
      assert.equal(body.targetTaxId, target.taxId)
      assert.equal(body.pipelineType, target.pipelineType)
    }
    const selected = records.filter((item) =>
      (body.targetTaxId == null || targetMembers.has(item.taxId)) &&
      ['taxId', 'orgType', 'enabled', 'accession'].every(
        (key) => body[key] == null || item[key] === body[key]
      )
    )
    const start = body.start ?? 0
    const pageSize = body.pageSize ?? 20
    return ok({ total: selected.length, start, pageSize, items: selected.slice(start, start + pageSize) })
  }
  if (url.pathname === '/referenceGenome/library/upload' && request.method === 'POST') {
    const form = await request.formData()
    const file = form.get('file')
    assert.ok(file && typeof file.text === 'function', 'mock multipart contains one file')
    assert.equal(await file.text(), marker, 'only a non-biological marker may be uploaded in the smoke')
    const fields = Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file'))
    simulatedUploads.push({ ...fields, fileName: file.name, fileBytes: file.size })
    assert.equal(fields.orgType, '0')
    assert.equal(fields.taxId, String(target.taxId))
    assert.equal(fields.targetTaxId, String(target.taxId))
    assert.equal(fields.pipelineType, String(target.pipelineType))
    if (fields.accession === 'SMOKE_GLOBAL_ONLY') {
      // Deliberately uncertain response, with a matching metadata-only record outside
      // the management scope to prove verification does not retain its filters.
      return json({ status: 2, data: null, failMsg: '离线模拟：提交状态待核实' }, 500)
    }
    assert.equal(fields.accession, 'SMOKE_TARGET_UPLOAD')
    if (fields.confirmAddTaxonomyMember !== 'true') {
      assert.ok(fields.confirmAddTaxonomyMember == null || fields.confirmAddTaxonomyMember === 'false')
      return json({
        status: 1,
        data: null,
        failMsg: '离线模拟：需要确认归属',
        code: 'REFERENCE_TARGET_MEMBERSHIP_CONFIRMATION_REQUIRED',
        confirmation: { targetTaxId: target.taxId, pipelineType: target.pipelineType, taxId: target.taxId }
      })
    }
    const created = {
      ...records[0],
      referenceId: 903,
      accession: fields.accession,
      taxId: target.taxId,
      organismName: fields.organismName || null,
      enabled: fields.enabled === 'true',
      fastaObjectName: 'offline-smoke/marker-only-upload.fa'
    }
    records.unshift(created)
    targetMembers.add(target.taxId)
    return ok(created)
  }
  if (url.pathname === '/stageOutput/download' && request.method === 'GET') {
    assert.equal(url.searchParams.get('outputUrl'), objectKey, 'object key is encoded exactly once')
    simulatedDownloads.push({ outputUrl: url.searchParams.get('outputUrl'), bytes: marker.length })
    return new Response(marker, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' }
    })
  }
  const match = /^\/referenceGenome\/library\/(\d+)(\/enabled)?$/.exec(url.pathname)
  const record = match && records.find((item) => item.referenceId === Number(match[1]))
  if (record && !match[2] && request.method === 'GET') {
    detailsRead.push(record.referenceId)
    return ok(record)
  }
  if (record && match[2] && request.method === 'POST') {
    const body = await request.json()
    assert.equal(typeof body.enabled, 'boolean')
    assert.deepEqual(Object.keys(body), ['enabled'])
    simulatedUpdates.push({ referenceId: record.referenceId, enabled: body.enabled })
    record.enabled = body.enabled
    return ok(record)
  }
  // Every unknown endpoint is denied. The above fixtures never forward to any server.
  return json({ status: 4, data: null, failMsg: 'Blocked by offline smoke harness' }, 451)
}
function installNetworkFence(ses) {
  ses.protocol.handle('http', handle)
  ses.protocol.handle('https', handle)
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const scheme = new URL(details.url).protocol
    callback({ cancel: !['file:', 'data:', 'blob:', 'http:', 'https:'].includes(scheme) })
  })
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => {
    blockedFileSaves++
    event.preventDefault()
  })
}
function check(value, label) {
  assert.ok(value, label)
  domAssertions++
  console.log(`PASS ${domAssertions}: ${label}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const js = (source) => window.webContents.executeJavaScript(source)
async function waitFor(expression, label, timeout = 5000) {
  return waitUntil(() => js(expression), label, timeout)
}
async function waitUntil(predicate, label, timeout = 5000) {
  const end = Date.now() + timeout
  while (!ended && Date.now() < end) {
    if (await predicate()) return
    await sleep(75)
  }
  throw new Error(`Timed out: ${label}`)
}
async function click(selector, text = '') {
  check(await js(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(e => ${JSON.stringify(text)} ? e.textContent.trim() === ${JSON.stringify(text)} : true)
    if (!node || node.disabled) return false
    node.click()
    return true
  })()`), `click ${selector} ${text}`)
}
async function fill(selector, value) {
  check(await js(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input || input.disabled) return false
    input.value = ${JSON.stringify(value)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`), `fill ${selector}`)
}
async function selectMarkerFile() {
  check(await js(`(() => {
    const input = document.querySelector('[data-testid="upload-file"]')
    if (!input || input.disabled) return false
    const files = new DataTransfer()
    files.items.add(new File([${JSON.stringify(marker)}], 'offline-marker.fa', { type: 'text/plain' }))
    input.files = files.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`), 'select a synthetic non-biological marker file without accessing user files')
}
async function capture(label) {
  await sleep(100)
  const file = path.join(artifacts, `${label}.png`)
  fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG())
  screenshots.push(file)
}
function finish(error) {
  if (ended) return
  ended = true
  clearTimeout(deadline)
  if (error) console.error(error.stack || error)
  const summary = {
    success: !error,
    domAssertions,
    rendererFailure,
    error: error?.message,
    requests,
    queries,
    detailsRead,
    simulatedUpdates,
    simulatedUploads,
    simulatedDownloads,
    blockedFileSaves,
    screenshots,
    rendererErrors,
    realNetworkRequests: 0,
    uploadRequests: requests.filter((request) => new URL(request.url).pathname.endsWith('/upload')).length
  }
  fs.mkdirSync(artifacts, { recursive: true })
  fs.writeFileSync(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
  if (window && !window.isDestroyed()) window.destroy()
  app.exit(error ? 1 : 0)
}
app.whenReady().then(async () => {
  fs.mkdirSync(artifacts, { recursive: true })
  installNetworkFence(session.defaultSession)
  const partition = `offline-reference-library-smoke-${process.pid}`
  installNetworkFence(session.fromPartition(partition, { cache: false }))
  window = new BrowserWindow({
    width: 1450,
    height: 1050,
    show: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererFailure = details
    finish(new Error(`Renderer gone: ${details.reason} (exitCode ${details.exitCode})`))
  })
  window.webContents.on('console-message', (_event, details) => {
    if (details?.level === 'error') rendererErrors.push(details.message)
  })
  await window.loadFile(path.join(root, 'out', 'renderer', 'index.html'))
  await waitFor("document.querySelector('.sidebar nav button')", 'application root navigation')
  await click('.sidebar nav button', '参考序列库')
  await waitFor("document.querySelectorAll('.reference-library-page .el-table__row').length === 2", 'reference list')
  check(queries.length === 1 && queries[0].start === 0 && queries[0].pageSize === 20,
    'initial query uses row offset 0 and page size 20')
  check(queries[0].orgType === 0 && !['enabled', 'taxId', 'accession', 'targetTaxId', 'pipelineType'].some((key) => key in queries[0]),
    'default management query explicitly uses virus code 0 and includes enabled and disabled records')
  check(await js("!document.querySelector('.filters').innerText.includes('全部类别') && document.querySelector('.filters').innerText.includes('全部状态')"),
    'management has no category selector and includes all enabled states by default')
  await capture('reference-list')

  await click('.reference-library-page .el-table__row button', '详情')
  await waitFor(`document.querySelector('.detail-body')?.innerText.includes(${JSON.stringify(objectKey)})`, 'fresh record detail')
  check(detailsRead.length === 1 && detailsRead[0] === 902, 'detail is fetched by referenceId')
  check(await js(`(() => {
    const body = document.querySelector('.detail-body')
    return !body.querySelector('a[href], input[type="file"]') &&
      [...body.querySelectorAll('button')].some(e => e.textContent.trim() === '下载 FASTA' && !e.disabled)
  })()`), 'detail keeps the object key as text and exposes an API-backed download button')
  await click('.detail-body button', '下载 FASTA')
  await waitFor("![...document.querySelectorAll('.detail-body button')].some(e => e.textContent.trim() === '下载 FASTA' && e.classList.contains('is-loading'))", 'mock download response')
  await waitUntil(() => simulatedDownloads.length === 1 && blockedFileSaves === 1, 'download fixture and blocked disk save')
  check(simulatedDownloads.length === 1 && simulatedDownloads[0].outputUrl === objectKey,
    'download uses the endpoint and preserves the special object key after one encoding')
  check(blockedFileSaves === 1, 'download save is blocked by the offline harness, no user file is written')
  await capture('reference-detail')
  await click('.el-drawer__close-btn')
  await waitFor("!document.querySelector('.detail-body') || document.querySelector('.detail-body').getClientRects().length === 0", 'detail closed')

  await click('.reference-library-page .el-table__row .el-switch')
  await waitFor("document.querySelector('.reference-library-page .el-table__row .el-switch')?.getAttribute('aria-checked') === 'false' && !document.querySelector('.reference-library-page .el-table__row .el-switch')?.classList.contains('is-loading')", 'toggle response and refreshed state')
  check(simulatedUpdates.length === 1 && simulatedUpdates[0].referenceId === 902 && simulatedUpdates[0].enabled === false,
    'one row toggle sends one simulated boolean POST only')
  check(queries.length >= 2 && records[1].enabled === false, 'toggle refreshes list without modifying another row')

  await fill('.filters input[placeholder="完整标识（精确匹配）"]', 'SMOKE_DISABLED')
  await click('.filter-actions button', '查询')
  await waitFor("document.querySelectorAll('.reference-library-page .el-table__row').length === 1 && document.querySelector('.reference-library-page .el-table__row').innerText.includes('SMOKE_DISABLED')", 'exact accession search')
  check(queries.at(-1).accession === 'SMOKE_DISABLED' && !('enabled' in queries.at(-1)),
    'accession search is exact and includes disabled records')
  await click('.filter-actions button', '重置')
  await waitFor("document.querySelectorAll('.reference-library-page .el-table__row').length === 2", 'filter reset')

  await click('.reference-library-page button', '全局上传病毒参考')
  await waitFor("document.querySelector('[data-testid=upload-file]')", 'upload dialog')
  check(await js(`(() => {
    const file = document.querySelector('[data-testid="upload-file"]')
    return file.type === 'file' && !file.multiple && file.files.length === 0 &&
      file.accept === '.fasta,.fa,.fna,.gz,.gzip,.zip'
  })()`), 'upload permits one supported file and starts with no file selected')
  check(await js(`['tax-id', 'accession', 'organism-name', 'segment', 'completeness']
    .every(id => document.querySelector('[data-testid="' + id + '"]'))`),
    'global upload shows actual taxId and optional metadata fields')
  check(await js("!document.querySelector('[data-testid=org-type]')"), 'category input is absent; virus code is supplied by the frontend')
  check(await js("document.querySelector('[data-testid=enabled] input[type=checkbox]')?.checked === true"),
    'upload enabled default is true')
  check(await js("document.querySelector('[data-testid=selected-file]')?.textContent.trim() === '未选择文件'"),
    'opening the upload dialog never picks or generates file contents')
  await capture('reference-upload-global-form')
  await click('[data-testid=close-upload]')
  await waitFor("!document.querySelector('[data-testid=upload-file]') || document.querySelector('[data-testid=upload-file]').closest('.el-dialog').getClientRects().length === 0", 'global upload closed')

  await click('.target-selection .el-select')
  await waitFor(`Array.from(document.querySelectorAll('.el-select-dropdown__item')).some(e => e.textContent.includes(${JSON.stringify(target.label)}))`, 'target options')
  check(await js("!Array.from(document.querySelectorAll('.el-select-dropdown__item')).some(e => e.textContent.includes('不在本期范围'))"),
    'unsupported pipeline 102 is not a selectable management target')
  await click('.el-select-dropdown__item', `${target.label} · Tax ID ${target.taxId} · ${target.pipelineType}`)
  await waitFor("document.querySelector('.list-heading').innerText.includes('离线测试专项') && document.querySelectorAll('.reference-library-page .el-table__row').length === 2", 'target-scoped list')
  check(queries.at(-1).targetTaxId === target.taxId && queries.at(-1).pipelineType === 100 && queries.at(-1).orgType === 0,
    'target selection queries the server with paired context and virus code 0')

  await click('.reference-library-page button', '向当前专项上传')
  await waitFor("document.querySelector('[data-testid=upload-scope]')?.innerText.includes('上传到专项：离线测试专项')", 'target upload scope')
  check(await js("!document.querySelector('[data-testid=tax-id]') && !document.querySelector('[data-testid=org-type]')"),
    'target upload requires neither taxId nor category input')
  await selectMarkerFile()
  await fill('[data-testid=accession] input', 'SMOKE_TARGET_UPLOAD')
  await fill('[data-testid=organism-name] input', '离线上传元数据夹具')
  await click('[data-testid=enabled] input[type=checkbox]')
  await click('[data-testid=submit-upload]')
  await waitFor("document.querySelector('[data-testid=membership-confirmation]')", 'membership confirmation response')
  check(simulatedUploads.length === 1 && simulatedUploads[0].confirmAddTaxonomyMember !== 'true',
    'first upload auto-fills both taxIds but never grants implicit membership approval')
  await capture('reference-membership-confirmation')
  await click('[data-testid=cancel-membership]')
  await waitFor("!document.querySelector('[data-testid=membership-confirmation]') && !document.querySelector('[data-testid=submit-upload]').disabled", 'membership cancelled')
  check(simulatedUploads.length === 1 && !records.some(item => item.referenceId === 903),
    'cancelling confirmation sends no upload and creates no mock record')
  check(await js("document.querySelector('[data-testid=selected-file]').textContent.includes('offline-marker.fa') && document.querySelector('[data-testid=accession] input').value === 'SMOKE_TARGET_UPLOAD'"),
    'cancelling membership preserves the file and form')
  await click('[data-testid=submit-upload]')
  await waitFor("document.querySelector('[data-testid=membership-confirmation]')", 'fresh membership confirmation')
  await click('[data-testid=confirm-membership]')
  await waitFor("document.querySelector('.detail-body')?.innerText.includes('SMOKE_TARGET_UPLOAD')", 'created record detail')
  check(simulatedUploads.length === 3 && simulatedUploads[1].confirmAddTaxonomyMember !== 'true' && simulatedUploads[2].confirmAddTaxonomyMember === 'true',
    'only explicit approval adds confirmAddTaxonomyMember=true')
  check(JSON.stringify({ ...simulatedUploads[1], confirmAddTaxonomyMember: 'true' }) === JSON.stringify(simulatedUploads[2]),
    'approval preserves the original file metadata and all submitted fields')
  check(records[0].referenceId === 903 && records[0].orgType === 0 && records[0].taxId === target.taxId && !records[0].enabled,
    'mock success represents a newly created disabled virus reference in the selected target')
  await capture('reference-upload-success')
  await click('.el-drawer__close-btn')
  await waitFor("!document.querySelector('.detail-body') || document.querySelector('.detail-body').getClientRects().length === 0", 'created detail closed')

  await click('.reference-library-page button', '向当前专项上传')
  await waitFor("document.querySelector('[data-testid=upload-file]') && document.querySelector('[data-testid=upload-file]').closest('.el-dialog').getClientRects().length > 0", 'next upload opened')
  await selectMarkerFile()
  await fill('[data-testid=accession] input', 'SMOKE_GLOBAL_ONLY')
  await click('[data-testid=submit-upload]')
  await waitFor("document.querySelector('.uncertain-warning')", 'uncertain upload result')
  check(simulatedUploads.length === 4, 'an uncertain upload is not retried automatically')
  await click('[data-testid=lookup]')
  await waitFor("document.querySelector('.list-heading').innerText.includes('全局上传结果核实') && document.querySelector('.reference-library-page .el-table__row')?.innerText.includes('SMOKE_GLOBAL_ONLY')", 'global lookup of uncertain result')
  check(queries.at(-1).accession === 'SMOKE_GLOBAL_ONLY' &&
    !['targetTaxId', 'pipelineType', 'orgType', 'taxId', 'enabled'].some(key => key in queries.at(-1)),
    'verification omits target, category, actual taxId and enabled filters')
  check(await js("document.querySelector('.reference-library-page .el-table__row').innerText.includes('细菌')"),
    'global verification can find an out-of-scope category instead of falsely reporting missing upload')
  await capture('reference-global-verification')
  await click('.reference-library-page button', '继续核实上传结果')
  await waitFor("document.querySelector('[data-testid=end-upload]') && !document.querySelector('[data-testid=end-upload]').disabled", 'verified upload can be ended')
  await click('[data-testid=end-upload]')
  await waitFor("Array.from(document.querySelectorAll('.el-popconfirm button')).some(e => e.textContent.trim() === '确认结束')", 'end upload confirmation')
  await click('.el-popconfirm button', '确认结束')
  await waitFor("!document.querySelector('.reference-library-page').innerText.includes('上次上传结果仍待核实')", 'uncertain navigation lock released')
  check(simulatedUploads.length === 4, 'lookup and ending the local upload do not retransmit')
  check(simulatedUpdates.length === 1 && simulatedDownloads.length === 1,
    'only the explicitly tested in-memory toggle and download were performed')
  check(requests.filter(request => new URL(request.url).pathname.endsWith('/upload')).length === simulatedUploads.length,
    'every upload request was answered by the non-biological in-memory fixture')
  check(!window.isVisible(), 'smoke BrowserWindow remains hidden')
  finish()
}).catch(finish)
