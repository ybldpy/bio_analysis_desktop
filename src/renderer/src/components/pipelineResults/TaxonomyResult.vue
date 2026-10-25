<script setup lang="ts">
import { computed } from 'vue'
import type { AnalysisPipelineStage } from '../../common/analysisPipeline'
import {
  asRecord,
  formatDate,
  formatFraction,
  formatNumber,
  formatPercent
} from '../../common/pipelineResults'
import { displayCode, displayText, finiteNumber, recordList } from './inlineResultPresentation'

const props = defineProps<{ stage: AnalysisPipelineStage }>()
const result = computed(() => asRecord(props.stage.output.inline))
const parseError = computed(() => props.stage.output.parseErrors?.inline)
const best = computed(() => asRecord(result.value?.best))
const candidates = computed(() => recordList(result.value?.candidates))
const manual = computed(() => asRecord(result.value?.manualConfirmation))
const binning = computed(() => asRecord(result.value?.binningMetrics))
const bins = computed(() => recordList(binning.value?.bins))
const originalEvidence = computed(() =>
  result.value?.evidenceResource === 'USER_CONFIRMED'
    ? manual.value?.originalEvidenceResource
    : result.value?.evidenceResource
)
const scoreLabel = computed(() => {
  if (originalEvidence.value === 'FASTANI') return 'ANI 分值'
  if (originalEvidence.value === 'KRAKEN2') {
    return binning.value ? '组装碱基加权百分比' : '报告分类百分比'
  }
  return '原始分数（单位未提供）'
})
const statusLabels = {
  0: '分类已确定',
  1: '分类存在歧义',
  2: '分类证据不足',
  3: '超出当前分类范围'
}
const groupSummary = computed(() => [
  {
    label: '已归属到物种',
    contigs: binning.value?.speciesAssignedContigs,
    bases: binning.value?.speciesAssignedBases
  },
  {
    label: '已分类但未解析到物种',
    contigs: binning.value?.unresolvedContigs,
    bases: binning.value?.unresolvedBases
  },
  {
    label: '未分类',
    contigs: binning.value?.unclassifiedContigs,
    bases: binning.value?.unclassifiedBases
  }
])
const colors = ['#409eff', '#67c23a', '#e6a23c', '#9b7ede', '#36a5a5', '#e47c86', '#8a9bae']
const composition = computed(() => {
  const entries = bins.value.map((bin, index) => ({
    key: index,
    label: `${displayText(bin.name)} · 层级 ${displayText(bin.rankCode)}`,
    fraction: finiteNumber(bin.assemblyFraction),
    color: colors[index % colors.length]
  }))
  const valid = entries.every(
    (entry) => entry.fraction !== null && entry.fraction >= 0 && entry.fraction <= 1
  )
  const sum = entries.reduce((total, entry) => total + (entry.fraction ?? 0), 0)
  return {
    entries,
    valid: entries.length > 0 && valid && sum <= 1.000001,
    remainder: Math.max(0, 1 - sum)
  }
})

function scoreText(value: unknown): string {
  return originalEvidence.value === 'KRAKEN2' ? formatPercent(value) : formatNumber(value)
}
</script>

<template>
  <div class="taxonomy-result">
    <el-alert
      v-if="parseError"
      title="物种分类结果解析失败"
      :description="parseError"
      type="error"
      :closable="false"
      show-icon
    />
    <el-empty v-else-if="!result" description="暂无物种分类结果" :image-size="64" />
    <template v-else>
      <el-card shadow="never">
        <template #header>物种分类</template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="分类结论状态">{{
            displayCode(result.status, statusLabels)
          }}</el-descriptions-item>
          <el-descriptions-item label="证据来源">{{
            displayText(result.evidenceResource)
          }}</el-descriptions-item>
          <el-descriptions-item label="已确定分类">{{
            best ? displayText(best.name) : '尚未确定'
          }}</el-descriptions-item>
          <el-descriptions-item label="TaxID">{{ displayText(best?.taxid) }}</el-descriptions-item>
          <el-descriptions-item label="分类层级">{{
            displayText(best?.rank)
          }}</el-descriptions-item>
          <el-descriptions-item :label="scoreLabel">{{
            scoreText(best?.score)
          }}</el-descriptions-item>
        </el-descriptions>
        <p class="result-note">
          分数按证据来源解释，不是统一的置信概率，不能跨来源直接比较。尚未确定分类时不会自动选用首个候选。
        </p>
        <p v-if="result.evidenceResource === 'USER_CONFIRMED'" class="result-note">
          分类已由人工确定；分数仍来自原始证据
          {{ displayText(originalEvidence) }}，不是人工确认置信度。
        </p>
        <h3>候选分类</h3>
        <el-table :data="candidates" stripe empty-text="未提供候选分类">
          <el-table-column label="候选名称" min-width="200"
            ><template #default="{ row }">{{ displayText(row.name) }}</template></el-table-column
          >
          <el-table-column label="TaxID" min-width="100"
            ><template #default="{ row }">{{ displayText(row.taxid) }}</template></el-table-column
          >
          <el-table-column label="分类层级" min-width="110"
            ><template #default="{ row }">{{ displayText(row.rank) }}</template></el-table-column
          >
          <el-table-column :label="scoreLabel" min-width="180"
            ><template #default="{ row }">{{ scoreText(row.score) }}</template></el-table-column
          >
        </el-table>
      </el-card>

      <el-card v-if="manual" shadow="never">
        <template #header>人工确认记录</template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="确认物种 TaxID">{{
            displayText(manual.speciesTaxId)
          }}</el-descriptions-item>
          <el-descriptions-item label="确认时间">{{
            formatDate(manual.confirmedAt)
          }}</el-descriptions-item>
          <el-descriptions-item label="确认人">{{
            displayText(manual.confirmedBy)
          }}</el-descriptions-item>
          <el-descriptions-item label="原始证据来源">{{
            displayText(manual.originalEvidenceResource)
          }}</el-descriptions-item>
          <el-descriptions-item label="原始分类状态">{{
            displayCode(manual.originalStatus, statusLabels)
          }}</el-descriptions-item>
          <el-descriptions-item label="确认原因">{{
            displayText(manual.reason)
          }}</el-descriptions-item>
        </el-descriptions>
        <p class="result-note">
          人工确认不会重新计算原始分箱或主分箱 FASTA；以下原始优势分箱可能与已确定分类不同。
        </p>
      </el-card>

      <el-card v-if="binning" shadow="never">
        <template #header>组装序列分箱</template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="Contig 总数">{{
            formatNumber(binning.totalContigs)
          }}</el-descriptions-item>
          <el-descriptions-item label="组装总碱基数（bp）">{{
            formatNumber(binning.totalAssemblyBases)
          }}</el-descriptions-item>
          <el-descriptions-item label="原始优势分箱">{{
            displayText(binning.dominantSpeciesName)
          }}</el-descriptions-item>
          <el-descriptions-item label="原始优势分箱 TaxID">{{
            displayText(binning.dominantSpeciesTaxId)
          }}</el-descriptions-item>
          <el-descriptions-item label="原始优势分箱占组装比例" :span="2">{{
            formatFraction(binning.dominantSpeciesAssemblyFraction)
          }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="groupSummary" stripe class="result-table">
          <el-table-column prop="label" label="归属类别" min-width="190" />
          <el-table-column label="Contig 数" min-width="110"
            ><template #default="{ row }">{{
              formatNumber(row.contigs)
            }}</template></el-table-column
          >
          <el-table-column label="碱基数（bp）" min-width="150"
            ><template #default="{ row }">{{ formatNumber(row.bases) }}</template></el-table-column
          >
        </el-table>
        <h3>按碱基长度加权的分箱组成</h3>
        <p class="result-note">
          使用报告中的占组装比例，保留所有报告层级及未分类分箱，不将物种级条目重新归一化。此图反映组装序列分类组成，不代表样本物种丰度。
        </p>
        <template v-if="composition.valid">
          <div
            class="composition-bar"
            role="img"
            aria-label="组装序列分箱组成，具体比例见下方图例与表格"
          >
            <span
              v-for="entry in composition.entries"
              :key="entry.key"
              :style="{ width: `${(entry.fraction ?? 0) * 100}%`, backgroundColor: entry.color }"
              :title="`${entry.label}：${formatFraction(entry.fraction)}`"
            />
            <span
              v-if="composition.remainder > 0.000001"
              :style="{ width: `${composition.remainder * 100}%` }"
              class="composition-remainder"
              title="报告未列出的比例部分"
            />
          </div>
          <ul class="composition-legend">
            <li v-for="entry in composition.entries" :key="entry.key">
              <span class="legend-dot" :style="{ backgroundColor: entry.color }" />{{
                entry.label
              }}：{{ formatFraction(entry.fraction) }}
            </li>
            <li v-if="composition.remainder > 0.000001">
              <span class="legend-dot composition-remainder" />报告未列出的比例部分：{{
                formatFraction(composition.remainder)
              }}（不推断类别）
            </li>
          </ul>
        </template>
        <p v-else class="result-note">
          未提供完整有效的分箱比例，暂不绘制组成条；现有计数与分箱记录仍显示如下。
        </p>
        <el-table :data="bins" stripe empty-text="未提供分箱记录" class="result-table">
          <el-table-column label="分箱名称" min-width="190"
            ><template #default="{ row }">{{ displayText(row.name) }}</template></el-table-column
          >
          <el-table-column label="TaxID" min-width="100"
            ><template #default="{ row }">{{ displayText(row.taxId) }}</template></el-table-column
          >
          <el-table-column label="层级代码" min-width="110"
            ><template #default="{ row }">{{
              displayText(row.rankCode)
            }}</template></el-table-column
          >
          <el-table-column label="Contig 数" min-width="110"
            ><template #default="{ row }">{{
              formatNumber(row.contigCount)
            }}</template></el-table-column
          >
          <el-table-column label="碱基数（bp）" min-width="140"
            ><template #default="{ row }">{{
              formatNumber(row.totalBases)
            }}</template></el-table-column
          >
          <el-table-column label="占组装比例" min-width="130"
            ><template #default="{ row }">{{
              formatFraction(row.assemblyFraction)
            }}</template></el-table-column
          >
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.taxonomy-result {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.result-table {
  width: 100%;
  margin-top: 14px;
}
.result-note {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
h3 {
  margin: 20px 0 12px;
  font-size: 15px;
  font-weight: 600;
}
.composition-bar {
  display: flex;
  height: 24px;
  margin-top: 16px;
  overflow: hidden;
  border-radius: 5px;
  background: var(--el-fill-color-light);
}
.composition-bar > span {
  flex-shrink: 0;
}
.composition-remainder {
  background: var(--el-color-info-light-7);
}
.composition-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  color: var(--el-text-color-regular);
  font-size: 12px;
}
.composition-legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend-dot {
  display: inline-block;
  flex: 0 0 10px;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
</style>
