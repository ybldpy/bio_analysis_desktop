import type { AnalysisPipeline, AnalysisPipelineStage } from '../../common/analysisPipeline'
import { asRecord } from '../../common/pipelineResults'
import {
  getSavedTaxonomyConfirmation,
  type ConfirmTaxonomyRequest,
  type TaxonomyConfirmationData
} from '../../api/pipelineResults'

export interface TaxonomyConfirmationState {
  pipelineId: number | null
  stageId: number | null
  selectedTaxId: number | null
  reason: string
  submitting: boolean
  needsRefresh: boolean
  /** A successful refresh must follow the response, not merely the request's start. */
  refreshAfterVersion: number | null
  phase: 'idle' | 'uncertain' | 'saved' | 'scheduled'
  confirmedTaxId: number | null
  submittedRequest: ConfirmTaxonomyRequest | null
  recoveryRequest: ConfirmTaxonomyRequest | null
  conflict: boolean
  notice: string
  noticeType: 'info' | 'success' | 'warning' | 'error'
  requestSequence: number
}

export interface TaxonomyConfirmationContext {
  stage: AnalysisPipelineStage
  pipeline: AnalysisPipeline
  refreshVersion: number
  refreshing: boolean
}

export function createTaxonomyConfirmationState(): TaxonomyConfirmationState {
  return {
    pipelineId: null,
    stageId: null,
    selectedTaxId: null,
    reason: '',
    submitting: false,
    needsRefresh: false,
    refreshAfterVersion: null,
    phase: 'idle',
    confirmedTaxId: null,
    submittedRequest: null,
    recoveryRequest: null,
    conflict: false,
    notice: '',
    noticeType: 'info',
    requestSequence: 0
  }
}

function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function sameContext(
  state: TaxonomyConfirmationState,
  context: TaxonomyConfirmationContext
): boolean {
  return state.pipelineId === context.pipeline.pipelineId && state.stageId === context.stage.stageId
}

function resultOf(stage: AnalysisPipelineStage): Record<string, any> | null {
  return stage.output.parseErrors?.inline ? null : asRecord(stage.output.inline)
}

export function getTaxonomyConfirmationCandidates(stage: AnalysisPipelineStage): {
  taxid: number
  name: string
}[] {
  const candidates = resultOf(stage)?.candidates
  if (!Array.isArray(candidates)) return []
  const seen = new Set<number>()
  return candidates.flatMap((value) => {
    const candidate = asRecord(value)
    if (!candidate || !positiveId(candidate.taxid) || seen.has(candidate.taxid)) return []
    seen.add(candidate.taxid)
    return [
      {
        taxid: candidate.taxid,
        name:
          typeof candidate.name === 'string' && candidate.name.trim()
            ? candidate.name
            : '未提供名称'
      }
    ]
  })
}

function initialBlockedReason(context: TaxonomyConfirmationContext): string {
  const { stage, pipeline } = context
  const result = resultOf(stage)
  if (stage.stageType !== 10 || !positiveId(stage.stageId) || !positiveId(pipeline.pipelineId)) {
    return '此阶段不支持物种确认。'
  }
  if (!result) return '分类结果尚未成功读取，暂不可确认。'
  if (result.status === 3 || stage.status === 6) return '超出分类范围或不适用的阶段不开放确认。'
  if (result.manualConfirmation != null || result.evidenceResource === 'USER_CONFIRMED') {
    return '已有人工确认记录，不能改选其他候选。'
  }
  if (pipeline.status !== 1 || stage.status !== 5 || ![1, 2].includes(result.status)) {
    return '仅运行中任务内等待人工处理、存在歧义或证据不足的分类可首次确认。'
  }
  if (!getTaxonomyConfirmationCandidates(stage).length) return '未提供可供确认的有效候选。'
  return ''
}

export function getTaxonomyConfirmationAvailability(
  state: TaxonomyConfirmationState,
  context: TaxonomyConfirmationContext
): { canEdit: boolean; canSubmit: boolean; canRecover: boolean; blockedReason: string } {
  const blockedReason = initialBlockedReason(context)
  const ready =
    sameContext(state, context) &&
    !state.submitting &&
    !context.refreshing &&
    !state.needsRefresh &&
    !state.conflict
  const canEdit = ready && state.phase === 'idle' && state.confirmedTaxId === null && !blockedReason
  const selected = getTaxonomyConfirmationCandidates(context.stage).some(
    (candidate) => candidate.taxid === state.selectedTaxId
  )
  const request = state.recoveryRequest
  const result = resultOf(context.stage)
  const canRecover =
    ready &&
    request !== null &&
    request.stageId === context.stage.stageId &&
    request.taxId === state.confirmedTaxId &&
    [1, 2].includes(context.pipeline.status) &&
    context.stage.stageType === 10 &&
    context.stage.status !== 6 &&
    result !== null &&
    result.status !== 3
  return {
    canEdit,
    canSubmit: canEdit && selected && state.reason.length <= 2000,
    canRecover,
    blockedReason
  }
}

/** Called on mount and successful detail refreshes. Never changes pipeline/stage DTOs. */
export function reconcileTaxonomyConfirmation(
  state: TaxonomyConfirmationState,
  context: TaxonomyConfirmationContext
): void {
  if (state.pipelineId === null && state.stageId === null) {
    state.pipelineId = context.pipeline.pipelineId
    state.stageId = context.stage.stageId
  }
  if (!sameContext(state, context) || state.submitting || context.refreshing) return
  if (
    state.needsRefresh &&
    (state.refreshAfterVersion === null || context.refreshVersion <= state.refreshAfterVersion)
  )
    return

  const result = resultOf(context.stage)
  const manual = asRecord(result?.manualConfirmation)
  const savedTaxId = positiveId(manual?.speciesTaxId) ? manual.speciesTaxId : null
  if (savedTaxId !== null) {
    const expected = state.submittedRequest?.taxId ?? state.confirmedTaxId
    if (expected !== null && expected !== undefined && savedTaxId !== expected) {
      state.conflict = true
      state.recoveryRequest = null
      state.needsRefresh = false
      state.noticeType = 'warning'
      state.notice = `刷新后的人工确认 TaxID 为 ${savedTaxId}，与本次请求不一致；已停止提交和恢复，请核对审计记录。`
      return
    }
    state.confirmedTaxId = savedTaxId
    state.selectedTaxId = savedTaxId
    state.phase = state.phase === 'scheduled' ? 'scheduled' : 'saved'
    state.needsRefresh = false
    if (state.phase === 'scheduled') {
      state.noticeType = 'success'
      state.notice = `服务端已确认 TaxID ${savedTaxId} 并完成下游调度；已刷新确认记录。`
    } else if (!state.notice || !state.recoveryRequest) {
      state.noticeType = 'info'
      state.notice = '已读取人工确认记录；未取得下游调度失败的明确证据，不提供恢复操作。'
    }
    return
  }
  if (!state.needsRefresh) {
    if (
      state.selectedTaxId !== null &&
      !getTaxonomyConfirmationCandidates(context.stage).some(
        (candidate) => candidate.taxid === state.selectedTaxId
      )
    )
      state.selectedTaxId = null
    return
  }
  // A definite saved response remains authoritative even if an older snapshot lacks its audit.
  if (state.confirmedTaxId !== null) {
    if (result) {
      state.needsRefresh = false
      if (state.phase === 'scheduled') {
        state.notice = `服务端已确认 TaxID ${state.confirmedTaxId} 并完成下游调度；本次刷新未提供人工确认审计记录，已保留接口确认结果。`
      }
    }
    return
  }
  if (!initialBlockedReason(context)) {
    state.phase = 'idle'
    state.needsRefresh = false
    state.submittedRequest = null
    state.noticeType = 'info'
    state.notice = '已刷新核实：当前仍待人工处理，未发现已保存的人工确认记录，可重新选择已有候选。'
    if (
      !getTaxonomyConfirmationCandidates(context.stage).some(
        (candidate) => candidate.taxid === state.selectedTaxId
      )
    )
      state.selectedTaxId = null
  } else {
    state.noticeType = 'warning'
    state.notice = '已刷新，但尚无法明确核实人工确认是否保存；继续锁定候选，请重新读取状态后核对。'
  }
}

/** Mark only a refresh requested after the response; pre-response refreshes cannot unlock. */
export function markTaxonomyConfirmationRefresh(
  state: TaxonomyConfirmationState,
  context: TaxonomyConfirmationContext
): boolean {
  if (!sameContext(state, context) || state.submitting || context.refreshing) return false
  if (state.needsRefresh) state.refreshAfterVersion = context.refreshVersion
  return true
}

function matchingConfirmation(
  value: unknown,
  request: ConfirmTaxonomyRequest
): TaxonomyConfirmationData | null {
  const data = asRecord(value)
  return data &&
    data.stageId === request.stageId &&
    data.taxId === request.taxId &&
    typeof data.version === 'number' &&
    Number.isFinite(data.version) &&
    typeof data.downstreamScheduled === 'boolean' &&
    typeof data.alreadyConfirmed === 'boolean'
    ? (data as TaxonomyConfirmationData)
    : null
}

function failureMessage(value: unknown): string {
  const error = asRecord(value)
  const response = asRecord(asRecord(error?.response)?.data) ?? error
  return typeof response?.failMsg === 'string' && response.failMsg.trim()
    ? response.failMsg
    : value instanceof Error
      ? value.message
      : '服务端未返回明确的确认成功结果'
}

export async function submitTaxonomyConfirmation(
  state: TaxonomyConfirmationState,
  context: TaxonomyConfirmationContext,
  dependencies: {
    confirm: (request: ConfirmTaxonomyRequest) => Promise<unknown>
    refresh: () => void
  },
  mode: 'initial' | 'recovery' = 'initial'
): Promise<boolean> {
  reconcileTaxonomyConfirmation(state, context)
  if (!sameContext(state, context)) return false
  const availability = getTaxonomyConfirmationAvailability(state, context)
  if (mode === 'recovery' ? !availability.canRecover : !availability.canSubmit) return false
  const request: ConfirmTaxonomyRequest =
    mode === 'recovery'
      ? { ...state.recoveryRequest! }
      : { stageId: context.stage.stageId, taxId: state.selectedTaxId! }
  if (mode === 'initial' && state.reason.trim()) request.reason = state.reason
  state.submittedRequest = { ...request }
  state.submitting = true
  state.notice = ''
  const sequence = ++state.requestSequence
  let outcome: unknown
  let rejected = false
  try {
    outcome = await dependencies.confirm({ ...request })
  } catch (error) {
    outcome = error
    rejected = true
  }
  // An old request can update its original per-stage state after unmount, never a reused state.
  if (!sameContext(state, context) || state.requestSequence !== sequence) return false
  const saved = matchingConfirmation(getSavedTaxonomyConfirmation(outcome), request)
  const response = asRecord(outcome)
  const successful =
    !rejected && response?.status === 0 ? matchingConfirmation(response.data, request) : null
  if (saved) {
    state.phase = 'saved'
    state.confirmedTaxId = request.taxId
    state.selectedTaxId = request.taxId
    state.recoveryRequest = { ...request }
    state.noticeType = 'warning'
    state.notice = `确认已保存（TaxID ${request.taxId}），但下游启动失败。刷新核实后可重试相同确认的调度，不能更换候选。`
  } else if (successful?.downstreamScheduled === true) {
    state.phase = 'scheduled'
    state.confirmedTaxId = request.taxId
    state.selectedTaxId = request.taxId
    state.recoveryRequest = null
    state.noticeType = 'success'
    state.notice = `服务端已确认 TaxID ${request.taxId} 并完成下游调度；正在刷新结果。`
  } else {
    state.phase = state.confirmedTaxId === null ? 'uncertain' : 'saved'
    state.noticeType = 'warning'
    state.notice = `本次请求未取得明确成功结果：${failureMessage(outcome)}。请先刷新核实，当前不能改选候选。`
  }
  state.needsRefresh = true
  state.refreshAfterVersion = null
  state.submitting = false
  dependencies.refresh()
  return true
}
