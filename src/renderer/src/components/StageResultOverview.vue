<script setup lang="ts">
import { computed } from 'vue'
import type { AnalysisPipeline, AnalysisPipelineStage } from '../common/analysisPipeline'
import { asRecord, formatDate } from '../common/pipelineResults'
import { useStageMetrics } from '../composables/useStageMetrics'
import { useStageReport } from '../composables/useStageReport'
import InputResult from './pipelineResults/InputResult.vue'
import ReferenceSelectionResult from './pipelineResults/ReferenceSelectionResult.vue'
import ReferenceComparisonResult from './pipelineResults/ReferenceComparisonResult.vue'
import TaxonomyResult from './pipelineResults/TaxonomyResult.vue'
import TaxonomyConfirmation from './pipelineResults/TaxonomyConfirmation.vue'
import MetricsResult from './pipelineResults/MetricsResult.vue'
import ResultFiles from './pipelineResults/ResultFiles.vue'
import QcReportResult from './pipelineResults/QcReportResult.vue'
import TextReportResult from './pipelineResults/TextReportResult.vue'
import type { TaxonomyConfirmationState } from './pipelineResults/taxonomyConfirmationState'

const props = defineProps<{
  pipelineStage: AnalysisPipelineStage
  pipeline: AnalysisPipeline
  refreshVersion: number
  refreshing: boolean
  confirmationState: TaxonomyConfirmationState | null
}>()
const emit = defineEmits(['refresh'])
const { metrics, loading, error, reload } = useStageMetrics(
  () => props.pipelineStage,
  () => props.refreshVersion
)
const isMetricsStage = computed(() => [20, 40, 41].includes(props.pipelineStage.stageType))
const isReportStage = computed(() => [0, 60, 61, 62, 64].includes(props.pipelineStage.stageType))
const {
  qcReport,
  textReport,
  loading: reportLoading,
  error: reportError,
  message: reportMessage,
  reload: reloadReport
} = useStageReport(
  () => props.pipelineStage,
  () => props.refreshVersion
)
const parseErrors = computed(() =>
  Object.values(props.pipelineStage.output.parseErrors ?? {}).filter(Boolean)
)
const skipReason = computed(() => {
  if (props.pipelineStage.stageType !== 64) return ''
  const reason = asRecord(props.pipelineStage.output.inline)?.skipReason
  return typeof reason === 'string' ? reason : ''
})
const duration = computed(() => {
  const start = props.pipelineStage.startTime?.getTime()
  const end = props.pipelineStage.endTime?.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—'
  const seconds = Math.floor((end - start) / 1000)
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分 ${seconds % 60} 秒`
})
const fallbackText = computed(() => {
  switch (props.pipelineStage.stageType) {
    case 30:
      return '当前结果提供组装文件，尚未提供序列条数、N50 等汇总指标。'
    case 72:
      return '当前结果提供注释文件；注释明细需要对应格式解析。'
    default:
      return '该阶段暂未提供专门的结果展示，请查看状态及已适配的文件。'
  }
})
</script>

<template>
  <div class="stage-overview">
    <div class="stage-times">
      <span>开始：{{ formatDate(pipelineStage.startTime) }}</span>
      <span>结束：{{ formatDate(pipelineStage.endTime) }}</span>
      <span>耗时：{{ duration }}</span>
    </div>
    <el-alert
      v-if="pipelineStage.status === 3"
      type="error"
      :closable="false"
      show-icon
      title="阶段执行失败"
      description="如有已保存的结果或文件，可能属于历史执行，不代表本次成功。详细日志需后端提供查询接口。"
    />
    <el-alert
      v-else-if="[0, 1, 2].includes(pipelineStage.status)"
      type="info"
      :closable="false"
      show-icon
      title="阶段尚未完成"
      description="暂缺结果是正常情况。已保存内容可能属于历史执行，完成后请刷新结果。"
    />
    <el-alert
      v-else-if="pipelineStage.status === 6"
      type="info"
      :closable="false"
      show-icon
      title="此阶段不适用或已跳过"
      :description="skipReason || '保留已有结果供查看；未提供具体原因时不作推断。'"
    />
    <el-alert
      v-for="(message, index) in parseErrors"
      :key="index"
      type="error"
      :closable="false"
      :title="String(message)"
      description="可点击顶部刷新结果重试；其他可读取的结果仍会展示。"
    />

    <InputResult v-if="pipelineStage.stageType === 80" :stage="pipelineStage" />
    <ReferenceSelectionResult v-else-if="pipelineStage.stageType === 44" :stage="pipelineStage" />
    <ReferenceComparisonResult
      v-else-if="pipelineStage.stageType === 43"
      :key="pipelineStage.stageId"
      :stage="pipelineStage"
      :refresh-version="refreshVersion"
      :pipeline-name="pipeline.analysisPipelineName"
    />
    <template v-else-if="pipelineStage.stageType === 10">
      <TaxonomyResult :stage="pipelineStage" />
      <TaxonomyConfirmation
        v-if="confirmationState"
        :state="confirmationState"
        :stage="pipelineStage"
        :pipeline="pipeline"
        :refresh-version="refreshVersion"
        :refreshing="refreshing"
        @refresh="emit('refresh')"
      />
    </template>
    <section v-else-if="isMetricsStage" class="metrics-panel" :aria-busy="loading">
      <div
        v-if="loading"
        v-loading="true"
        class="metrics-loading"
        element-loading-text="正在读取指标文件…"
      />
      <div v-else-if="error">
        <el-alert
          type="error"
          :title="error"
          :closable="false"
          description="指标读取失败，不影响下方文件下载。"
        />
        <el-button class="retry" type="primary" plain @click="reload">重新读取指标</el-button>
      </div>
      <MetricsResult v-else-if="metrics" :stage-type="pipelineStage.stageType" :metrics="metrics" />
      <el-empty
        v-else
        :image-size="70"
        :description="
          [4, 5, 6].includes(pipelineStage.status)
            ? '该记录未提供可读取的 metricsUrl 指标，已有文件仍可下载。'
            : '阶段尚未完成或执行失败，暂不自动读取指标文件。'
        "
      />
    </section>
    <section v-else-if="isReportStage" class="report-panel" :aria-busy="reportLoading">
      <div
        v-if="reportLoading"
        v-loading="true"
        class="metrics-loading"
        element-loading-text="正在读取报告…"
      />
      <div v-else-if="reportError">
        <el-alert
          type="error"
          :closable="false"
          :title="reportError"
          description="报告读取失败，不代表没有匹配记录；原文件仍可下载。"
        />
        <el-button class="retry" type="primary" plain @click="reloadReport">重新读取报告</el-button>
      </div>
      <QcReportResult v-else-if="qcReport" :report="qcReport" />
      <TextReportResult v-else-if="textReport" :report="textReport" />
      <el-empty v-else :description="reportMessage" :image-size="70" />
    </section>
    <el-alert v-else type="info" :closable="false" :title="fallbackText" />

    <ResultFiles :stage="pipelineStage" :pipeline-name="pipeline.analysisPipelineName" />
  </div>
</template>

<style scoped>
.stage-overview {
  min-width: 0;
}
.stage-times {
  display: flex;
  gap: 8px 20px;
  flex-wrap: wrap;
  color: #7a8a83;
  font-size: 12px;
  margin-bottom: 20px;
}
.stage-overview > .el-alert {
  margin-bottom: 16px;
}
.metrics-panel {
  margin-top: 18px;
}
.metrics-loading {
  min-height: 220px;
}
.retry {
  margin-top: 12px;
}
</style>
