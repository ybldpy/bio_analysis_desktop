<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import type { AnalysisPipeline, AnalysisPipelineStage } from '../../common/analysisPipeline'
import { confirmTaxonomy } from '../../api/pipelineResults'
import {
  getTaxonomyConfirmationAvailability,
  getTaxonomyConfirmationCandidates,
  markTaxonomyConfirmationRefresh,
  reconcileTaxonomyConfirmation,
  submitTaxonomyConfirmation,
  type TaxonomyConfirmationContext,
  type TaxonomyConfirmationState
} from './taxonomyConfirmationState'

const props = defineProps<{
  stage: AnalysisPipelineStage
  pipeline: AnalysisPipeline
  refreshVersion: number
  refreshing: boolean
  state: TaxonomyConfirmationState
}>()
const emit = defineEmits<{ refresh: [] }>()
let mounted = true
onBeforeUnmount(() => {
  mounted = false
})

function context(): TaxonomyConfirmationContext {
  return {
    stage: props.stage,
    pipeline: props.pipeline,
    refreshVersion: props.refreshVersion,
    refreshing: props.refreshing
  }
}

function requestRefresh(): void {
  if (mounted && markTaxonomyConfirmationRefresh(props.state, context())) emit('refresh')
}

watch(
  () => [
    props.stage,
    props.pipeline,
    props.refreshVersion,
    props.refreshing,
    props.state,
    props.state.needsRefresh,
    props.state.refreshAfterVersion
  ],
  () => {
    reconcileTaxonomyConfirmation(props.state, context())
    if (props.state.needsRefresh && props.state.refreshAfterVersion === null && !props.refreshing) {
      requestRefresh()
    }
  },
  { immediate: true }
)

const candidates = computed(() => getTaxonomyConfirmationCandidates(props.stage))
const availability = computed(() => getTaxonomyConfirmationAvailability(props.state, context()))
const reasonTooLong = computed(() => props.state.reason.length > 2000)

async function submit(mode: 'initial' | 'recovery'): Promise<void> {
  const originalState = props.state
  const originalContext = context()
  await submitTaxonomyConfirmation(
    originalState,
    originalContext,
    {
      confirm: confirmTaxonomy,
      refresh: () => {
        if (
          mounted &&
          props.state === originalState &&
          props.stage.stageId === originalContext.stage.stageId &&
          props.pipeline.pipelineId === originalContext.pipeline.pipelineId
        )
          requestRefresh()
      }
    },
    mode
  )
}
</script>

<template>
  <section class="taxonomy-confirmation" aria-label="人工确认操作">
    <h3>人工确认</h3>
    <el-alert
      v-if="state.notice"
      :title="state.notice"
      :type="state.noticeType"
      :closable="false"
      show-icon
    />
    <p v-if="state.confirmedTaxId !== null" class="confirmation-note">
      当前锁定的确认对象：TaxID {{ state.confirmedTaxId }}。已有确认不能在此改成其他候选。
    </p>
    <template v-if="state.phase === 'idle' && !availability.blockedReason">
      <p class="confirmation-note">
        仅能选择本阶段已保存的候选。提交后重新读取服务端结果，不在本地修改阶段状态。
      </p>
      <el-form label-position="top" @submit.prevent="submit('initial')">
        <el-form-item label="候选分类">
          <el-select
            v-model="state.selectedTaxId"
            placeholder="请选择一个已有候选"
            :disabled="!availability.canEdit"
            class="candidate-select"
          >
            <el-option
              v-for="candidate in candidates"
              :key="candidate.taxid"
              :value="candidate.taxid"
              :label="`${candidate.name}（TaxID ${candidate.taxid}）`"
            />
          </el-select>
        </el-form-item>
        <el-form-item
          label="确认原因（可选）"
          :error="reasonTooLong ? '确认原因不能超过 2000 个字符' : undefined"
        >
          <el-input
            v-model="state.reason"
            type="textarea"
            :rows="3"
            maxlength="2000"
            show-word-limit
            :disabled="!availability.canEdit"
            placeholder="填写核对依据，最多 2000 字符"
          />
        </el-form-item>
        <el-button
          type="primary"
          native-type="submit"
          :loading="state.submitting"
          :disabled="!availability.canSubmit"
          >确认所选候选</el-button
        >
      </el-form>
    </template>
    <p v-else-if="state.phase === 'idle' && availability.blockedReason" class="confirmation-note">
      {{ availability.blockedReason }}
    </p>
    <div v-if="state.needsRefresh || state.recoveryRequest" class="confirmation-actions">
      <el-button
        v-if="state.needsRefresh"
        :loading="refreshing"
        :disabled="state.submitting || refreshing"
        @click="requestRefresh"
        >重新读取确认状态</el-button
      >
      <el-button
        v-if="state.recoveryRequest"
        type="warning"
        :loading="state.submitting"
        :disabled="!availability.canRecover"
        @click="submit('recovery')"
        >重试原确认的下游调度</el-button
      >
    </div>
    <p v-if="state.recoveryRequest" class="confirmation-note">
      恢复请求固定使用原 TaxID
      {{ state.recoveryRequest.taxId }} 和原确认原因；恢复权限仍由服务端校验。
    </p>
    <p v-if="state.submitting" class="confirmation-note" role="status">正在提交，请勿重复操作。</p>
  </section>
</template>

<style scoped>
.taxonomy-confirmation {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}
h3 {
  margin: 0;
  font-size: 16px;
  color: var(--el-text-color-primary);
}
.confirmation-note {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}
.candidate-select {
  width: 100%;
}
.confirmation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.confirmation-actions .el-button {
  margin-left: 0;
}
</style>
