<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import {
  getReferenceLibraryErrorMessage,
  getReferenceLibraryFailureStatus,
  isReferenceMembershipConfirmation,
  REFERENCE_UPLOAD_MAX_BYTES,
  uploadReferenceLibrary,
  validateReferenceUpload,
  type ReferenceLibraryItem,
  type ReferenceLibraryTarget,
  type ReferenceLibraryUpload
} from '../../api/referenceLibrary'

const props = withDefaults(
  defineProps<{ modelValue: boolean; target?: ReferenceLibraryTarget | null }>(),
  { target: null }
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [item: ReferenceLibraryItem]
  lookup: [accession: string]
  'navigation-lock': [locked: boolean]
}>()

function emptyForm(): ReferenceLibraryUpload {
  return {
    file: null,
    taxId: null,
    orgType: 0,
    accession: '',
    organismName: props.target?.label.trim() ?? '',
    segment: '',
    completeness: '',
    enabled: true
  }
}

const form = reactive(emptyForm())
let suggestedOrganismName = form.organismName
const phase = ref<'idle' | 'submitting' | 'membership-confirmation' | 'uncertain'>('idle')
const pendingMembershipInput = shallowRef<ReferenceLibraryUpload | null>(null)
const submitting = computed(() => phase.value === 'submitting')
const progress = ref<number | null>(null)
const error = ref('')
const notice = ref('')
const failureStatus = ref<number | null>(null)
const attemptedAccession = ref('')
const attemptedScope = ref('')
const lookupAccession = ref('')
const lookupError = ref('')
const lookupRequested = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const maximumMiB = REFERENCE_UPLOAD_MAX_BYTES / 1024 / 1024
let mounted = true
let requestVersion = 0
watch(
  () => phase.value === 'submitting' || phase.value === 'uncertain',
  (locked) => emit('navigation-lock', locked),
  { immediate: true, flush: 'sync' }
)
watch(
  () => props.target ? `${props.target.taxId}:${props.target.pipelineType}` : '',
  () => {
    requestVersion++
    pendingMembershipInput.value = null
    if (phase.value === 'submitting') {
      // Changing scope cannot establish whether the already-sent upload committed.
      recordFailure(new Error('上传期间专项已更换，请按原提交标识进行全局核实。'))
    } else if (phase.value !== 'uncertain') {
      phase.value = 'idle'
      error.value = ''
      notice.value = ''
      failureStatus.value = null
      const nextName = props.target?.label.trim() ?? ''
      // Replace the previous suggestion, but retain a name the user has edited.
      if (!form.organismName.trim() || form.organismName === suggestedOrganismName) {
        form.organismName = nextName
      }
      suggestedOrganismName = nextName
    }
  },
  { flush: 'sync' }
)
watch(form, () => cancelMembership(), { deep: true, flush: 'sync' })
watch(() => props.modelValue, (visible) => {
  if (!visible) cancelMembership()
}, { flush: 'sync' })
onBeforeUnmount(() => {
  // A closed application cannot establish whether the server committed this request.
  // Do not interpret unmounting as cancellation or rollback.
  mounted = false
  emit('navigation-lock', false)
})

function resetUpload(): void {
  pendingMembershipInput.value = null
  Object.assign(form, emptyForm())
  suggestedOrganismName = form.organismName
  progress.value = null
  error.value = ''
  notice.value = ''
  failureStatus.value = null
  attemptedAccession.value = ''
  attemptedScope.value = ''
  lookupAccession.value = ''
  lookupError.value = ''
  lookupRequested.value = false
  requestVersion++
  phase.value = 'idle'
}

function requestVisibility(value: boolean): void {
  if (!submitting.value) {
    if (!value) cancelMembership()
    emit('update:modelValue', value)
  }
}

function beforeClose(done: () => void): void {
  if (!submitting.value) {
    cancelMembership()
    done()
  }
}

function selectFile(event: Event): void {
  if (submitting.value) return
  const input = event.target as HTMLInputElement
  const files = input.files
  if (files?.length === 1) form.file = files[0]
  else if (files && files.length > 1) error.value = '一次只能选择一个文件，请重新选择。'
  input.value = ''
}

function setTaxId(value: number | undefined | null): void {
  if (!submitting.value && !props.target) form.taxId = value ?? null
}

function cancelMembership(): void {
  pendingMembershipInput.value = null
  if (phase.value === 'membership-confirmation') phase.value = 'idle'
}

function recordFailure(value: unknown): void {
  pendingMembershipInput.value = null
  failureStatus.value = getReferenceLibraryFailureStatus(value)
  const fallback =
    failureStatus.value === 3
      ? '该参考标识已存在，未覆盖原记录。可查询已有记录或修改标识后手动提交。'
      : failureStatus.value === 4
        ? '参数或文件校验失败，请检查表单与文件后手动提交。'
        : failureStatus.value === 1
          ? '本次上传未完成，请检查表单与文件后手动提交。'
          : '未能确认本次上传结果，请先查询参考序列库核实。'
  error.value = getReferenceLibraryErrorMessage(value, fallback)
  // Only documented, definite failures allow immediate manual correction and retry.
  phase.value = [1, 3, 4].includes(failureStatus.value ?? -1) ? 'idle' : 'uncertain'
  lookupAccession.value = attemptedAccession.value
  lookupRequested.value = false
  lookupError.value = ''
}

async function submit(): Promise<void> {
  if (phase.value !== 'idle') return
  const input: ReferenceLibraryUpload = {
    ...form,
    orgType: 0,
    ...(props.target
      ? {
          taxId: props.target.taxId,
          targetTaxId: props.target.taxId,
          pipelineType: props.target.pipelineType,
          confirmAddTaxonomyMember: false
        }
      : {})
  }
  await sendUpload(input)
}

async function confirmMembership(): Promise<void> {
  const input = pendingMembershipInput.value
  if (
    phase.value !== 'membership-confirmation' ||
    !input ||
    !props.target ||
    input.targetTaxId !== props.target.taxId ||
    input.pipelineType !== props.target.pipelineType
  ) return
  pendingMembershipInput.value = null
  await sendUpload({ ...input, confirmAddTaxonomyMember: true })
}

async function sendUpload(input: ReferenceLibraryUpload): Promise<void> {
  const validation = validateReferenceUpload(input)
  if (validation) {
    error.value = validation
    return
  }
  attemptedAccession.value = input.accession?.trim() ?? ''
  attemptedScope.value = props.target
    ? `${props.target.label}（Tax ID ${props.target.taxId}）`
    : '全局病毒参考上传'
  error.value = ''
  notice.value = ''
  failureStatus.value = null
  progress.value = null
  phase.value = 'submitting'
  const currentRequest = ++requestVersion
  try {
    const response = await uploadReferenceLibrary(input, {
      onUploadProgress: (percent) => {
        if (!mounted || phase.value !== 'submitting' || currentRequest !== requestVersion) return
        progress.value =
          typeof percent === 'number' && Number.isFinite(percent)
            ? Math.max(0, Math.min(100, percent))
            : null
      }
    })
    if (!mounted || currentRequest !== requestVersion) return
    if (isReferenceMembershipConfirmation(response, input)) {
      pendingMembershipInput.value = input
      phase.value = 'membership-confirmation'
      return
    }
    if (
      response?.status === 0 &&
      response.data &&
      Number.isSafeInteger(response.data.referenceId) &&
      response.data.referenceId > 0 &&
      typeof response.data.accession === 'string' &&
      response.data.accession.trim()
    ) {
      const item = response.data
      resetUpload()
      emit('created', item)
      return
    }
    recordFailure(response)
  } catch (failure) {
    if (mounted && currentRequest === requestVersion) recordFailure(failure)
  }
}

function updateLookup(value: string): void {
  lookupAccession.value = value
  lookupRequested.value = false
  lookupError.value = ''
}

function lookup(): void {
  if (submitting.value) return
  const accession = lookupAccession.value.trim()
  if (accession.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(accession)) {
    lookupError.value = '查询标识最长 64 个字符，且不能包含控制字符。'
    return
  }
  lookupRequested.value = true
  emit('lookup', accession)
  emit('update:modelValue', false)
}

function allowRetry(): void {
  if (phase.value !== 'uncertain' || !lookupRequested.value) return
  phase.value = 'idle'
  error.value = ''
  failureStatus.value = null
  notice.value = '你已确认完成核实。不会自动重传；请确认未重复入库，再手动提交。'
}

function endUpload(): void {
  if (phase.value !== 'uncertain' || !lookupRequested.value) return
  resetUpload()
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="上传追加参考序列"
    width="680px"
    class="reference-upload-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
    :before-close="beforeClose"
    @update:model-value="requestVisibility"
  >
    <div class="upload-content">
      <p class="upload-note">
        一份文件追加一条库记录，不覆盖已有 accession。文件内多条记录仍属于同一条参考。
        分类、节段及完整性由用户声明，不会自动推断；格式检查不代表质量结论。
      </p>
      <section class="upload-scope" data-testid="upload-scope">
        <template v-if="target">
          <strong>上传到专项：{{ target.label }}</strong>
          <p class="upload-note">
            Tax ID {{ target.taxId }} · 流水线类型 {{ target.pipelineType }} · 病毒参考
            <br />新增记录的分类由当前专项代填，不会修改已有参考的分类。
          </p>
        </template>
        <template v-else>
          <strong>全局病毒参考上传（未选择专项）</strong>
          <p class="upload-note">请填写参考的实际 Tax ID；本次上传不声明专项归属。</p>
        </template>
      </section>
      <el-alert v-if="error" type="error" :closable="false" show-icon>
        <template #title
          ><span class="upload-error" role="alert">{{ error }}</span></template
        >
      </el-alert>
      <el-alert v-if="notice" :title="notice" type="info" :closable="false" />
      <section v-if="phase === 'uncertain'" class="uncertain-warning" aria-label="提交结果待核实">
        <h3>提交结果待核实，已暂停重新提交</h3>
        <p>
          服务端可能已经保存记录。网络中断、超时或关闭界面均不表示服务端已撤销。
          修改字段或更换文件也不会解除待核实状态。
        </p>
        <p>本次提交范围：{{ attemptedScope }}</p>
        <p>本次提交时的标识：{{ attemptedAccession || '未填写，由服务端生成，当前尚未确认' }}</p>
      </section>

      <section
        v-if="phase === 'membership-confirmation'"
        class="membership-confirmation"
        data-testid="membership-confirmation"
        aria-label="确认专项分类归属"
      >
        <h3>确认纳入专项范围</h3>
        <p>
          此操作会将该分类下的已有及后续参考纳入当前专项范围，实际参与分析仍受启用状态控制。是否继续？
        </p>
        <p class="upload-note">
          这不是仅关联本次文件；使用同一目标 Tax ID 的其他专项选项也可能受影响。
          取消不会重新提交，修改表单或更换专项后需要重新确认。
        </p>
        <div class="lookup-actions">
          <el-button data-testid="cancel-membership" @click="cancelMembership">取消</el-button>
          <el-button type="warning" data-testid="confirm-membership" @click="confirmMembership">
            确认并继续上传
          </el-button>
        </div>
      </section>

      <el-form label-position="top" :disabled="submitting" @submit.prevent="submit">
        <el-form-item label="参考文件（必填）" required>
          <div class="file-selection">
            <input
              ref="fileInput"
              data-testid="upload-file"
              class="file-input"
              type="file"
              accept=".fasta,.fa,.fna,.gz,.gzip,.zip"
              :disabled="submitting"
              aria-label="选择一个参考文件"
              @change="selectFile"
            />
            <el-button :disabled="submitting" @click="fileInput?.click()">
              {{ form.file ? '替换文件' : '选择文件' }}
            </el-button>
            <span class="file-name" data-testid="selected-file">{{
              form.file?.name || '未选择文件'
            }}</span>
            <el-button
              v-if="form.file"
              data-testid="remove-file"
              :disabled="submitting"
              text
              @click="form.file = null"
              >移除</el-button
            >
          </div>
          <p class="upload-note">
            支持 .fasta、.fa、.fna、.gz、.gzip、.zip，默认上限 {{ maximumMiB }} MiB。 ZIP
            请仅放一个文件；服务端只读取第一个非目录文件，不会自动尝试后续文件。
            上传及解压后均有大小限制，最终以服务端与部署限制为准。
          </p>
        </el-form-item>
        <div v-if="!target" class="form-grid">
          <el-form-item label="Tax ID（必填，实际参考分类编号）" required>
            <el-input-number
              data-testid="tax-id"
              :model-value="form.taxId"
              :controls="false"
              :disabled="submitting"
              placeholder="正整数"
              @update:model-value="setTaxId"
            />
          </el-form-item>
        </div>
        <el-form-item label="参考标识 accession（可选）">
          <el-input
            v-model="form.accession"
            data-testid="accession"
            maxlength="64"
            show-word-limit
            :disabled="submitting"
            placeholder="留空时服务端生成本地 CUSTOM_ 标识，不是申请公共数据库标识"
          />
          <p class="upload-note">
            最长 64 字符；以字母或数字开头，其后仅允许字母、数字、点、下划线、冒号和连字符。
          </p>
        </el-form-item>
        <el-form-item label="分类名称（必填）" required>
          <el-input
            v-model="form.organismName"
            data-testid="organism-name"
            maxlength="255"
            show-word-limit
            :disabled="submitting"
            placeholder="请输入分类名称"
          />
          <p v-if="target" class="upload-note">默认使用当前专项名称，可修改；分类名称不能为空。</p>
        </el-form-item>
        <div class="form-grid">
          <el-form-item label="节段（可选）">
            <el-input
              v-model="form.segment"
              data-testid="segment"
              maxlength="64"
              show-word-limit
              :disabled="submitting"
            />
          </el-form-item>
          <el-form-item label="完整性说明（可选，自由文本）">
            <el-input
              v-model="form.completeness"
              data-testid="completeness"
              maxlength="32"
              show-word-limit
              :disabled="submitting"
            />
          </el-form-item>
        </div>
        <el-form-item>
          <el-checkbox v-model="form.enabled" data-testid="enabled" :disabled="submitting">
            导入后启用（允许作为后续分析候选）
          </el-checkbox>
          <p class="upload-note">
            这是全局候选资格，不代表某条任务已选中；已有任务保存的快照不变。
          </p>
        </el-form-item>

        <div v-if="submitting" class="upload-progress" role="status">
          <el-progress v-if="progress !== null" :percentage="progress" :show-text="true" />
          <p>
            {{
              progress === 100
                ? '服务端校验并导入中，请勿重复提交。'
                : '正在发送文件，请勿关闭或重复提交。'
            }}
          </p>
        </div>
        <el-button
          type="primary"
          native-type="submit"
          data-testid="submit-upload"
          :loading="submitting"
          :disabled="phase !== 'idle'"
          >上传追加</el-button
        >
      </el-form>

      <section
        v-if="phase === 'uncertain' || (failureStatus !== null && !submitting)"
        class="lookup-section"
        aria-label="查询核实上传结果"
      >
        <h3>全局查询核实</h3>
        <p class="upload-note">
          可填写原标识或手动复制服务端提示中的标识；不会从错误文字自动提取。
          留空将查看近期全部记录。此处为全局查询，清除专项、类别、Tax ID 和状态等限制，
          包含启用和禁用记录，表单会保留。
        </p>
        <el-input
          :model-value="lookupAccession"
          data-testid="lookup-accession"
          maxlength="64"
          clearable
          placeholder="要精确核实的 accession（可留空）"
          @update:model-value="updateLookup"
        />
        <p v-if="lookupError" class="upload-error" role="alert">{{ lookupError }}</p>
        <div class="lookup-actions">
          <el-button data-testid="lookup" @click="lookup">
            {{ lookupAccession.trim() ? '按标识查询核实' : '查看近期全部记录' }}
          </el-button>
          <el-button
            v-if="phase === 'uncertain'"
            type="warning"
            data-testid="allow-retry"
            :disabled="!lookupRequested"
            @click="allowRetry"
            >已核实，允许重新提交</el-button
          >
          <el-popconfirm
            v-if="phase === 'uncertain'"
            data-testid="end-upload-confirm"
            title="结束只清除当前表单，不会撤销服务端可能已保存的记录；请勿重复导入"
            :width="320"
            :disabled="!lookupRequested"
            confirm-button-text="确认结束"
            cancel-button-text="继续核实"
            @confirm="endUpload"
          >
            <template #reference>
              <el-button data-testid="end-upload" :disabled="!lookupRequested">
                结束本次上传
              </el-button>
            </template>
          </el-popconfirm>
        </div>
        <p v-if="phase === 'uncertain'" class="upload-note">
          请先查询，再返回本弹窗。已完成核实时可结束本次上传；只有确认尚未重复入库后，
          才能解锁手动提交。查询本身不会重传。
        </p>
      </section>
    </div>
    <template #footer>
      <el-button
        data-testid="close-upload"
        :disabled="submitting"
        @click="requestVisibility(false)"
      >
        {{ phase === 'uncertain' ? '关闭并保留待核实状态' : '关闭' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.upload-content {
  display: grid;
  gap: 16px;
}
.upload-note {
  width: 100%;
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.form-grid .el-input-number {
  width: 100%;
}
.file-selection,
.lookup-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.file-input {
  display: none;
}
.file-name,
.upload-error {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.upload-error {
  color: var(--el-color-danger);
}
.uncertain-warning,
.membership-confirmation,
.upload-scope,
.lookup-section {
  padding: 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  display: grid;
  gap: 10px;
}
.uncertain-warning,
.membership-confirmation {
  border-color: var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
}
h3,
.uncertain-warning p,
.membership-confirmation p {
  margin: 0;
  line-height: 1.7;
  font-size: 14px;
}
.lookup-actions .el-button {
  margin-left: 0;
}
@media (max-width: 600px) {
  .form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
