import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { AnalysisPipelineStage } from '../common/analysisPipeline'
import { readSmallStageReportText } from '../api/stageReportPreview'
import { parseQcReport, type QcReport } from '../components/pipelineResults/qcReport'
import { parseTextReport, type TextReport } from '../components/pipelineResults/textReport'

const reportFields: Record<number, string> = {
  0: 'reportJSON',
  60: 'amrResult',
  61: 'vfTsv',
  62: 'mlst',
  64: 'serotypeResultUrl'
}
const nonemptyKey = (value: unknown): value is string => typeof value === 'string' && !!value.trim()

export function getStageReportSpec(stage: AnalysisPipelineStage) {
  const field = reportFields[stage.stageType]
  if (!field) return { fileKey: null, message: '此阶段没有已适配的报告格式。' }
  if (stage.status !== 4)
    return { fileKey: null, message: '阶段尚未完成、执行失败或不适用，暂不自动读取报告。' }
  if (stage.output.parseErrors?.urls)
    return { fileKey: null, message: '报告索引解析失败，请刷新结果重试。' }
  const urls = stage.output.urls
  if (
    stage.stageType === 64 &&
    [urls?.kaptiveKResultUrl, urls?.kaptiveOResultUrl].some(nonemptyKey)
  )
    return { fileKey: null, message: 'Kaptive 报告格式尚未核实，请下载原报告查看。' }
  const key = stage.stageType === 61 && !nonemptyKey(urls?.vfTsv) ? urls?.amrTsv : urls?.[field]
  return nonemptyKey(key)
    ? { fileKey: key, message: '' }
    : { fileKey: null, message: '当前记录未提供可读取的报告文件，已有附件仍可下载。' }
}

export function useStageReport(
  getStage: () => AnalysisPipelineStage,
  getRefreshVersion: () => number,
  read = readSmallStageReportText
) {
  const qcReport = shallowRef<QcReport | null>(null)
  const textReport = shallowRef<TextReport | null>(null)
  const loading = ref(false)
  const error = ref('')
  const spec = computed(() => getStageReportSpec(getStage()))
  let controller: AbortController | null = null
  let sequence = 0

  async function reload() {
    controller?.abort()
    controller = new AbortController()
    const { signal } = controller
    const requestId = ++sequence
    qcReport.value = null
    textReport.value = null
    error.value = ''
    loading.value = false
    const stageType = getStage().stageType
    const key = spec.value.fileKey
    if (!key) return
    loading.value = true
    try {
      const text = await read(key, signal)
      if (requestId !== sequence || signal.aborted) return
      if (stageType === 0) qcReport.value = parseQcReport(text)
      else textReport.value = parseTextReport(stageType, text)
    } catch (cause) {
      if (requestId !== sequence || signal.aborted) return
      error.value = cause instanceof Error ? cause.message : '报告读取失败，请重试'
    } finally {
      if (requestId === sequence) loading.value = false
    }
  }

  watch(
    () => [
      getStage().stageId,
      getStage().stageType,
      spec.value.fileKey,
      spec.value.message,
      getRefreshVersion()
    ],
    () => {
      void reload()
    },
    { immediate: true }
  )
  onScopeDispose(() => {
    sequence++
    controller?.abort()
  })
  return {
    qcReport,
    textReport,
    loading,
    error,
    message: computed(() => spec.value.message),
    reload
  }
}
