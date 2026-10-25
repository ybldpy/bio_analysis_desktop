import { isAxiosError } from 'axios'
import { backendAPI, backendService } from './backendService'

export interface ReferenceLibraryTarget {
  taxId: number
  pipelineType: 100 | 101
  label: string
}

export interface ReferenceMembershipConfirmation {
  targetTaxId: number
  pipelineType: 100 | 101
  taxId: number
}

export interface ReferenceLibraryItem {
  referenceId: number
  accession: string
  sourceDb: string | null
  taxId: number
  orgType: 0 | 1
  organismName: string | null
  genomeLength: number | null
  segment: string | null
  completeness: string | null
  isAnnotated: boolean
  enabled: boolean
  fastaObjectName: string | null
}

export interface ReferenceLibraryPage {
  total: number
  start: number
  pageSize: number
  items: ReferenceLibraryItem[]
}

export interface ReferenceLibraryQuery {
  start?: number
  pageSize?: number
  taxId?: number | null
  orgType?: 0 | 1 | null
  enabled?: boolean | null
  accession?: string | null
  targetTaxId?: number | null
  pipelineType?: 100 | 101 | null
}

export interface ReferenceLibraryResponse<T> {
  status: number
  data: T | null
  failMsg: string | null
  code?: string
  confirmation?: ReferenceMembershipConfirmation
}

export interface ReferenceLibraryUpload {
  file: File | null
  taxId: number | null
  orgType: 0 | 1 | null
  accession?: string
  organismName: string
  segment?: string
  completeness?: string
  enabled: boolean
  targetTaxId?: number | null
  pipelineType?: 100 | 101 | null
  confirmAddTaxonomyMember?: boolean
}

export const REFERENCE_UPLOAD_MAX_BYTES = 268435456
export const REFERENCE_TARGET_MEMBERSHIP_CONFIRMATION_REQUIRED =
  'REFERENCE_TARGET_MEMBERSHIP_CONFIRMATION_REQUIRED'
const libraryPath = '/referenceGenome/library'
const readTimeout = 30000
const optionalUploadFields = [
  ['accession', '参考标识 accession', 64],
  ['segment', '节段', 64],
  ['completeness', '完整性说明', 32]
] as const

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function requireReferenceId(referenceId: number): void {
  if (!isPositiveId(referenceId)) throw new Error('参考记录 ID 必须是正整数')
}

function containsControlCharacters(text: string): boolean {
  return Array.from(text).some(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || (code >= 127 && code <= 159)
  })
}

function validateTargetContext(input: Pick<ReferenceLibraryQuery, 'targetTaxId' | 'pipelineType'>): string {
  const hasTarget = input.targetTaxId != null
  const hasType = input.pipelineType != null
  if (!hasTarget && !hasType) return ''
  if (!hasTarget || !hasType) return '专项 Tax ID 和流水线类型必须成对提供'
  if (!isPositiveId(input.targetTaxId)) return '专项 Tax ID 必须是正整数'
  if (input.pipelineType !== 100 && input.pipelineType !== 101) return '参考库仅支持普通病毒和新冠专项'
  if (input.pipelineType === 101 && input.targetTaxId !== 2697049) {
    return '新冠专项的 Tax ID 必须为 2697049'
  }
  // Registration and member resolution belong to the backend, not a client-side dictionary.
  return ''
}

/** A prompt authorizes one exact submitted context, never a message-text guess. */
export function isReferenceMembershipConfirmation(
  response: unknown,
  input: Pick<ReferenceLibraryUpload, 'targetTaxId' | 'pipelineType' | 'taxId'>
): boolean {
  if (input.targetTaxId == null || validateTargetContext(input) || !isPositiveId(input.taxId)) return false
  const body = responseBody(response)
  if (body?.status !== 1 || body.data !== null ||
    body.code !== REFERENCE_TARGET_MEMBERSHIP_CONFIRMATION_REQUIRED) return false
  const confirmation = responseBody(body.confirmation)
  return confirmation?.targetTaxId === input.targetTaxId &&
    confirmation?.pipelineType === input.pipelineType && confirmation?.taxId === input.taxId
}

/** Checks file metadata and declared form fields only; never reads or parses sequence contents. */
export function validateReferenceUpload(input: ReferenceLibraryUpload): string {
  if (!(input.file instanceof File)) return '请选择一个参考序列文件'
  if (input.file.size === 0) return '参考序列文件不能为空'
  if (!/\.(?:fasta|fa|fna|gz|gzip|zip)$/i.test(input.file.name)) {
    return '请选择 .fasta、.fa、.fna、.gz、.gzip 或 .zip 文件'
  }
  if (input.file.size > REFERENCE_UPLOAD_MAX_BYTES) {
    return '文件超过默认 256 MiB 上传上限；解压后大小仍由服务端校验'
  }
  if (!isPositiveId(input.taxId)) return 'Tax ID 必须是正整数'
  if (input.orgType !== 0 && input.orgType !== 1) return '类别必须是病毒（0）或细菌（1）'
  if (typeof input.enabled !== 'boolean') return '请明确选择导入后是否启用'
  const targetError = validateTargetContext(input)
  if (targetError) return targetError
  if (input.targetTaxId != null) {
    if (input.orgType !== 0) return '专项上传仅支持病毒类别（0）'
    if (input.taxId !== input.targetTaxId) return '专项上传的 Tax ID 必须与所选专项一致'
  }
  if (input.confirmAddTaxonomyMember !== undefined && typeof input.confirmAddTaxonomyMember !== 'boolean') {
    return '专项归属确认必须为布尔值'
  }
  if (input.confirmAddTaxonomyMember === true && input.targetTaxId == null) {
    return '没有专项上下文时不能确认添加分类归属'
  }

  if (typeof input.organismName !== 'string' || !input.organismName.trim()) {
    return '请填写分类名称'
  }
  const organismName = input.organismName.trim()
  if (organismName.length > 255) return '分类名称不能超过 255 个字符'
  if (containsControlCharacters(organismName)) return '分类名称不能包含控制字符'

  for (const [key, label, maximum] of optionalUploadFields) {
    const raw = input[key]
    if (raw == null) continue
    if (typeof raw !== 'string') return `${label}必须是文本`
    const value = raw.trim()
    if (!value) continue
    if (value.length > maximum) return `${label}不能超过 ${maximum} 个字符`
    if (containsControlCharacters(value)) return `${label}不能包含控制字符`
    if (key === 'accession' && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
      return 'accession 必须以字母或数字开头，且仅包含字母、数字、点、下划线、冒号或连字符'
    }
  }
  return ''
}

export function buildReferenceUploadFormData(input: ReferenceLibraryUpload): FormData {
  const error = validateReferenceUpload(input)
  if (error) throw new Error(error)
  const form = new FormData()
  form.append('file', input.file!)
  form.append('taxId', String(input.taxId))
  form.append('orgType', String(input.orgType))
  form.append('enabled', String(input.enabled))
  form.append('organismName', input.organismName.trim())
  if (input.targetTaxId != null) {
    form.append('targetTaxId', String(input.targetTaxId))
    form.append('pipelineType', String(input.pipelineType))
  }
  if (input.confirmAddTaxonomyMember !== undefined) {
    form.append('confirmAddTaxonomyMember', String(input.confirmAddTaxonomyMember))
  }
  for (const [key] of optionalUploadFields) {
    const value = input[key]?.trim()
    if (value) form.append(key, value)
  }
  return form
}

export async function queryReferenceLibrary(
  query: ReferenceLibraryQuery = {},
  signal?: AbortSignal
): Promise<ReferenceLibraryResponse<ReferenceLibraryPage>> {
  const start = query.start ?? 0
  const pageSize = query.pageSize ?? 20
  if (!Number.isSafeInteger(start) || start < 0) throw new Error('列表起始偏移量必须是非负整数')
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('每页数量必须是 1–100 的整数')
  }
  if (query.taxId != null && !isPositiveId(query.taxId)) throw new Error('Tax ID 必须是正整数')
  if (query.orgType != null && query.orgType !== 0 && query.orgType !== 1) {
    throw new Error('类别必须是病毒或细菌')
  }
  const targetError = validateTargetContext(query)
  if (targetError) throw new Error(targetError)
  if (query.enabled != null && typeof query.enabled !== 'boolean') {
    throw new Error('启用筛选必须为布尔值或全部')
  }
  const accession = query.accession?.trim()
  if (accession && (accession.length > 64 || containsControlCharacters(accession))) {
    throw new Error('accession 最长 64 个字符，且不能包含控制字符')
  }
  const body: ReferenceLibraryQuery = { start, pageSize }
  if (query.taxId != null) body.taxId = query.taxId
  if (query.orgType != null) body.orgType = query.orgType
  if (query.enabled != null) body.enabled = query.enabled
  if (accession) body.accession = accession
  if (query.targetTaxId != null) {
    body.targetTaxId = query.targetTaxId
    body.pipelineType = query.pipelineType
  }
  return await backendService.post<
    ReferenceLibraryResponse<ReferenceLibraryPage>,
    ReferenceLibraryResponse<ReferenceLibraryPage>
  >(`${libraryPath}/query`, body, { signal, timeout: readTimeout })
}

export async function getReferenceLibraryItem(
  referenceId: number,
  signal?: AbortSignal
): Promise<ReferenceLibraryResponse<ReferenceLibraryItem>> {
  requireReferenceId(referenceId)
  return await backendService.get<
    ReferenceLibraryResponse<ReferenceLibraryItem>,
    ReferenceLibraryResponse<ReferenceLibraryItem>
  >(`${libraryPath}/${referenceId}`, { signal, timeout: readTimeout })
}

export async function setReferenceLibraryEnabled(
  referenceId: number,
  enabled: boolean
): Promise<ReferenceLibraryResponse<ReferenceLibraryItem>> {
  requireReferenceId(referenceId)
  if (typeof enabled !== 'boolean') throw new Error('启用状态必须明确传入 true 或 false')
  return await backendService.post<
    ReferenceLibraryResponse<ReferenceLibraryItem>,
    ReferenceLibraryResponse<ReferenceLibraryItem>
  >(`${libraryPath}/${referenceId}/enabled`, { enabled }, { timeout: readTimeout })
}

export async function uploadReferenceLibrary(
  input: ReferenceLibraryUpload,
  options: { signal?: AbortSignal; onUploadProgress?: (percent: number | null) => void } = {}
): Promise<ReferenceLibraryResponse<ReferenceLibraryItem>> {
  const form = buildReferenceUploadFormData(input)
  return await backendService.post<
    ReferenceLibraryResponse<ReferenceLibraryItem>,
    ReferenceLibraryResponse<ReferenceLibraryItem>
  >(`${libraryPath}/upload`, form, {
    signal: options.signal,
    timeout: 0,
    // Let the browser generate the multipart Content-Type and boundary.
    onUploadProgress: options.onUploadProgress ? event => {
      const { loaded, total } = event
      const percent = typeof total === 'number' && Number.isFinite(total) && total > 0 &&
        Number.isFinite(loaded) && loaded >= 0
        ? Math.min(100, Math.floor(loaded / total * 100))
        : null
      options.onUploadProgress!(percent)
    } : undefined
  })
}

/** Download names describe the stored FASTA, not the uploaded archive wrapper. */
export function getReferenceDownloadName(item: ReferenceLibraryItem): string {
  const fallback = `reference-${item.referenceId}`
  let name = (item.accession?.trim() || fallback)
    .replace(/\.(?:gz|gzip|zip)$/i, '')
    .replace(/\.(?:fasta|fa|fna)$/i, '')
  name = Array.from(name, character =>
    containsControlCharacters(character) || '<>:"/\\|?*'.includes(character) ? '_' : character
  ).join('').replace(/^[. ]+|[. ]+$/g, '').slice(0, 180)
  if (!name) name = fallback
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`
  return `${name}.fasta`
}

function downloadFailure(message: string, cause?: unknown): Error {
  // The common UI error helper reads failMsg; keep diagnostics in the Error cause.
  return Object.assign(new Error(message, { cause }), { failMsg: message })
}

async function readDownloadError(value: unknown): Promise<unknown> {
  if (!(value instanceof Blob)) return value
  // Error envelopes are small; never decode an entire large file for error reporting.
  if (value.size > 65536) return null
  try {
    return JSON.parse(await value.text())
  } catch {
    return null
  }
}

export async function downloadReferenceLibraryFile(item: ReferenceLibraryItem): Promise<Blob> {
  if (!item.fastaObjectName?.trim()) throw downloadFailure('文件位置不可用，无法下载')
  let blob: Blob
  try {
    blob = await backendService.get<Blob, Blob>(backendAPI.stageOutputDownload, {
      // Axios encodes the raw key once. Do not pre-encode it or use it as a URL.
      params: { outputUrl: item.fastaObjectName },
      responseType: 'blob',
      headers: { Accept: 'application/octet-stream' },
      timeout: readTimeout
    })
  } catch (error) {
    const body = await readDownloadError(isAxiosError(error) ? error.response?.data : error)
    throw downloadFailure(getReferenceLibraryErrorMessage(body, '参考文件下载失败，请确认文件仍可用'), error)
  }
  if (!(blob instanceof Blob)) {
    throw downloadFailure(getReferenceLibraryErrorMessage(blob, '下载接口未返回文件内容'))
  }
  if (blob.size === 0) throw downloadFailure('下载接口返回了空文件')
  const prefix = (await blob.slice(0, 4096).text()).trimStart()
  const errorType = /(?:json|html|xml)/i.test(blob.type)
  const errorPrefix = /^[\[{<]/.test(prefix)
  if (errorType || errorPrefix) {
    const body = await readDownloadError(blob)
    throw downloadFailure(getReferenceLibraryErrorMessage(body, '下载接口返回错误信息而非 FASTA 文件'))
  }
  return blob
}

function responseBody(value: unknown): Record<string, unknown> | null {
  const body: unknown = isAxiosError(value) ? value.response?.data : value
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null
}

/** Preserve server business messages, but never surface a raw HTML/text gateway response. */
export function getReferenceLibraryErrorMessage(responseOrError: unknown, fallback: string): string {
  const message = responseBody(responseOrError)?.failMsg
  if (typeof message === 'string' && message.trim()) return message.trim()
  if (isAxiosError(responseOrError) && responseOrError.response?.status === 413) {
    return '上传被服务器或网关拒绝：请求超过大小限制'
  }
  return fallback
}

export function getReferenceLibraryFailureStatus(responseOrError: unknown): number | null {
  const status = responseBody(responseOrError)?.status
  return typeof status === 'number' && Number.isSafeInteger(status) && status >= 0 ? status : null
}
