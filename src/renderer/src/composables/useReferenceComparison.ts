import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { readStageReportJson } from '../api/pipelineResults'
import type { AnalysisPipelineStage } from '../common/analysisPipeline'
import {
  parseReferenceComparisonIndex,
  parseReferenceComparisonReport,
  type ReferenceComparisonIndex,
  type ReferenceComparisonReport
} from '../common/referenceComparison'

export function useReferenceComparison(
  getStage: () => AnalysisPipelineStage,
  getRefreshVersion: () => number,
  read = readStageReportJson
) {
  const report = shallowRef<ReferenceComparisonReport | null>(null)
  const loading = ref(false)
  const error = ref('')
  const parsedIndex = computed(() => {
    const stage = getStage()
    if (stage.stageType !== 43) return { kind: 'empty' as const }
    try {
      if (stage.output.parseErrors?.urls) {
        throw new Error(`比较结果索引解析失败：${stage.output.parseErrors.urls}`)
      }
      return parseReferenceComparisonIndex(stage.output.urls)
    } catch (cause) {
      return {
        kind: 'invalid' as const,
        error: cause instanceof Error ? cause.message : '比较结果索引解析失败，请刷新结果重试'
      }
    }
  })
  const kind = computed(() => parsedIndex.value.kind)
  const index = computed<ReferenceComparisonIndex | null>(() =>
    parsedIndex.value.kind === 'v2' ? parsedIndex.value.index : null
  )
  const message = computed(() => {
    const stage = getStage()
    if (stage.stageType !== 43) return '此阶段不是参考比较阶段。'
    if (stage.status !== 4) return '阶段尚未完成、执行失败或不适用，暂不自动读取比较报告。'
    if (kind.value === 'legacy') return '历史结果未提供比较指标，请下载原始结果文件查看。'
    if (kind.value === 'empty') return '当前记录未提供参考比较结果。'
    return ''
  })
  let controller: AbortController | null = null
  let sequence = 0
  let disposed = false

  async function reload() {
    if (disposed) return
    controller?.abort()
    controller = null
    const requestId = ++sequence
    report.value = null
    loading.value = false
    error.value = ''
    const parsed = parsedIndex.value
    if (parsed.kind === 'invalid') {
      error.value = parsed.error
      return
    }
    if (getStage().status !== 4 || parsed.kind !== 'v2') return

    const currentIndex = parsed.index
    controller = new AbortController()
    const { signal } = controller
    loading.value = true
    try {
      const rawReport = await read(currentIndex.comparisonJsonUrl, signal)
      if (requestId !== sequence || signal.aborted) return
      report.value = parseReferenceComparisonReport(rawReport, currentIndex)
    } catch (cause) {
      if (requestId !== sequence || signal.aborted) return
      error.value = cause instanceof Error ? cause.message : '参考比较报告读取失败，请重试'
    } finally {
      if (requestId === sequence) loading.value = false
    }
  }

  watch(
    () => [
      getStage().stageId,
      getStage().stageType,
      getStage().status,
      getStage().output.urls,
      getStage().output.parseErrors?.urls,
      getRefreshVersion()
    ],
    () => { void reload() },
    { immediate: true, deep: true, flush: 'sync' }
  )
  onScopeDispose(() => {
    disposed = true
    sequence++
    controller?.abort()
    loading.value = false
  })
  return { index, report, kind, loading, error, message, reload }
}
