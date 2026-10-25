import { backendAPI, backendService } from './backendService'

// Preview limit, not a restriction on the original file's download.
export const MAX_PREVIEW_REPORT_BYTES = 5 * 1024 * 1024

export async function readSmallStageReportText(
  fileKey: string,
  signal?: AbortSignal
): Promise<string> {
  if (typeof fileKey !== 'string' || !fileKey.trim()) throw new Error('缺少报告文件对象键')
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  let oversized = false
  const sizeError = () => new Error('报告超过 5 MiB 在线展示上限，请下载原文件查看')
  try {
    const text = await backendService.get<string, string>(backendAPI.stageOutputDownload, {
      params: { outputUrl: fileKey },
      responseType: 'text',
      timeout: 30000,
      signal: controller.signal,
      // The Node adapter honors this; browser reads are also checked via progress and below.
      maxContentLength: MAX_PREVIEW_REPORT_BYTES,
      onDownloadProgress(event) {
        if (
          event.loaded > MAX_PREVIEW_REPORT_BYTES ||
          (event.total ?? 0) > MAX_PREVIEW_REPORT_BYTES
        ) {
          oversized = true
          controller.abort()
        }
      }
    })
    if (typeof text !== 'string') throw new Error('报告内容不是文本')
    if (
      text.length > MAX_PREVIEW_REPORT_BYTES ||
      new Blob([text]).size > MAX_PREVIEW_REPORT_BYTES
    ) {
      throw sizeError()
    }
    return text
  } catch (error) {
    if (oversized) throw sizeError()
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
