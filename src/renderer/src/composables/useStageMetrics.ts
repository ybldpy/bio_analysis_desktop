import { onScopeDispose, ref, watch } from 'vue'
import type { AnalysisPipelineStage } from '../common/analysisPipeline'
import { readStageReportJson } from '../api/pipelineResults'

export function useStageMetrics(
  getStage: () => AnalysisPipelineStage,
  getRefreshVersion: () => number,
  read = readStageReportJson
) {
  const metrics = ref<Record<string, any> | null>(null)
  const loading = ref(false)
  const error = ref('')
  let controller: AbortController | null = null
  let sequence = 0

  async function reload() {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const requestId = ++sequence
    metrics.value = null
    loading.value = false
    error.value = ''
    const stage = getStage()
    const key = stage.output.urls?.metricsUrl
    if (
      ![20, 40, 41].includes(stage.stageType) ||
      ![4, 5, 6].includes(stage.status) ||
      stage.output.parseErrors?.urls ||
      typeof key !== 'string' ||
      !key.trim()
    )
      return
    loading.value = true
    try {
      const result = await read(key, signal)
      if (requestId !== sequence || signal.aborted) return
      metrics.value = result
    } catch (cause) {
      if (requestId !== sequence || signal.aborted) return
      error.value = cause instanceof Error ? cause.message : '指标文件读取失败'
    } finally {
      if (requestId === sequence) loading.value = false
    }
  }

  watch(
    () => [
      getStage().stageId,
      getStage().stageType,
      getStage().status,
      getStage().output.urls?.metricsUrl,
      getStage().output.parseErrors?.urls,
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
  return { metrics, loading, error, reload }
}
