import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { isCancel, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { backendAPI, backendService } from './backendService'
import { MAX_PREVIEW_REPORT_BYTES, readSmallStageReportText } from './stageReportPreview'

function adapter(t: TestContext, next: AxiosAdapter) {
  const old = backendService.defaults.adapter
  backendService.defaults.adapter = next
  t.after(() => {
    backendService.defaults.adapter = old
  })
}
const response = (config: InternalAxiosRequestConfig, data: unknown) => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config
})

test('preview reads one encoded report key, uses timeout and finite content limit', async (t) => {
  const key = 'stageOutput/1/质控 & report.json'
  adapter(t, async (config) => {
    assert.equal(config.url, backendAPI.stageOutputDownload)
    assert.equal(config.params.outputUrl, key)
    assert.equal(new URL(backendService.getUri(config)).searchParams.get('outputUrl'), key)
    assert.equal(config.timeout, 30000)
    assert.equal(config.maxContentLength, MAX_PREVIEW_REPORT_BYTES)
    assert.equal(config.responseType, 'text')
    return response(config, 'name\tvalue\r\nsample\t0\r\n')
  })
  assert.equal(await readSmallStageReportText(key), 'name\tvalue\r\nsample\t0\r\n')
  await assert.rejects(readSmallStageReportText(' '), /缺少报告/)
})

test('preview aborts over-limit progress and explains size instead of reporting empty/cancelled data', async (t) => {
  let useTotal = false
  adapter(t, async (config) => {
    config.onDownloadProgress!({
      loaded: useTotal ? 1 : MAX_PREVIEW_REPORT_BYTES + 1,
      total: useTotal ? MAX_PREVIEW_REPORT_BYTES + 1 : undefined
    } as any)
    assert.equal(config.signal?.aborted, true)
    return response(config, 'partial')
  })
  await assert.rejects(readSmallStageReportText('report.tsv'), /超过 5 MiB/)
  useTotal = true
  await assert.rejects(readSmallStageReportText('report.tsv'), /超过 5 MiB/)
})

test('preview independently checks UTF-8 bytes even without progress or a Content-Length', async (t) => {
  adapter(t, async (config) => response(config, '中'.repeat(2 * 1024 * 1024)))
  await assert.rejects(readSmallStageReportText('report.tsv'), /超过 5 MiB/)
})

test('external cancellation is forwarded and listeners are detached after completion', async (t) => {
  const controller = new AbortController()
  let internal: AbortSignal | undefined
  adapter(t, async (config) => {
    internal = config.signal as AbortSignal
    controller.abort()
    return response(config, 'cancelled')
  })
  await assert.rejects(readSmallStageReportText('report.tsv', controller.signal), isCancel)
  assert.equal(internal?.aborted, true)
  const completed = new AbortController()
  adapter(t, async (config) => {
    internal = config.signal as AbortSignal
    return response(config, 'ok')
  })
  assert.equal(await readSmallStageReportText('report.tsv', completed.signal), 'ok')
  completed.abort()
  assert.equal(internal?.aborted, false)
})

test('preview does not turn transport errors or non-text content into a successful empty report', async (t) => {
  adapter(t, async () => {
    throw new Error('report missing HTTP 500')
  })
  await assert.rejects(readSmallStageReportText('missing.tsv'), /HTTP 500/)
  adapter(t, async (config) => response(config, { error: 'not a report' }))
  await assert.rejects(readSmallStageReportText('report.tsv'), /不是文本/)
})
