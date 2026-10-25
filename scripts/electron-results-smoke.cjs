// Official API: https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler
// All http/https traffic is handled by in-memory Responses; no net.fetch fallback exists.
const { app, BrowserWindow, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const artifacts = path.join(root, 'test-artifacts', 'electron-results')
if (!process.env.BIO_RESULTS_SMOKE_USER_DATA) throw new Error('Use run-electron-results-smoke.cjs')
app.setPath('userData', process.env.BIO_RESULTS_SMOKE_USER_DATA)
app.commandLine.appendSwitch('disable-background-networking')
let window
let ended = false
let assertions = 0
let mappingReads = 0
let confirmations = 0
let saved = false
let downloads = 0
const requests = []
const screenshots = []
const rendererErrors = []
const deadline = setTimeout(() => finish(new Error('55-second smoke deadline exceeded')), 55000)
const pipelineId = 90001
const name = '离线烟测任务'
const mappingKey = 'smoke/mapping metrics & 中文.json'
const stage = (id, type, label, urls = null, inline = null, status = 4) => ({
  stageId: id,
  stageType: type,
  stageName: label,
  status,
  startTime: '2026-10-21T10:00:00+08:00',
  endTime: status === 4 ? '2026-10-21T10:01:00+08:00' : null,
  outputUrl: urls === null ? null : typeof urls === 'string' ? urls : JSON.stringify(urls),
  outputInline: inline === null ? null : JSON.stringify(inline)
})
function stages() {
  return [
    stage(1080, 80, '输入检查烟测', {
      readMeta: { sequencingPlatform: 9999, readLenType: 0, qualityEncoding: 0, sequenceLevel: 0 },
      r1Url: 'smoke/r1.fastq',
      r2Url: null
    }),
    stage(1000, 0, '空结果烟测'),
    stage(1044, 44, '参考选择烟测', null, {
      selectedReference: {
        taxId: 1,
        organismName: 'Smoke reference',
        complete: false,
        sequences: [
          {
            accession: 'SMOKE_B',
            segment: '2',
            segmentKey: 'S2',
            segmentOrdinal: 2,
            genomeLength: 200
          },
          {
            accession: 'SMOKE_A',
            segment: '1',
            segmentKey: 'S1',
            segmentOrdinal: 1,
            genomeLength: 100
          }
        ]
      },
      candidateScores: [
        {
          referenceAccession: 'SMOKE_A',
          segmentKey: 'S1',
          sequenceIdentity: 97.2,
          referenceCoverage: 0.95,
          score: 95
        }
      ],
      partial: false,
      unmatchedSegmentKeys: []
    }),
    stage(1020, 20, '比对指标烟测', { metricsUrl: mappingKey, bamUrl: 'smoke/pending.bam' }),
    stage(1040, 40, '变异指标烟测', { metricsUrl: 'smoke/variants.json' }),
    stage(1041, 41, '遮罩指标烟测', { metricsUrl: 'smoke/mask.json' }),
    stage(1072, 72, '坏JSON烟测', '{broken'),
    stage(
      1010,
      10,
      '分类确认烟测',
      null,
      {
        status: saved ? 0 : 1,
        evidenceResource: saved ? 'USER_CONFIRMED' : 'KRAKEN2',
        best: saved ? { taxid: 562, name: 'Smoke species', rank: 'species', score: 60 } : null,
        candidates: [
          { taxid: 562, name: 'Smoke species', rank: 'species', score: 60 },
          { taxid: 999, name: 'Other candidate', rank: 'species', score: 40 }
        ],
        manualConfirmation: saved
          ? {
              speciesTaxId: 562,
              confirmedAt: 1792548000000,
              confirmedBy: 'offline-smoke',
              reason: '离线确认烟测',
              originalStatus: 1,
              originalEvidenceResource: 'KRAKEN2'
            }
          : null,
        binningMetrics: {
          totalContigs: 10,
          totalAssemblyBases: 1000,
          speciesAssignedContigs: 6,
          speciesAssignedBases: 600,
          unresolvedContigs: 3,
          unresolvedBases: 300,
          unclassifiedContigs: 1,
          unclassifiedBases: 100,
          dominantSpeciesTaxId: 562,
          dominantSpeciesName: 'Original smoke bin',
          dominantSpeciesAssemblyFraction: 0.6,
          bins: [
            {
              taxId: 562,
              name: 'Smoke species',
              rankCode: 'S',
              contigCount: 6,
              totalBases: 600,
              assemblyFraction: 0.6
            },
            {
              taxId: 9,
              name: 'Unresolved bin',
              rankCode: 'G',
              contigCount: 3,
              totalBases: 300,
              assemblyFraction: 0.3
            },
            {
              taxId: 0,
              name: 'Unclassified bin',
              rankCode: 'U',
              contigCount: 1,
              totalBases: 100,
              assemblyFraction: 0.1
            }
          ]
        }
      },
      saved ? 4 : 5
    )
  ]
}
const pipeline = {
  pipelineId,
  pipelineType: 100,
  status: 1,
  analysisPipelineName: name,
  createTime: '2026-10-21T10:00:00+08:00',
  projectId: 1
}
const mapping = {
  mappingFraction: 0.95,
  coverageFractionAt1x: 0.9,
  meanDepth: 12.5,
  maxDepth: 30,
  totalReferenceBases: 1000,
  coveredBases: 900,
  zeroDepthBases: 100,
  totalReadSegments: 100,
  mappedReadSegments: 95,
  unmappedReadSegments: 5,
  references: [
    {
      referenceName: 'SMOKE_A',
      referenceLength: 1000,
      coveredBases: 900,
      zeroDepthBases: 100,
      coverageFractionAt1x: 0.9,
      meanDepth: 12.5,
      maxDepth: 30,
      mappedReadSegments: 95,
      unmappedReadSegments: 5
    }
  ]
}
const variant = {
  variantRecords: 0,
  totalVcfRecords: 2,
  snpCount: 0,
  indelCount: 0,
  otherCount: 0,
  explicitPassCount: 0,
  filteredCount: 0,
  unfilteredCount: 0,
  references: []
}
const mask = {
  minimumDepth: 10,
  totalBases: 1000,
  unmaskedBases: 800,
  maskedBases: 200,
  unmaskedFraction: 0.8,
  maskedFraction: 0.2,
  sequences: [
    {
      sequenceName: 'SMOKE_A',
      totalBases: 1000,
      unmaskedBases: 800,
      maskedBases: 200,
      unmaskedFraction: 0.8,
      maskedFraction: 0.2
    }
  ]
}
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
  if (url.pathname === '/pipeline/getPipelineStates')
    return ok([
      {
        pipelineId,
        pipelineName: name,
        pipelineType: 100,
        projectName: '离线夹具项目',
        pipelineInputs: [],
        pipelineStages: stages(),
        createdAt: '2026-10-21'
      }
    ])
  if (url.pathname === '/pipeline/getPipeline') return ok(pipeline)
  if (url.pathname === '/pipeline/getPipelineStages') return ok(stages())
  if (url.pathname === '/stageOutput/download') {
    const key = url.searchParams.get('outputUrl')
    if (key === mappingKey)
      return ++mappingReads === 1
        ? json({ error: 'offline simulated failure' }, 500)
        : json(mapping)
    if (key === 'smoke/variants.json') return json(variant)
    if (key === 'smoke/mask.json') return json(mask)
    if (key === 'smoke/pending.bam') {
      downloads++
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve(
              new Response('OFFLINE TEST ONLY', {
                headers: { ...headers, 'Content-Type': 'application/octet-stream' }
              })
            ),
          3000
        )
      )
    }
    return json({ error: 'unrequested fixture file' }, 404)
  }
  if (url.pathname === '/pipeline/stage/taxonomy/confirm') {
    const body = await request.json()
    check(body.stageId === 1010 && body.taxId === 562, 'confirmation uses saved candidate IDs')
    check(
      !('version' in body) && !('confirmedBy' in body),
      'confirmation omits client audit fields'
    )
    saved = true
    confirmations++
    const data = {
      stageId: 1010,
      taxId: 562,
      version: 1,
      downstreamScheduled: confirmations > 1,
      alreadyConfirmed: confirmations > 1
    }
    return json(
      {
        status: confirmations === 1 ? 2 : 0,
        data,
        failMsg: confirmations === 1 ? '确认已保存，下游启动失败' : null
      },
      confirmations === 1 ? 500 : 200
    )
  }
  return json({ blocked: true, path: url.pathname }, 451)
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
  ses.on('will-download', (event) => event.preventDefault())
}
function check(value, label) {
  assert.ok(value, label)
  assertions++
  console.log(`PASS ${assertions}: ${label}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const js = (source) => window.webContents.executeJavaScript(source)
const pageText = () => js('document.body.innerText')
async function waitFor(expression, label, timeout = 5000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await js(expression)) return
    await sleep(75)
  }
  throw new Error(`Timed out: ${label}\n${(await pageText()).slice(-2000)}`)
}
async function click(selector, text = '') {
  const result = await js(
    `(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${JSON.stringify(text)} ? e.textContent.trim() === ${JSON.stringify(text)} : true); if (!node || node.disabled) return false; node.click(); return true })()`
  )
  check(result, `click ${selector} ${text}`)
}
async function selectStage(label) {
  await click('.stage-option .stage-name', label)
  await waitFor(
    `document.querySelector('.stage-heading h2')?.textContent === ${JSON.stringify(label)}`,
    label
  )
}
async function capture(label) {
  await sleep(100)
  const target = path.join(artifacts, `${label}.png`)
  fs.writeFileSync(target, (await window.webContents.capturePage()).toPNG())
  screenshots.push(target)
}
async function finish(error) {
  if (ended) return
  ended = true
  clearTimeout(deadline)
  if (error) {
    console.error(error.stack || error)
  }
  const summary = {
    success: !error,
    assertions,
    confirmations,
    downloads,
    requests,
    screenshots,
    rendererErrors,
    error: error?.message
  }
  fs.mkdirSync(artifacts, { recursive: true })
  fs.writeFileSync(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(
    JSON.stringify({
      success: !error,
      assertions,
      confirmations,
      downloads,
      screenshots,
      rendererErrors
    })
  )
  if (window && !window.isDestroyed()) window.destroy()
  app.exit(error ? 1 : 0)
}
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(artifacts, { recursive: true })
    installNetworkFence(session.defaultSession)
    const partition = `offline-result-smoke-${process.pid}`
    const ses = session.fromPartition(partition, { cache: false })
    installNetworkFence(ses)
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
    window.webContents.on('render-process-gone', (_event, details) =>
      finish(new Error(`Renderer gone: ${details.reason}`))
    )
    window.webContents.on('console-message', (_event, details) => {
      if (details?.level === 'error') rendererErrors.push(details.message)
    })
    await window.loadFile(path.join(root, 'out', 'renderer', 'index.html'))
    await waitFor("document.querySelector('.sidebar nav button')", 'application navigation')
    check(!window.isVisible(), 'BrowserWindow remains hidden')
    await click('.sidebar nav button', '任务管理')
    await waitFor(`document.body.innerText.includes(${JSON.stringify(name)})`, 'mock task list')
    await click('button', '详情')
    await waitFor(
      "document.querySelector('.detail-header h1')?.textContent === '离线烟测任务'",
      'task detail'
    )
    check((await pageText()).includes('查看结果'), 'detail has result entry')
    await click('button', '查看结果')
    await waitFor("document.querySelectorAll('.stage-option').length === 8", 'result navigation')
    check((await pageText()).includes('未知平台（9999）'), 'stage 80 unknown platform preserved')
    check(
      !requests.some((item) => item.url.includes('/stageOutput/download')),
      'opening results does not prefetch reports or large files'
    )
    await selectStage('参考选择烟测')
    await waitFor("document.body.innerText.includes('97.20%')", 'reference candidate table')
    check(
      (await pageText()).includes('95.00%'),
      'reference identity and fractional coverage use correct units'
    )
    check((await pageText()).includes('已选中'), 'reference accession selection marker is rendered')
    await capture('reference-selection')
    await selectStage('比对指标烟测')
    await waitFor(
      "[...document.querySelectorAll('button')].some(e => e.textContent.trim() === '重新读取指标')",
      'local metrics error'
    )
    check((await pageText()).includes('结果文件'), 'metrics failure retains downloads')
    await click('button', '重新读取指标')
    await waitFor("document.body.innerText.includes('12.50×')", 'mapping metrics')
    check((await pageText()).includes('95.00%'), 'mapping fraction is displayed')
    await capture('mapping-metrics')
    await js(
      `(() => { const row = [...document.querySelectorAll('.result-files .el-table__row')].find(e => e.textContent.includes('pending.bam')); if (!row) throw new Error('No BAM download row'); row.querySelector('button').click() })()`
    )
    await waitFor(
      "[...document.querySelectorAll('.result-files button')].some(e => e.textContent.trim() === '取消')",
      'download cancellation control'
    )
    check(downloads === 1, 'large file is requested only after explicit download')
    await click('.result-files button', '取消')
    await waitFor(
      "![...document.querySelectorAll('.result-files button')].some(e => e.textContent.trim() === '取消')",
      'download cancellation settled'
    )
    await selectStage('变异指标烟测')
    await waitFor("document.body.innerText.includes('报告中的变异记录总数为 0')", 'zero variants')
    check(!(await pageText()).includes('NaN'), 'zero variants render without NaN')
    await selectStage('遮罩指标烟测')
    await waitFor("document.body.innerText.includes('80.00%')", 'consensus masking')
    check((await pageText()).includes('20.00%'), 'masking retains both fractions')
    await capture('consensus-metrics')
    await selectStage('空结果烟测')
    check(
      (await pageText()).includes('当前阶段暂无可下载文件'),
      'empty result has an explicit empty state'
    )
    await selectStage('坏JSON烟测')
    check(
      (await pageText()).includes('结果解析失败'),
      'bad JSON is an error instead of zero results'
    )
    await selectStage('分类确认烟测')
    await waitFor(
      "document.querySelector('.taxonomy-confirmation .el-select')",
      'taxonomy confirmation'
    )
    check(
      (await pageText()).includes('尚未确定'),
      'ambiguous taxonomy does not select best automatically'
    )
    check((await pageText()).includes('未分类'), 'taxonomy retains unclassified composition')
    await capture('taxonomy-before-confirmation')
    await click('.taxonomy-confirmation .el-select')
    await waitFor(
      "[...document.querySelectorAll('.el-select-dropdown__item')].some(e => e.textContent.includes('TaxID 562'))",
      'saved taxonomy candidate'
    )
    await js(
      "[...document.querySelectorAll('.el-select-dropdown__item')].find(e => e.textContent.includes('TaxID 562')).click()"
    )
    await js(
      "(() => {const input = document.querySelector('.taxonomy-confirmation textarea'); input.value = '离线确认烟测'; input.dispatchEvent(new Event('input', { bubbles:true }))})()"
    )
    await click('.taxonomy-confirmation button', '确认所选候选')
    await waitFor(
      "document.body.innerText.includes('但下游启动失败')",
      'saved confirmation scheduling failure'
    )
    await waitFor(
      "[...document.querySelectorAll('button')].some(e => e.textContent.trim() === '重试原确认的下游调度' && !e.disabled)",
      'recovery enabled after refresh'
    )
    check(confirmations === 1, 'failed scheduling saved exactly one in-memory confirmation')
    await selectStage('输入检查烟测')
    await selectStage('分类确认烟测')
    check(
      (await pageText()).includes('重试原确认的下游调度'),
      'saved recovery survives stage navigation'
    )
    await click('.taxonomy-confirmation button', '重试原确认的下游调度')
    await waitFor(
      "document.body.innerText.includes('完成下游调度；已刷新确认记录')",
      'successful recovery'
    )
    check(confirmations === 2, 'recovery reuses the same confirmation')
    await capture('taxonomy-confirmed')
    await click('.result-header button', '返回任务详情')
    await waitFor(
      "document.querySelector('.detail-header h1')?.textContent === '离线烟测任务'",
      'return same task detail'
    )
    check((await pageText()).includes(name), 'results return to the same task')
    await click('.detail-header .back')
    await waitFor(
      'document.querySelector(\'.toolbar input[placeholder="搜索任务或项目"]\')',
      'return task list'
    )
    check((await pageText()).includes(name), 'detail returns to original task list')
    const blocked = await js(
      "fetch('https://smoke.invalid/blocked').then(r => r.status).catch(() => 0)"
    )
    check(
      blocked === 451 || blocked === 0,
      'external HTTP request is intercepted or rejected without network'
    )
    check(!window.isVisible(), 'window never becomes visible')
    check(
      !requests.some((item) => item.url.includes('r1.fastq')),
      'raw input files were never fetched'
    )
    await finish()
  })
  .catch(finish)
