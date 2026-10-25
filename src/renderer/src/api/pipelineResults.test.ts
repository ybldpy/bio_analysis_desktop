import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { AxiosError, isCancel, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { backendService, backendAPI } from './backendService'
import { requestPipeline, requestPipelineStages } from './analysisPipeline'
import {
  confirmTaxonomy,
  downloadStageFile,
  getSavedTaxonomyConfirmation,
  readStageReportJson,
  readStageReportText
} from './pipelineResults'

function useAdapter(t: TestContext, adapter: AxiosAdapter) {
  const previous = backendService.defaults.adapter
  backendService.defaults.adapter = adapter
  t.after(() => {
    backendService.defaults.adapter = previous
  })
}

function response(config: InternalAxiosRequestConfig, data: unknown, status = 200) {
  return { data, status, statusText: status === 200 ? 'OK' : 'Error', headers: {}, config }
}

test('report requests use one opaque encoded key and return content without business unwrapping', async (t) => {
  const fileKey = 'stageOutput/1/报告 & stats%20.json'
  const controller = new AbortController()
  useAdapter(t, async (config) => {
    assert.equal(config.url, backendAPI.stageOutputDownload)
    assert.equal(config.responseType, 'text')
    assert.equal(config.timeout, 30000)
    assert.equal(config.signal, controller.signal)
    assert.equal(config.params.outputUrl, fileKey)
    assert.equal(new URL(backendService.getUri(config)).searchParams.get('outputUrl'), fileKey)
    return response(config, '\uFEFF{"count":0,"data":{"already":"file content"}}')
  })
  assert.deepEqual(await readStageReportJson(fileKey, controller.signal), {
    count: 0,
    data: { already: 'file content' }
  })
})

test('bad or non-object JSON is a local read error; text reports preserve original content', async (t) => {
  let body = ''
  useAdapter(t, async (config) => response(config, body))
  for (body of ['', '<html>error</html>', '{broken']) {
    await assert.rejects(readStageReportJson('report.json'), /JSON 解析失败/)
  }
  for (body of ['null', '[]', '0', '"text"']) {
    await assert.rejects(readStageReportJson('report.json'), /预期为对象/)
  }
  body = 'name\tcount\r\nexample\t0\r\n'
  assert.equal(await readStageReportText('report.tsv'), body)
  await assert.rejects(readStageReportText('  '), /缺少文件对象键/)
})

test('report HTTP errors and cancellation remain rejected, never become empty reports', async (t) => {
  const failure = new AxiosError('HTTP 500', 'ERR_BAD_RESPONSE')
  useAdapter(t, async (config) => {
    failure.response = response(config, 'missing report', 500)
    throw failure
  })
  await assert.rejects(readStageReportJson('missing.json'), (error) => error === failure)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readStageReportText('report.tsv', controller.signal), isCancel)
})

test('stage details preserve good fields beside invalid JSON and forward cancellation signals', async (t) => {
  const controller = new AbortController()
  useAdapter(t, async (config) => {
    assert.equal(config.params.pipelineId, 12)
    assert.equal(config.timeout, 30000)
    assert.equal(config.signal, controller.signal)
    if (config.url === backendAPI.getPipeline) {
      return response(config, {
        status: 0,
        data: {
          pipelineId: 12,
          pipelineType: 100,
          status: 1,
          analysisPipelineName: '任务',
          createTime: '2026-10-21T10:00:00+08:00',
          projectId: 3
        }
      })
    }
    assert.equal(config.url, backendAPI.getPipelineStages)
    return response(config, {
      status: 0,
      data: [
        {
          stageId: 1,
          stageType: 44,
          stageName: '参考选择',
          status: 4,
          startTime: null,
          outputInline: '{"partial":false}',
          outputUrl: '{bad'
        },
        {
          stageId: 2,
          stageType: 20,
          stageName: '比对',
          status: 2,
          outputInline: '',
          outputUrl: '{"metricsUrl":"report.json"}'
        }
      ]
    })
  })
  const pipeline = await requestPipeline(12, controller.signal)
  assert.equal(pipeline.pipelineId, 12)
  const stages = await requestPipelineStages(12, controller.signal)
  assert.equal(stages.length, 2)
  assert.equal(stages[0].startTime, null)
  assert.deepEqual(stages[0].output.inline, { partial: false })
  assert.ok(stages[0].output.parseErrors?.urls)
  assert.equal(stages[1].output.urls?.metricsUrl, 'report.json')
  assert.equal(stages[1].output.inline, null)
})

test('HTTP 200 business failures are not accepted as successful stage details', async (t) => {
  useAdapter(t, async (config) =>
    response(config, { status: 1, data: null, failMsg: '任务不存在' })
  )
  await assert.rejects(requestPipelineStages(12), /任务不存在/)
  await assert.rejects(requestPipeline(12), /任务不存在/)
})

test('confirmation sends only supported fields and returns server state unchanged', async (t) => {
  const data = {
    stageId: 123,
    taxId: 562,
    version: 2,
    downstreamScheduled: true,
    alreadyConfirmed: false
  }
  let calls = 0
  useAdapter(t, async (config) => {
    calls++
    assert.equal(config.method, 'post')
    assert.equal(config.url, backendAPI.confirmTaxonomy)
    assert.deepEqual(JSON.parse(config.data), { stageId: 123, taxId: 562, reason: '已核对' })
    return response(config, { status: 0, data, failMsg: null })
  })
  const result = await confirmTaxonomy({
    stageId: 123,
    taxId: 562,
    reason: '已核对',
    version: 99
  } as any)
  assert.deepEqual(result, { status: 0, data, failMsg: null })
  assert.equal(getSavedTaxonomyConfirmation(result), null)
  await assert.rejects(confirmTaxonomy({ stageId: 0, taxId: 562 }), /正整数/)
  await assert.rejects(confirmTaxonomy({ stageId: 123, taxId: 0 }), /正整数/)
  await assert.rejects(
    confirmTaxonomy({ stageId: 123, taxId: 562, reason: 'a'.repeat(2001) }),
    /2000/
  )
  assert.equal(calls, 1)
})

test('confirmation scheduling failure preserves HTTP error and saved confirmation data', async (t) => {
  const data = {
    stageId: 123,
    taxId: 562,
    version: 2,
    downstreamScheduled: false,
    alreadyConfirmed: true
  }
  let failure: AxiosError | null = null
  const body = { status: 2, data, failMsg: '确认已保存，下游启动失败' }
  useAdapter(t, async (config) => {
    failure = new AxiosError(
      'HTTP 500',
      'ERR_BAD_RESPONSE',
      config,
      undefined,
      response(config, body, 500)
    )
    throw failure
  })
  await assert.rejects(confirmTaxonomy({ stageId: 123, taxId: 562 }), (error) => {
    assert.equal(error, failure)
    assert.deepEqual(getSavedTaxonomyConfirmation(error), data)
    return true
  })
  assert.deepEqual(getSavedTaxonomyConfirmation(body), data)
  assert.equal(getSavedTaxonomyConfirmation(new Error('network disconnected')), null)
  assert.equal(getSavedTaxonomyConfirmation({ data: { downstreamScheduled: false } }), null)
  assert.equal(getSavedTaxonomyConfirmation({ data: { ...data, taxId: 0 } }), null)
})

test('download uses Blob, front-end filename, and releases temporary URL even if click fails', async (t) => {
  useAdapter(t, async (config) => {
    assert.equal(config.responseType, 'blob')
    assert.equal(config.params.outputUrl, 'stageOutput/1/原报告.json')
    return response(config, new Blob(['{}']))
  })
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let clickFailure = false
  let removed = 0
  const anchor = {
    href: '',
    download: '',
    click() {
      if (clickFailure) throw new Error('download click failed')
    },
    remove() {
      removed++
    }
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => anchor, body: { appendChild() {} } }
  })
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  })
  const cleanup: Array<() => void> = []
  t.mock.method(globalThis, 'setTimeout', (callback: () => void) => {
    cleanup.push(callback)
    return 0
  })
  t.mock.method(URL, 'createObjectURL', () => 'blob:report')
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {})
  await downloadStageFile('stageOutput/1/原报告.json', '任务一_报告.json')
  assert.equal(anchor.download, '任务一_报告.json')
  assert.equal(anchor.href, 'blob:report')
  assert.equal(removed, 1)
  assert.equal(revoke.mock.callCount(), 0)
  cleanup.shift()!()
  assert.equal(revoke.mock.callCount(), 1)
  clickFailure = true
  await assert.rejects(downloadStageFile('stageOutput/1/原报告.json', '报告.json'), /click failed/)
  cleanup.shift()!()
  assert.equal(removed, 2)
  assert.equal(revoke.mock.callCount(), 2)
})

test('cancelled downloads pass the signal and never open a save prompt', async (t) => {
  const controller = new AbortController()
  useAdapter(t, async (config) => {
    assert.equal(config.signal, controller.signal)
    controller.abort()
    return response(config, new Blob(['report']))
  })
  // No document exists in this test: an attempt to create a save link would fail it.
  await assert.rejects(downloadStageFile('report.txt', '报告.txt', controller.signal), isCancel)
})

test('an empty NO_MATCH comparison PAF is a valid downloadable file', async (t) => {
  const key = 'test/stage/candidates/0003/alignment.paf'
  const blob = new Blob([], { type: 'application/octet-stream' })
  useAdapter(t, async config => {
    assert.equal(config.params.outputUrl, key)
    assert.equal(config.responseType, 'blob')
    return response(config, blob)
  })
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let clicked = false
  let removed = false
  const anchor = {
    href: '', download: '',
    click() { clicked = true },
    remove() { removed = true }
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => anchor, body: { appendChild() {} } }
  })
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  })
  t.mock.method(URL, 'createObjectURL', (file: Blob) => {
    assert.equal(file.size, 0)
    return 'blob:empty-comparison'
  })
  t.mock.method(URL, 'revokeObjectURL', () => {})
  t.mock.method(globalThis, 'setTimeout', (callback: () => void) => { callback(); return 0 })
  await downloadStageFile(key, 'task_stage1_candidate0003_alignment.paf')
  assert.equal(clicked, true)
  assert.equal(removed, true)
  assert.equal(anchor.download, 'task_stage1_candidate0003_alignment.paf')
})
