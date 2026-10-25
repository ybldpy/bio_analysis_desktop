<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import type { AnalysisPipelineStage } from '../../common/analysisPipeline'
import type { ReferenceComparisonCandidate } from '../../common/referenceComparison'
import { downloadStageFile } from '../../api/pipelineResults'
import { useReferenceComparison } from '../../composables/useReferenceComparison'

const props = defineProps<{
  stage: AnalysisPipelineStage
  refreshVersion: number
  pipelineName: string
}>()
const { index, report, kind, loading, error, message, reload } = useReferenceComparison(
  () => props.stage,
  () => props.refreshVersion
)

type FileField = 'alignmentPafUrl' | 'differenceTsvUrl'
type MetricField = 'sequenceIdentity' | 'referenceCoverage' | 'alignedReferenceBases' |
  'referenceBases' | 'matchingBases' | 'alignmentBlockBases' | 'alignmentCount'
type CandidateRow = Partial<ReferenceComparisonCandidate> | null | undefined
const metricColumns: Array<{ field: MetricField; label: string; unit: 'percent' | 'fraction' | 'bp' | 'count' }> = [
  { field: 'sequenceIdentity', label: '序列一致性', unit: 'percent' },
  { field: 'referenceCoverage', label: '参考覆盖率', unit: 'fraction' },
  { field: 'alignedReferenceBases', label: '已对齐参考位置（bp）', unit: 'bp' },
  { field: 'referenceBases', label: '参考总长度（bp）', unit: 'bp' },
  { field: 'matchingBases', label: '累计匹配碱基（bp）', unit: 'bp' },
  { field: 'alignmentBlockBases', label: '累计比对块长度（bp）', unit: 'bp' },
  { field: 'alignmentCount', label: '比对记录数', unit: 'count' }
]
const downloadFields: Array<{ field: FileField; label: string }> = [
  { field: 'alignmentPafUrl', label: 'PAF' },
  { field: 'differenceTsvUrl', label: '差异 TSV' }
]
const summary = computed(() => kind.value === 'v2' && props.stage.status === 4 ? index.value : null)
const allUnmatched = computed(() => report.value !== null && report.value.candidateCount > 0 && report.value.matchedCandidateCount === 0)
const downloading = reactive(new Set<string>())
const downloadErrors = reactive(new Map<string, string>())
const downloadNotices = reactive(new Map<string, string>())
const controllers = new Map<string, AbortController>()

function displayText(value: unknown): string {
  return value == null || value === '' ? '—' : String(value)
}

function displayMetric(row: CandidateRow, field: MetricField, unit: string): string {
  const value = row?.[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (unit === 'percent') return `${value}%`
  if (unit === 'fraction') return `${(value * 100).toLocaleString('zh-CN', { useGrouping: false, maximumFractionDigits: 10 })}%`
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

function fileKey(row: CandidateRow, field: FileField): string {
  const value = row?.[field]
  return typeof value === 'string' && value.trim() ? value : ''
}

function abortDownloads(): void {
  controllers.forEach(controller => controller.abort())
  controllers.clear()
  downloading.clear()
  downloadErrors.clear()
  downloadNotices.clear()
}
watch(() => [props.stage.stageId, props.refreshVersion], abortDownloads)
onBeforeUnmount(abortDownloads)

function safeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'result'
}

async function download(row: CandidateRow, field: FileField, ordinal: number): Promise<void> {
  const key = fileKey(row, field)
  if (!key || downloading.has(key)) return
  const controller = new AbortController()
  controllers.set(key, controller)
  downloading.add(key)
  downloadErrors.delete(key)
  downloadNotices.delete(key)
  const basename = safeFilename(key.split('/').pop() || (field === 'alignmentPafUrl' ? 'alignment.paf' : 'differences.tsv'))
  const filename = `${safeFilename(props.pipelineName)}_stage${props.stage.stageId}_candidate${String(ordinal).padStart(4, '0')}_${basename}`
  try {
    await downloadStageFile(key, filename, controller.signal)
    if (!controller.signal.aborted) downloadNotices.set(key, '文件已获取，请在保存窗口中完成保存')
  } catch (cause) {
    if (!controller.signal.aborted) downloadErrors.set(key, cause instanceof Error ? cause.message : '文件获取失败，请重试')
  } finally {
    if (controllers.get(key) === controller) {
      controllers.delete(key)
      downloading.delete(key)
    }
  }
}

function cancelDownload(key: string): void {
  const controller = controllers.get(key)
  controller?.abort()
  controllers.delete(key)
  downloading.delete(key)
  downloadNotices.set(key, '已取消获取文件，可重新下载')
}
</script>

<template>
  <section class="reference-comparison" aria-label="全部候选参考比较" :aria-busy="loading">
    <template v-if="summary">
      <p class="summary-heading">阶段结果摘要</p>
      <dl class="comparison-summary">
        <div><dt>候选总数</dt><dd data-testid="candidate-count">{{ summary.candidateCount }}</dd></div>
        <div><dt>匹配候选数</dt><dd data-testid="matched-count">{{ summary.matchedCandidateCount }}</dd></div>
        <div><dt>未匹配候选数</dt><dd data-testid="unmatched-count">{{ summary.unmatchedCandidateCount }}</dd></div>
      </dl>
    </template>
    <div v-if="loading" class="comparison-loading" role="status" data-testid="comparison-loading">
      正在读取全部候选比较报告……
    </div>
    <div v-else-if="error || kind === 'invalid'" data-testid="comparison-error">
      <el-alert type="error" :title="error || '比较报告格式不正确'" :closable="false" show-icon
        description="报告读取失败不代表没有匹配。可重新读取，或通过下方结果文件获取原报告。" />
      <el-button type="primary" plain class="retry" data-testid="retry-report" @click="reload()">重新读取比较报告</el-button>
    </div>
    <el-alert v-else-if="kind === 'legacy'" data-testid="comparison-legacy" type="info" :closable="false"
      title="历史结果未提供比较指标" description="可在下方下载原始 PAF / 差异 TSV 文件；不补充候选数量或推断缺失指标。" />
    <template v-else-if="report">
      <el-alert v-if="allUnmatched" data-testid="all-unmatched" type="info" :closable="false" show-icon
        title="比较完成，未获得匹配" description="全部候选均无可用对齐；这不是执行失败，也不表示样本质量合格。" />
      <p class="comparison-note">
        按候选快照顺序展示全部参考，并非质量排名；匹配仅表示有可用对齐。相同 accession 或节段的记录分别保留。
        展开左侧箭头可查看参考元信息，横向滚动可查看全部指标。
      </p>
      <div class="comparison-table-container">
        <el-table :data="report.comparisons" row-key="alignmentPafUrl" stripe class="comparison-table" data-testid="comparison-table">
          <el-table-column type="expand" width="44">
            <template #default="{ row }">
              <el-descriptions :column="2" border class="candidate-metadata">
                <el-descriptions-item label="参考记录 ID">{{ displayText(row?.referenceId) }}</el-descriptions-item>
                <el-descriptions-item label="参考 Accession">{{ displayText(row?.referenceAccession) }}</el-descriptions-item>
                <el-descriptions-item label="来源数据库">{{ displayText(row?.sourceDb) }}</el-descriptions-item>
                <el-descriptions-item label="实际 Tax ID">{{ displayText(row?.taxId) }}</el-descriptions-item>
                <el-descriptions-item label="参考名称" :span="2">{{ displayText(row?.organismName) }}</el-descriptions-item>
                <el-descriptions-item label="原始节段">{{ displayText(row?.segment) }}</el-descriptions-item>
                <el-descriptions-item label="节段分组键">{{ displayText(row?.segmentKey) }}</el-descriptions-item>
              </el-descriptions>
            </template>
          </el-table-column>
          <el-table-column label="序号" width="65">
            <template #default="{ $index }">{{ Number.isInteger($index) ? $index + 1 : '—' }}</template>
          </el-table-column>
          <el-table-column label="参考 Accession" min-width="190" show-overflow-tooltip>
            <template #default="{ row }">{{ displayText(row?.referenceAccession) }}</template>
          </el-table-column>
          <el-table-column label="匹配状态" min-width="185">
            <template #default="{ row }">
              <el-tag v-if="row?.status === 'MATCHED'" type="primary">有匹配 MATCHED</el-tag>
              <el-tag v-else-if="row?.status === 'NO_MATCH'" type="info">未匹配 NO_MATCH</el-tag>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column v-for="metric in metricColumns" :key="metric.field" :label="metric.label" :min-width="metric.unit === 'bp' ? 170 : 135" align="right">
            <template #default="{ row }">
              <span :data-metric="metric.field">{{ displayMetric(row, metric.field, metric.unit) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="逐候选报告" min-width="230">
            <template #default="{ row, $index }">
              <div v-for="file in downloadFields" :key="file.field" class="candidate-download">
                <el-button type="primary" link :disabled="!fileKey(row, file.field)"
                  :loading="downloading.has(fileKey(row, file.field))"
                  :data-testid="`download-${$index + 1}-${file.field}`"
                  :aria-label="`候选 ${$index + 1} ${file.label} ${downloadErrors.has(fileKey(row, file.field)) ? '重试下载' : '下载'}`"
                  @click="download(row, file.field, $index + 1)">
                  {{ downloadErrors.has(fileKey(row, file.field)) ? '重试下载' : '下载' }} {{ file.label }}
                </el-button>
                <el-button v-if="downloading.has(fileKey(row, file.field))" link
                  :data-testid="`cancel-${$index + 1}-${file.field}`" @click="cancelDownload(fileKey(row, file.field))">取消</el-button>
                <p v-if="downloadErrors.has(fileKey(row, file.field))" class="download-error" role="alert">{{ downloadErrors.get(fileKey(row, file.field)) }}</p>
                <p v-if="downloadNotices.has(fileKey(row, file.field))" class="download-notice" role="status">{{ downloadNotices.get(fileKey(row, file.field)) }}</p>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <p class="comparison-note">
        已对齐参考位置按重叠区间并集统计；匹配碱基和比对块长度为比对记录累计值。
        比对记录数不是变异数、reads 数或节段数。未匹配候选的 PAF 可以为空文件，差异 TSV 可以仅包含表头。
      </p>
    </template>
    <el-empty v-else data-testid="comparison-empty" :description="message || '当前阶段暂无可读取的比较结果'" :image-size="70" />
  </section>
</template>

<style scoped>
.reference-comparison { min-width: 0; max-width: 100%; }
.comparison-loading { min-height: 180px; display: grid; place-items: center; color: #71847d; }
.summary-heading { margin: 0 0 10px; font-size: 13px; color: #71847d; }
.comparison-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0 0 18px; }
.comparison-summary > div { padding: 16px; background: #f6f9f8; border: 1px solid #e1e9e5; border-radius: 8px; }
.comparison-summary dt { font-size: 13px; color: #71847d; }
.comparison-summary dd { margin: 8px 0 0; color: #263d37; font-size: 23px; font-weight: 600; overflow-wrap: anywhere; }
.comparison-note { font-size: 12px; color: #71847d; line-height: 1.8; margin: 14px 0; }
.comparison-table-container { width: 100%; min-width: 0; max-width: 100%; overflow-x: auto; }
.comparison-table { width: 100%; max-width: 100%; }
.candidate-metadata { margin: 12px 20px; overflow-wrap: anywhere; }
.candidate-download { margin: 4px 0; }
.download-error, .download-notice { margin: 4px 0; font-size: 12px; overflow-wrap: anywhere; }
.download-error { color: #c45656; }
.download-notice { color: #71847d; }
.retry { margin-top: 12px; }
@media (max-width: 580px) {
  .comparison-summary { gap: 6px; }
  .comparison-summary > div { padding: 12px 8px; }
  .comparison-summary dd { font-size: 20px; }
}
</style>
