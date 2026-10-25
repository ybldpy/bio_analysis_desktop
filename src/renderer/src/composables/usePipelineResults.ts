import { computed, onScopeDispose, ref, watch } from 'vue'
import { requestPipeline, requestPipelineStages } from '../api/analysisPipeline'
import type { AnalysisPipeline, AnalysisPipelineStage } from '../common/analysisPipeline'
import { hasStageResult, sortResultStages } from '../common/pipelineResults'

export interface PipelineResultsTransport {
  pipeline: (id: number, signal?: AbortSignal) => Promise<AnalysisPipeline>
  stages: (id: number, signal?: AbortSignal) => Promise<AnalysisPipelineStage[]>
}

export function usePipelineResults(
  getPipelineId: () => number,
  getInitialStageId: () => number | undefined,
  transport: PipelineResultsTransport = { pipeline: requestPipeline, stages: requestPipelineStages }
) {
  const pipeline = ref<AnalysisPipeline | null>(null)
  const stages = ref<AnalysisPipelineStage[]>([])
  const selectedStageId = ref<number | null>(null)
  const selectedStage = computed(
    () => stages.value.find((stage) => stage.stageId === selectedStageId.value) ?? null
  )
  const loading = ref(true)
  const refreshing = ref(false)
  const error = ref('')
  const selectionMessage = ref('')
  const refreshVersion = ref(0)
  let controller: AbortController | null = null
  let sequence = 0

  function selectDefault(requested?: number | null) {
    selectionMessage.value = ''
    if (requested != null && stages.value.some((stage) => stage.stageId === requested)) {
      selectedStageId.value = requested
      return
    }
    if (requested != null) selectionMessage.value = '指定阶段已不存在，已切换至当前可查看的结果。'
    selectedStageId.value = stages.value.find(hasStageResult)?.stageId ?? null
  }

  async function refresh(reset = false) {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const requestId = ++sequence
    const pipelineId = getPipelineId()
    if (reset) {
      pipeline.value = null
      stages.value = []
      selectedStageId.value = null
      selectionMessage.value = ''
    }
    const firstLoad = pipeline.value === null
    loading.value = firstLoad
    refreshing.value = true
    error.value = ''
    try {
      if (!Number.isInteger(pipelineId) || pipelineId <= 0) throw new Error('任务编号无效')
      const [nextPipeline, nextStages] = await Promise.all([
        transport.pipeline(pipelineId, signal),
        transport.stages(pipelineId, signal)
      ])
      if (requestId !== sequence || signal.aborted) return false
      pipeline.value = nextPipeline
      stages.value = sortResultStages(nextStages)
      selectDefault(reset || firstLoad ? getInitialStageId() : selectedStageId.value)
      refreshVersion.value++
      return true
    } catch (cause) {
      if (requestId !== sequence || signal.aborted) return false
      controller.abort()
      error.value = cause instanceof Error ? cause.message : '加载任务结果失败，请重试'
      return false
    } finally {
      if (requestId === sequence) {
        loading.value = false
        refreshing.value = false
      }
    }
  }

  watch(
    getPipelineId,
    () => {
      void refresh(true)
    },
    { immediate: true }
  )
  watch(getInitialStageId, (stageId) => {
    if (!loading.value) selectDefault(stageId)
  })
  onScopeDispose(() => {
    sequence++
    controller?.abort()
  })

  return {
    pipeline,
    stages,
    selectedStageId,
    selectedStage,
    loading,
    refreshing,
    error,
    selectionMessage,
    refreshVersion,
    refresh
  }
}
