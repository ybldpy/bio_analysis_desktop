import { isAxiosError } from 'axios'
import { asRecord } from '../common/pipelineResults'
import { backendAPI, backendService } from './backendService'
import type { RawResponse } from './common'

export interface ConfirmTaxonomyRequest {
  stageId: number
  taxId: number
  reason?: string
}

export interface TaxonomyConfirmationData {
  stageId: number
  taxId: number
  version: number
  downstreamScheduled: boolean
  alreadyConfirmed: boolean
}

function requireFileKey(fileKey: string): void {
  if (typeof fileKey !== 'string' || !fileKey.trim()) throw new Error('缺少文件对象键')
}

export async function readStageReportText(fileKey: string, signal?: AbortSignal): Promise<string> {
  requireFileKey(fileKey)
  const text = await backendService.get<string, string>(backendAPI.stageOutputDownload, {
    params: { outputUrl: fileKey },
    responseType: 'text',
    timeout: 30000,
    signal
  })
  if (typeof text !== 'string') throw new Error('报告内容不是文本')
  return text
}

export async function readStageReportJson(
  fileKey: string,
  signal?: AbortSignal
): Promise<Record<string, any>> {
  const text = await readStageReportText(fileKey, signal)
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('报告 JSON 解析失败，请重试或下载原文件查看')
  }
  const result = asRecord(parsed)
  if (!result) throw new Error('报告 JSON 格式不正确：预期为对象')
  return result
}

export async function downloadStageFile(
  fileKey: string,
  fileName: string,
  signal?: AbortSignal
): Promise<void> {
  requireFileKey(fileKey)
  const blob = await backendService.get<Blob, Blob>(backendAPI.stageOutputDownload, {
    params: { outputUrl: fileKey },
    responseType: 'blob',
    signal,
    timeout: 0
  })
  if (signal?.aborted) throw new DOMException('下载已取消', 'AbortError')
  if (!(blob instanceof Blob)) throw new Error('下载响应不是文件内容')
  const link = document.createElement('a')
  const blobUrl = URL.createObjectURL(blob)
  try {
    link.href = blobUrl
    link.download = fileName || fileKey.split('/').pop() || 'result'
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    // Let the browser accept the download before releasing its temporary URL.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }
}

export async function confirmTaxonomy(
  request: ConfirmTaxonomyRequest
): Promise<RawResponse<TaxonomyConfirmationData | null>> {
  if (
    !Number.isInteger(request.stageId) ||
    request.stageId <= 0 ||
    !Number.isInteger(request.taxId) ||
    request.taxId <= 0
  ) {
    throw new Error('阶段 ID 和 Tax ID 必须是正整数')
  }
  if (request.reason !== undefined && request.reason.length > 2000) {
    throw new Error('确认原因不能超过 2000 个字符')
  }
  // Serialize only fields accepted by this endpoint, never a client-side version or actor.
  const body: ConfirmTaxonomyRequest = { stageId: request.stageId, taxId: request.taxId }
  if (request.reason !== undefined) body.reason = request.reason
  return await backendService.post<
    RawResponse<TaxonomyConfirmationData | null>,
    RawResponse<TaxonomyConfirmationData | null>
  >(backendAPI.confirmTaxonomy, body, { timeout: 30000 })
}

/** Also accepts a business-error response returned with HTTP 200. HTTP errors stay rejected. */
export function getSavedTaxonomyConfirmation(
  responseOrError: unknown
): TaxonomyConfirmationData | null {
  const response = asRecord(
    isAxiosError(responseOrError) ? responseOrError.response?.data : responseOrError
  )
  const data = asRecord(response?.data)
  if (
    !data ||
    !Number.isInteger(data.stageId) ||
    data.stageId <= 0 ||
    !Number.isInteger(data.taxId) ||
    data.taxId <= 0 ||
    typeof data.version !== 'number' ||
    !Number.isFinite(data.version) ||
    data.downstreamScheduled !== false ||
    typeof data.alreadyConfirmed !== 'boolean'
  ) {
    return null
  }
  return data as TaxonomyConfirmationData
}
