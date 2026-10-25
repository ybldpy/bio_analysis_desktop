<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import { getAnalysisPipelineTypeName } from '../common/analysisPipeline'
import { formatDate, getStageStatusMeta } from '../common/pipelineResults'
import { usePipelineResults } from '../composables/usePipelineResults'
import StageResultOverview from '../components/StageResultOverview.vue'
import {
  createTaxonomyConfirmationState,
  type TaxonomyConfirmationState
} from '../components/pipelineResults/taxonomyConfirmationState'

const props = defineProps<{ pipelineId: number; stageId?: number }>()
const emit = defineEmits(['back'])
const {
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
} = usePipelineResults(
  () => props.pipelineId,
  () => props.stageId
)
const confirmationStates = reactive(new Map<number, TaxonomyConfirmationState>())
const confirmationState = shallowRef<TaxonomyConfirmationState | null>(null)
watch(
  () => [props.pipelineId, selectedStage.value?.stageId],
  ([id, stageId], previous = []) => {
    if (id !== previous[0]) confirmationStates.clear()
    if (stageId == null) {
      confirmationState.value = null
      return
    }
    if (!confirmationStates.has(stageId))
      confirmationStates.set(stageId, createTaxonomyConfirmationState())
    confirmationState.value = confirmationStates.get(stageId)!
  },
  { immediate: true, flush: 'sync' }
)
const pipelineStatus = computed(
  () => ({ 1: '运行中', 2: '已完成', 3: '待启动' })[pipeline.value?.status ?? -1] ?? '未知状态'
)
const failedStages = computed(() => stages.value.filter((stage) => stage.status === 3).length)
const pendingActions = computed(() => stages.value.filter((stage) => stage.status === 5))
</script>

<template>
  <div class="task-results-page">
    <header class="result-header">
      <el-button text @click="emit('back')"
        ><el-icon><ArrowLeft /></el-icon>返回任务详情</el-button
      >
      <div class="heading-row">
        <div>
          <span class="eyebrow">任务结果 · #{{ pipelineId }}</span>
          <h1>{{ pipeline?.analysisPipelineName ?? '分析任务结果' }}</h1>
          <p v-if="pipeline" class="subtitle">
            {{ getAnalysisPipelineTypeName(pipeline.pipelineType) }} · {{ pipelineStatus }} · 创建于
            {{ formatDate(pipeline.createTime) }}
          </p>
        </div>
        <el-button :loading="refreshing" @click="refresh()"
          ><el-icon><Refresh /></el-icon>刷新结果</el-button
        >
      </div>
    </header>

    <div
      v-if="loading"
      v-loading="true"
      element-loading-text="正在加载任务结果…"
      class="page-loading"
    />
    <el-result
      v-else-if="!pipeline && error"
      icon="error"
      title="任务结果加载失败"
      :sub-title="error"
    >
      <template #extra><el-button type="primary" @click="refresh()">重新尝试</el-button></template>
    </el-result>
    <template v-else-if="pipeline">
      <el-alert
        v-if="error"
        class="notice"
        type="error"
        :closable="false"
        show-icon
        :title="`刷新失败，以下保留上次读取的结果：${error}`"
      />
      <el-alert
        v-if="selectionMessage"
        class="notice"
        type="info"
        :title="selectionMessage"
        :closable="false"
      />
      <el-alert
        v-if="failedStages"
        class="notice"
        type="warning"
        :closable="false"
        show-icon
        :title="`${failedStages} 个阶段执行失败；其他已产出的结果仍可查看。`"
      />
      <div v-if="pendingActions.length" class="action-notice">
        <span>有阶段需要人工处理：</span>
        <el-button
          v-for="stage in pendingActions"
          :key="stage.stageId"
          type="warning"
          link
          @click="selectedStageId = stage.stageId"
          >{{ stage.stageName }}</el-button
        >
      </div>
      <el-empty v-if="!stages.length" description="当前任务尚无分析阶段" />
      <div v-else class="results-layout">
        <nav class="stage-nav" aria-label="分析阶段">
          <div class="nav-title">
            分析阶段 <span>{{ stages.length }}</span>
          </div>
          <button
            v-for="stage in stages"
            :key="stage.stageId"
            type="button"
            :class="['stage-option', { selected: selectedStageId === stage.stageId }]"
            :aria-pressed="selectedStageId === stage.stageId"
            @click="selectedStageId = stage.stageId"
          >
            <span class="stage-name">{{ stage.stageName }}</span>
            <el-tag :type="getStageStatusMeta(stage.status).type" size="small" effect="light">
              {{ getStageStatusMeta(stage.status).label }}
            </el-tag>
          </button>
          <p class="nav-hint">仅展示实际阶段。运行中的任务可刷新获取最新结果。</p>
        </nav>
        <main class="stage-content">
          <template v-if="selectedStage">
            <div class="stage-heading">
              <h2>{{ selectedStage.stageName }}</h2>
              <el-tag :type="getStageStatusMeta(selectedStage.status).type">{{
                getStageStatusMeta(selectedStage.status).label
              }}</el-tag>
            </div>
            <StageResultOverview
              :key="`${pipelineId}:${selectedStage.stageId}`"
              :pipeline-stage="selectedStage"
              :pipeline="pipeline"
              :refresh-version="refreshVersion"
              :refreshing="refreshing"
              :confirmation-state="confirmationState"
              @refresh="refresh()"
            />
          </template>
          <el-empty
            v-else
            :description="`任务${pipelineStatus}，暂无已产出的结果；可选择阶段查看当前状态。`"
          />
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.task-results-page {
  max-width: 1500px;
  margin: 0 auto;
  color: #263d37;
}
.result-header {
  margin-bottom: 22px;
}
.result-header > .el-button {
  margin-left: -12px;
  margin-bottom: 12px;
}
.heading-row,
.stage-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.eyebrow {
  color: #71847d;
  font-size: 12px;
}
h1 {
  margin: 6px 0 8px;
  font-size: 24px;
  overflow-wrap: anywhere;
}
h2 {
  margin: 0;
  font-size: 19px;
}
.subtitle,
.nav-hint {
  font-size: 12px;
  color: #71847d;
  line-height: 1.7;
}
.notice,
.action-notice {
  margin-bottom: 14px;
}
.action-notice {
  padding: 10px 15px;
  background: #fdf6ec;
  border-radius: 8px;
  font-size: 13px;
}
.page-loading {
  min-height: 400px;
}
.results-layout {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.stage-nav {
  border: 1px solid #e1e9e5;
  border-radius: 12px;
  background: #fff;
  padding: 12px;
}
.nav-title {
  padding: 8px 8px 16px;
  font-weight: 600;
  font-size: 14px;
}
.nav-title span {
  color: #86968f;
  margin-left: 6px;
  font-weight: 400;
}
.stage-option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
  padding: 12px 10px;
  margin-bottom: 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #526960;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.stage-option:hover {
  background: #f5f9f7;
}
.stage-option.selected {
  background: #edf6f2;
  border-color: #b6d7ca;
  color: #176b54;
}
.stage-option:focus-visible {
  outline: 2px solid #167c6b;
  outline-offset: 2px;
}
.stage-name {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.stage-option .el-tag {
  flex-shrink: 0;
}
.nav-hint {
  padding: 6px;
  margin-bottom: 0;
}
.stage-content {
  min-width: 0;
  padding: 24px;
  background: #fff;
  border: 1px solid #e1e9e5;
  border-radius: 12px;
}
.stage-heading {
  margin-bottom: 20px;
}
@media (max-width: 980px) {
  .results-layout {
    grid-template-columns: 180px minmax(0, 1fr);
  }
  .stage-content {
    padding: 16px;
  }
}
@media (max-width: 720px) {
  .results-layout {
    grid-template-columns: 1fr;
  }
  .stage-nav {
    max-height: 250px;
    overflow: auto;
  }
  .heading-row {
    align-items: flex-start;
  }
}
</style>
