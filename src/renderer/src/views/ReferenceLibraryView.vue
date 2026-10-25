<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '../components/PageHeader.vue'
import ReferenceUploadDialog from '../components/referenceLibrary/ReferenceUploadDialog.vue'
import {
  downloadReferenceLibraryFile, getReferenceDownloadName, getReferenceLibraryErrorMessage,
  type ReferenceLibraryItem, type ReferenceLibraryTarget
} from '../api/referenceLibrary'
import { fetchVirusTargets } from '../api/analysisPipeline'
import { referenceLibraryDeployment } from '../common/referenceLibraryConfig'
import { useReferenceLibrary } from '../composables/useReferenceLibrary'

const emit = defineEmits<{ 'navigation-lock': [locked: boolean] }>()
const uploadVisible = ref(false)
const uploadNavigationLocked = ref(false)
const {
  filters, page, pageSize, total, items, loading, hasLoaded, listError, filterError,
  search, resetFilters, changePage, changePageSize, refresh, lookupAccession,
  toggleEnabled, pendingIds, operationError, operationMessage,
  detailVisible, detailLoading, detailError, detailItem,
  openDetail, refreshDetail, closeDetail,
  selectedTarget, selectTarget, isGlobalLookup, returnToManagement
} = useReferenceLibrary()
const targetContextEnabled = referenceLibraryDeployment.targetContextConfirmed
const targets = ref<ReferenceLibraryTarget[]>([])
const targetsLoading = ref(false)
const targetsError = ref('')
const downloadingIds = reactive(new Set<number>())
let active = true
let targetRequest = 0

function targetKey(target: ReferenceLibraryTarget | null): string {
  return target ? `${target.pipelineType}:${target.taxId}` : ''
}

const selectedTargetAvailable = computed(() => !selectedTarget.value || (
  targetContextEnabled && !targetsLoading.value && !targetsError.value &&
  targets.value.some(target => targetKey(target) === targetKey(selectedTarget.value))
))
const scopeTitle = computed(() => isGlobalLookup.value
  ? '全局上传结果核实（不限类别和专项）'
  : selectedTarget.value ? `${selectedTarget.value.label} · 专项参考` : '全部病毒参考（无专项筛选）'
)

async function loadTargets(): Promise<void> {
  if (!targetContextEnabled || uploadNavigationLocked.value) return
  const request = ++targetRequest
  targetsLoading.value = true
  targetsError.value = ''
  try {
    const response = await fetchVirusTargets()
    if (!active || request !== targetRequest) return
    if (response?.status !== 0 || !Array.isArray(response.data)) throw response
    const supported = response.data.filter(target => target.pipelineType === 100 || target.pipelineType === 101)
    if (supported.some(target => !Number.isSafeInteger(target.taxId) || target.taxId <= 0 ||
      typeof target.label !== 'string' || !target.label.trim() ||
      (target.pipelineType === 101 && target.taxId !== 2697049))) {
      throw new Error('专项列表格式不正确')
    }
    const unique = new Map(supported.map(target => [targetKey(target), target]))
    targets.value = [...unique.values()]
  } catch (error) {
    if (!active || request !== targetRequest) return
    targets.value = []
    targetsError.value = getReferenceLibraryErrorMessage(error, '专项列表加载失败，请重试')
    // Never change the selected scope or replace its rows with a global query on failure.
  } finally {
    if (active && request === targetRequest) targetsLoading.value = false
  }
}

function handleTargetChange(key: string): void {
  if (!targetContextEnabled || uploadNavigationLocked.value || targetsLoading.value) return
  const target = key ? targets.value.find(item => targetKey(item) === key) : null
  if (key && !target) return
  void selectTarget(target ?? null)
}

function openUpload(): void {
  if (!selectedTargetAvailable.value && !uploadNavigationLocked.value) return
  uploadVisible.value = true
}

async function downloadReference(item: ReferenceLibraryItem): Promise<void> {
  if (!item.fastaObjectName?.trim() || downloadingIds.has(item.referenceId)) return
  downloadingIds.add(item.referenceId)
  try {
    const blob = await downloadReferenceLibraryFile(item)
    if (!active) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    try {
      link.href = url
      link.download = getReferenceDownloadName(item)
      document.body.appendChild(link)
      link.click()
    } finally {
      link.remove()
      // Allow the browser to consume the URL before releasing the Blob.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  } catch (error) {
    if (active) ElMessage.error(getReferenceLibraryErrorMessage(error, '参考文件下载失败，请重试'))
  } finally {
    downloadingIds.delete(item.referenceId)
  }
}

function displayLength(length: number | null): string {
  return typeof length === 'number' && Number.isFinite(length)
    ? `${length.toLocaleString()} bp`
    : '未提供'
}

function categoryName(orgType: number | null): string {
  return orgType === 0 ? '病毒' : orgType === 1 ? '细菌' : '未提供'
}

function sourceName(source: string | null): string {
  return source === 'USER_UPLOAD' ? '用户上传' : source || '未提供'
}

function handleCreated(item: ReferenceLibraryItem) {
  uploadVisible.value = false
  ElMessage.success('参考序列已追加成功')
  // Keep the current filters; the new item may not belong to the visible page.
  if (isGlobalLookup.value) void returnToManagement()
  else void refresh()
  void openDetail(item.referenceId)
}

function handleLookup(accession: string) {
  uploadVisible.value = false
  void lookupAccession(accession)
}

function handleDetailVisibleChange(visible: boolean) {
  if (!visible) closeDetail()
}

function handleNavigationLock(locked: boolean) {
  uploadNavigationLocked.value = locked
  emit('navigation-lock', locked)
}

onMounted(() => { void refresh(); void loadTargets() })
onBeforeUnmount(() => { active = false; targetRequest++ })
</script>

<template>
  <div class="reference-library-page">
    <PageHeader title="参考序列库" description="追加参考序列，管理后续分析允许使用的候选范围">
      <el-button type="primary" :disabled="!selectedTargetAvailable && !uploadNavigationLocked" @click="openUpload">
        <el-icon><Upload /></el-icon>{{ selectedTarget ? '向当前专项上传' : '全局上传病毒参考' }}
      </el-button>
    </PageHeader>

    <el-alert
      class="scope-notice"
      type="info"
      title="这是参考库的全局设置，不是为当前任务选择参考"
      description="启停是全局设置，同一参考在其他专项中的状态也会改变。最终参考由流水线自动选择；禁用不删除序列，不修改已有任务保存的参考快照。"
      :closable="false"
      show-icon
    />
    <el-alert v-if="uploadNavigationLocked && !uploadVisible" class="scope-notice" type="warning" :closable="false" show-icon>
      <template #title>上次上传结果仍待核实</template>
      <p>请先查询记录，完成核实后再结束本次上传或决定是否重新提交。</p>
      <el-button link type="primary" @click="uploadVisible = true">继续核实上传结果</el-button>
    </el-alert>

    <el-card shadow="never" class="target-card">
      <div class="target-toolbar">
        <div class="target-selection">
          <label>管理模块</label>
          <el-select
            :model-value="targetKey(selectedTarget)"
            filterable
            :loading="targetsLoading"
            :disabled="!targetContextEnabled || targetsLoading || uploadNavigationLocked"
            aria-label="选择参考管理模块"
            @change="handleTargetChange"
          >
            <el-option label="全部病毒参考（无专项筛选）" value="" />
            <el-option v-for="target in targets" :key="targetKey(target)"
              :label="`${target.label} · Tax ID ${target.taxId} · ${target.pipelineType}`" :value="targetKey(target)" />
          </el-select>
        </div>
        <el-button v-if="targetContextEnabled" :loading="targetsLoading" :disabled="uploadNavigationLocked" @click="loadTargets">刷新专项</el-button>
      </div>
      <el-alert v-if="!targetContextEnabled" class="message" title="专项功能待部署确认"
        description="当前仅提供全局病毒参考管理。确认后端支持专项查询和归属确认后再启用专项入口。" type="info" :closable="false" />
      <el-alert v-else-if="targetsError" class="message" :title="targetsError" type="error" :closable="false" show-icon />
      <p v-else-if="!targetsLoading && !targets.length" class="query-note">暂无可用病毒专项；未自动添加选项。</p>
      <el-alert v-if="selectedTarget && !selectedTargetAvailable && !targetsLoading" class="message" type="warning"
        title="当前专项尚未核实或已不在最新选项中，请重新选择或刷新专项列表。不会自动改查全库。" :closable="false" />
      <p v-if="selectedTarget" class="query-note">当前专项：{{ selectedTarget.label }} · Tax ID {{ selectedTarget.taxId }} · 流程 {{ selectedTarget.pipelineType }}。成员范围由后端归集，空列表不表示专项不存在。</p>
    </el-card>

    <el-alert v-if="isGlobalLookup" class="scope-notice" type="warning" :closable="false" show-icon>
      <template #title>全局上传结果核实：不限专项、类别、实际 Tax ID 和启用状态</template>
      <p>仅按 accession 精确查询；未填标识时显示近期全库记录。此处只读核实，不是当前专项的参考范围。</p>
      <el-button link type="primary" @click="returnToManagement">返回{{ selectedTarget ? '当前专项' : '病毒参考' }}管理</el-button>
    </el-alert>

    <el-card shadow="never" class="library-card">
      <el-form v-if="!isGlobalLookup" label-position="top" class="filters" @submit.prevent="search">
        <el-form-item label="Tax ID">
          <el-input v-model="filters.taxId" inputmode="numeric" clearable placeholder="实际参考 Tax ID（精确）" />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-select v-model="filters.enabled" aria-label="筛选启用状态">
            <el-option label="全部状态" value="" />
            <el-option label="仅启用" value="enabled" />
            <el-option label="仅禁用" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="参考标识 accession">
          <el-input v-model="filters.accession" clearable :maxlength="64" placeholder="完整标识（精确匹配）" />
        </el-form-item>
        <div class="filter-actions">
          <el-button type="primary" native-type="submit">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </div>
      </el-form>
      <p v-if="!isGlobalLookup" class="query-note">{{ selectedTarget ? '在当前专项范围内进一步精确筛选。' : '当前查询全部病毒参考，不按专项筛选。' }}实际 Tax ID 为精确匹配，不自动包含下级分类；分类名称不参与搜索。结果按参考记录 ID 从新到旧排列。</p>
      <p v-else class="query-note">核实标识：{{ filters.accession || '未指定（近期全部记录）' }}</p>
      <el-alert v-if="filterError" class="message" :title="filterError" type="warning" :closable="false" show-icon />

      <div class="list-heading">
        <div><strong>{{ scopeTitle }}</strong><span v-if="hasLoaded">共 {{ total }} 条</span></div>
        <el-button :loading="loading" @click="refresh">
          <el-icon><Refresh /></el-icon>刷新列表
        </el-button>
      </div>

      <el-alert v-if="listError" class="message" type="error" :closable="false" show-icon>
        <template #title>{{ listError }}</template>
        <p v-if="hasLoaded" class="error-note">当前保留上次加载的记录，请刷新以核实最新状态。</p>
        <el-button link type="primary" :disabled="loading" @click="refresh">重新加载</el-button>
      </el-alert>
      <el-alert v-if="operationError" class="message" :title="operationError" type="error" :closable="false" show-icon />
      <el-alert v-else-if="operationMessage" class="message" :title="operationMessage" type="success" :closable="false" show-icon />

      <el-table
        v-loading="loading"
        element-loading-text="正在加载参考序列..."
        :data="items"
        row-key="referenceId"
        class="reference-table"
      >
        <el-table-column label="分类名称 / accession" min-width="245">
          <template #default="{ row }">
            <div v-if="row?.referenceId" class="reference-name">
              <el-button link type="primary" @click="openDetail(row.referenceId)">
                {{ row.organismName || '未提供分类名称' }}
              </el-button>
              <span>{{ row.accession || '未提供标识' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="taxId" label="Tax ID" width="112" />
        <el-table-column label="类别" width="72">
          <template #default="{ row }">{{ categoryName(row?.orgType) }}</template>
        </el-table-column>
        <el-table-column label="来源" min-width="125" show-overflow-tooltip>
          <template #default="{ row }">{{ sourceName(row?.sourceDb) }}</template>
        </el-table-column>
        <el-table-column label="序列总长度" min-width="135">
          <template #default="{ row }">{{ displayLength(row?.genomeLength) }}</template>
        </el-table-column>
        <el-table-column label="节段" min-width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row?.segment || '未提供' }}</template>
        </el-table-column>
        <el-table-column label="允许作为分析候选" width="170" align="center">
          <template #default="{ row }">
            <el-switch
              v-if="row?.referenceId"
              :model-value="row.enabled"
              :loading="pendingIds.has(row.referenceId)"
              :disabled="isGlobalLookup || loading || pendingIds.has(row.referenceId)"
              :aria-label="`${row.accession || row.referenceId} 允许作为分析候选`"
              active-text="启用"
              inactive-text="禁用"
              inline-prompt
              width="62"
              @change="(value) => toggleEnabled(row, value === true)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="135" align="right" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row?.referenceId" link type="primary" @click="openDetail(row.referenceId)">详情</el-button>
            <el-button v-if="row?.referenceId" link type="primary"
              :disabled="!row.fastaObjectName?.trim()" :loading="downloadingIds.has(row.referenceId)"
              @click="downloadReference(row)">下载</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty
            :image-size="80"
            :description="listError ? '参考记录加载失败，请重试' : loading ? '正在加载参考记录' : '没有符合条件的参考记录'"
          />
        </template>
      </el-table>

      <div class="pagination">
        <el-pagination
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[20, 50, 100]"
          :total="total"
          :disabled="loading"
          layout="total, sizes, prev, pager, next"
          @current-change="changePage"
          @size-change="changePageSize"
        />
      </div>
    </el-card>
    <p class="access-note">管理操作仅适用于本参考候选库，不会更新独立工具数据库。请在受控内部环境使用。</p>

    <el-drawer
      :model-value="detailVisible"
      title="参考记录详情"
      size="520px"
      @update:model-value="handleDetailVisibleChange"
    >
      <div v-loading="detailLoading" class="detail-body" element-loading-text="正在加载详情...">
        <div class="detail-toolbar">
          <span>以服务端当前记录为准</span>
          <el-button :loading="detailLoading" @click="refreshDetail">刷新详情</el-button>
        </div>
        <el-alert v-if="detailError" class="message" :title="detailError" type="error" :closable="false" show-icon />
        <el-descriptions v-if="detailItem" :column="1" border>
          <el-descriptions-item label="记录 ID">{{ detailItem.referenceId }}</el-descriptions-item>
          <el-descriptions-item label="分类名称">{{ detailItem.organismName || '未提供' }}</el-descriptions-item>
          <el-descriptions-item label="Tax ID">{{ detailItem.taxId }}</el-descriptions-item>
          <el-descriptions-item label="类别">{{ categoryName(detailItem.orgType) }}</el-descriptions-item>
          <el-descriptions-item label="accession"><span class="break-text">{{ detailItem.accession }}</span></el-descriptions-item>
          <el-descriptions-item label="来源">{{ sourceName(detailItem.sourceDb) }}</el-descriptions-item>
          <el-descriptions-item label="序列总长度">{{ displayLength(detailItem.genomeLength) }}</el-descriptions-item>
          <el-descriptions-item label="节段">{{ detailItem.segment || '未提供' }}</el-descriptions-item>
          <el-descriptions-item label="完整性描述">{{ detailItem.completeness || '未提供' }}</el-descriptions-item>
          <el-descriptions-item label="注释状态">{{ detailItem.isAnnotated ? '已注释' : '未注释' }}</el-descriptions-item>
          <el-descriptions-item label="允许作为候选">
            <el-tag :type="detailItem.enabled ? 'success' : 'info'">{{ detailItem.enabled ? '启用' : '禁用' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="文件对象键">
            <span class="break-text">{{ detailItem.fastaObjectName || '文件位置不可用' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="参考文件">
            <el-button type="primary" link :disabled="!detailItem.fastaObjectName?.trim()"
              :loading="downloadingIds.has(detailItem.referenceId)" @click="downloadReference(detailItem)">下载 FASTA</el-button>
          </el-descriptions-item>
        </el-descriptions>
        <el-empty v-else-if="!detailLoading" :description="detailError ? '暂时无法查看该记录' : '暂无详情'" />
        <p v-if="detailItem" class="detail-note">分类、节段和完整性描述是声明的元数据，不代表系统已核实其生物学准确性。下载的是保存后的 FASTA，不保留原 gzip／ZIP 包装。</p>
      </div>
    </el-drawer>

    <!-- Keep mounted so closing for a lookup does not erase an uncertain upload. -->
    <ReferenceUploadDialog v-model="uploadVisible" :target="selectedTarget" @created="handleCreated" @lookup="handleLookup" @navigation-lock="handleNavigationLock" />
  </div>
</template>

<style scoped>
.reference-library-page { max-width: 1500px; margin: 0 auto; }
.scope-notice { margin-bottom: 18px; }
.target-card { margin-bottom: 18px; }
.target-toolbar { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 12px; }
.target-selection { flex: 1; display: grid; gap: 8px; }
.target-selection label { font-size: 14px; }
.filters { display: grid; grid-template-columns: minmax(150px, 1fr) 130px minmax(190px, 1.3fr); gap: 0 14px; }
.filters .el-form-item { margin-bottom: 12px; }
.filters .el-select { width: 100%; }
.filter-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; }
.query-note { margin: 12px 0 20px; color: #7b8986; font-size: 12px; line-height: 1.6; }
.list-heading, .list-heading > div, .detail-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.list-heading { padding-top: 18px; margin-bottom: 14px; border-top: 1px solid #e7eeec; }
.list-heading strong { font-size: 15px; font-weight: 600; }
.list-heading span, .detail-toolbar span { color: #7b8986; font-size: 12px; }
.message { margin-bottom: 12px; }
.error-note { margin: 4px 0; }
.reference-table { width: 100%; min-height: 280px; }
.reference-name { display: grid; gap: 5px; padding: 4px 0; }
.reference-name .el-button { justify-content: flex-start; white-space: normal; text-align: left; line-height: 1.5; height: auto; }
.reference-name > span { color: #8a9794; font-size: 11px; overflow-wrap: anywhere; }
.pagination { display: flex; justify-content: flex-end; margin-top: 18px; overflow-x: auto; }
.access-note, .detail-note { margin: 14px 0 0; color: #7b8986; font-size: 12px; line-height: 1.7; }
.detail-body { min-height: 260px; }
.detail-toolbar { margin-bottom: 18px; }
.break-text { overflow-wrap: anywhere; }
@media (max-width: 1200px) {
  .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
