<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReferenceLibraryItem } from '../../api/referenceLibrary'

const props = withDefaults(defineProps<{
  candidates: ReferenceLibraryItem[]
  selectedIds: number[]
  loading: boolean
  loaded: boolean
  error: string
  missingSelectedIds?: number[]
  validationMessage?: string
}>(), {
  missingSelectedIds: () => [],
  validationMessage: ''
})

const emit = defineEmits<{
  refresh: []
  select: [id: number, selected: boolean]
  'select-all': []
  'clear-selection': []
  'remove-unavailable': []
}>()

const currentPage = ref(1)
const pageSize = ref(20)
const complete = computed(() => props.loaded && !props.loading && !props.error)
const selectedIdSet = computed(() => new Set(props.selectedIds))
const selectedCount = computed(() =>
  props.candidates.filter(item => selectedIdSet.value.has(item.referenceId)).length
)
const pagedCandidates = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return props.candidates.slice(start, start + pageSize.value)
})

watch(() => props.candidates.length, length => {
  currentPage.value = Math.min(currentPage.value, Math.max(1, Math.ceil(length / pageSize.value)))
})

function changePageSize(size: number): void {
  pageSize.value = size
  currentPage.value = 1
}

function selectReference(referenceId: number, selected: boolean | string | number): void {
  if (complete.value) emit('select', referenceId, selected === true)
}

function displayValue(value: string | number | null | undefined): string | number {
  return value == null || value === '' ? '—' : value
}
</script>

<template>
  <section class="task-reference-selection" aria-labelledby="task-reference-heading">
    <div class="reference-heading">
      <div>
        <h3 id="task-reference-heading">本批次参考范围</h3>
        <p>默认勾选当前专项下全局启用的参考，可取消本批次不使用的项。此处选择不会修改参考库的全局启用状态。</p>
        <p>所选范围统一用于本批次每条流水线。Reads 输入由后端选择后续参考；FASTA 输入逐条比较全部候选，不选择最优参考。</p>
      </div>
      <el-button data-testid="refresh-references" :loading="loading" :disabled="loading" @click="emit('refresh')">
        刷新参考列表
      </el-button>
    </div>

    <div v-if="loading" class="reference-status" role="status" data-testid="reference-loading">
      正在加载完整参考列表，请稍候……
    </div>
    <div v-else-if="error" class="reference-status" data-testid="reference-error">
      <el-alert :title="error" type="error" :closable="false" show-icon />
      <p>未能加载完整参考范围，暂不能继续创建。原有选择不会自动恢复全选或被删除。</p>
      <el-button type="primary" @click="emit('refresh')">重新加载</el-button>
    </div>
    <div v-else-if="!loaded" class="reference-status" role="status" data-testid="reference-not-loaded">
      尚未加载参考列表，请先加载当前专项下的参考。
      <el-button @click="emit('refresh')">加载参考</el-button>
    </div>
    <template v-else>
      <div v-if="missingSelectedIds.length" class="unavailable-selection" data-testid="unavailable-selection">
        <el-alert
          title="部分已选参考不再位于当前可用候选中，请复核后移除失效选择"
          type="warning"
          :closable="false"
          show-icon
        />
        <p>失效参考 ID：{{ missingSelectedIds.join('、') }}</p>
        <el-button type="warning" plain data-testid="remove-unavailable" @click="emit('remove-unavailable')">
          移除失效选择
        </el-button>
      </div>

      <el-alert v-if="validationMessage" :title="validationMessage" type="warning" :closable="false" show-icon />

      <el-empty
        v-if="!candidates.length"
        data-testid="reference-empty"
        description="该专项暂无全局启用的参考，请先维护参考库"
      />
      <template v-else>
        <div class="reference-controls">
          <span data-testid="reference-count" aria-live="polite">已选 {{ selectedCount }} / 共 {{ candidates.length }} 条参考</span>
          <span v-if="missingSelectedIds.length">另有 {{ missingSelectedIds.length }} 条失效选择待处理</span>
          <el-button data-testid="select-all-references" @click="emit('select-all')">全选</el-button>
          <el-button data-testid="clear-reference-selection" @click="emit('clear-selection')">全不选</el-button>
        </div>
        <el-table :data="pagedCandidates" row-key="referenceId" class="reference-selection-table">
          <el-table-column label="本次使用" width="100" align="center">
            <template #default="{ row }">
              <el-checkbox
                :model-value="selectedIdSet.has(row.referenceId)"
                :aria-label="`本批次使用参考 ${row.accession || row.referenceId}`"
                :data-testid="`reference-choice-${row.referenceId}`"
                @change="selectReference(row.referenceId, $event)"
              />
            </template>
          </el-table-column>
          <el-table-column label="参考标识 accession" min-width="160">
            <template #default="{ row }">{{ displayValue(row.accession) }}</template>
          </el-table-column>
          <el-table-column label="分类名称" min-width="170">
            <template #default="{ row }">{{ displayValue(row.organismName) }}</template>
          </el-table-column>
          <el-table-column label="实际 Tax ID" min-width="110">
            <template #default="{ row }">{{ displayValue(row.taxId) }}</template>
          </el-table-column>
          <el-table-column label="节段" min-width="90">
            <template #default="{ row }">{{ displayValue(row.segment) }}</template>
          </el-table-column>
          <el-table-column label="来源" min-width="120">
            <template #default="{ row }">{{ displayValue(row.sourceDb) }}</template>
          </el-table-column>
          <el-table-column label="序列长度（bp）" min-width="130">
            <template #default="{ row }">{{ displayValue(row.genomeLength) }}</template>
          </el-table-column>
        </el-table>
        <div class="reference-pagination">
          <el-pagination
            data-testid="reference-pagination"
            v-model:current-page="currentPage"
            :page-size="pageSize"
            :page-sizes="[20, 50, 100]"
            :total="candidates.length"
            layout="total, sizes, prev, pager, next"
            @size-change="changePageSize"
          />
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.task-reference-selection {
  margin-top: 24px;
  padding: 20px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color);
}
.reference-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}
.reference-heading h3 { margin: 0 0 8px; }
.reference-heading p,
.reference-status p,
.unavailable-selection p {
  margin: 6px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.reference-heading .el-button { flex-shrink: 0; }
.reference-status { padding: 18px 0; }
.reference-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 16px 0;
}
.reference-controls .el-button + .el-button { margin-left: 0; }
.unavailable-selection { margin-bottom: 16px; }
.unavailable-selection p { overflow-wrap: anywhere; }
.reference-pagination { display: flex; justify-content: flex-end; margin-top: 16px; overflow-x: auto; }
@media (max-width: 760px) {
  .reference-heading { flex-direction: column; }
  .task-reference-selection { padding: 14px; }
  .reference-pagination { justify-content: flex-start; }
}
</style>
