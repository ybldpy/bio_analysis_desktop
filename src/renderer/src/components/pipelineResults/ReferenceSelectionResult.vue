<script setup lang="ts">
import { computed } from 'vue'
import type { AnalysisPipelineStage } from '../../common/analysisPipeline'
import {
  asRecord,
  formatFraction,
  formatNumber,
  formatPercent,
  getReferenceSelection
} from '../../common/pipelineResults'
import {
  configurationText,
  displayCode,
  displayText,
  finiteNumber,
  hasText,
  recordList,
  sortBySegment
} from './inlineResultPresentation'

const props = defineProps<{ stage: AnalysisPipelineStage }>()
const result = computed(() => getReferenceSelection(props.stage))
const parseError = computed(
  () =>
    props.stage.output.parseErrors?.inline ??
    (!props.stage.output.inline ? props.stage.output.parseErrors?.urls : undefined)
)
const selected = computed(() => asRecord(result.value?.selectedReference))
const sequences = computed(() => sortBySegment(recordList(selected.value?.sequences)))
const selectedAccessions = computed(
  () => new Set(sequences.value.map((row) => row.accession).filter(hasText))
)
const candidates = computed(() => {
  const ordinals = new Map<string, number>()
  for (const sequence of sequences.value) {
    const ordinal = finiteNumber(sequence.segmentOrdinal)
    if (hasText(sequence.segmentKey) && ordinal !== null) ordinals.set(sequence.segmentKey, ordinal)
  }
  return sortBySegment(recordList(result.value?.candidateScores), ordinals)
})
const unmatched = computed(() =>
  Array.isArray(result.value?.unmatchedSegmentKeys)
    ? result.value.unmatchedSegmentKeys.filter(hasText)
    : []
)
const fallback = computed(() => asRecord(result.value?.readFallbackMetrics))
const fallbackConfiguration = computed(() =>
  Object.entries(fallback.value ?? {}).filter(([key]) => key !== 'status')
)
const partialLabel = computed(() => {
  if (result.value?.partial === true) return '本次候选范围内存在未匹配节段'
  if (result.value?.partial === false) return '本次候选分组中没有未匹配项'
  return '未提供'
})

function annotationLabel(value: unknown): string {
  return value === true ? '是' : value === false ? '否' : '未提供'
}
</script>

<template>
  <div class="reference-result">
    <el-alert
      v-if="parseError"
      title="参考选择结果解析失败"
      :description="parseError"
      type="error"
      :closable="false"
      show-icon
    />
    <el-empty v-else-if="!result" description="暂无参考选择结果" :image-size="64" />
    <template v-else>
      <el-card shadow="never">
        <template #header>选中参考集合</template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="参考名称">{{
            displayText(selected?.organismName)
          }}</el-descriptions-item>
          <el-descriptions-item label="TaxID">{{
            displayText(selected?.taxId)
          }}</el-descriptions-item>
          <el-descriptions-item label="候选匹配情况" :span="2">{{
            partialLabel
          }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="unmatched.length" class="unmatched">
          <span>未匹配节段：</span>
          <el-tag
            v-for="(segment, index) in unmatched"
            :key="`${segment}-${index}`"
            type="warning"
            >{{ segment }}</el-tag
          >
        </div>
        <p class="result-note">
          参考名称仅表示所用比对参考，不等同于样本菌株或分离株鉴定。候选匹配情况不代表全基因组完整性，也不据此判断缺节段或混样。
        </p>
        <el-table :data="sequences" stripe empty-text="未提供选中参考序列" class="result-table">
          <el-table-column label="Accession" min-width="150"
            ><template #default="{ row }">{{
              displayText(row.accession)
            }}</template></el-table-column
          >
          <el-table-column label="节段" min-width="110"
            ><template #default="{ row }">{{ displayText(row.segment) }}</template></el-table-column
          >
          <el-table-column label="节段键" min-width="120"
            ><template #default="{ row }">{{
              displayText(row.segmentKey)
            }}</template></el-table-column
          >
          <el-table-column label="节段顺序" min-width="100"
            ><template #default="{ row }">{{
              formatNumber(row.segmentOrdinal)
            }}</template></el-table-column
          >
          <el-table-column label="来源数据库" min-width="120"
            ><template #default="{ row }">{{
              displayText(row.sourceDb)
            }}</template></el-table-column
          >
          <el-table-column label="参考长度（bp）" min-width="140"
            ><template #default="{ row }">{{
              formatNumber(row.genomeLength)
            }}</template></el-table-column
          >
          <el-table-column label="参考记录完整性" min-width="150"
            ><template #default="{ row }">{{
              displayText(row.completeness)
            }}</template></el-table-column
          >
          <el-table-column label="注释标记" min-width="100"
            ><template #default="{ row }">{{
              annotationLabel(row.isAnnotated)
            }}</template></el-table-column
          >
        </el-table>
      </el-card>

      <el-card shadow="never">
        <template #header>候选参考比较</template>
        <p class="result-note">
          排序分数不是统计置信概率。选中标记按参考 Accession 关联；一致性已是百分数，参考覆盖率由
          0–1 比例换算。
        </p>
        <el-table :data="candidates" stripe empty-text="未提供候选参考" class="result-table">
          <el-table-column type="expand">
            <template #default="{ row }">
              <el-descriptions :column="2" border class="expanded-details">
                <el-descriptions-item label="已对齐参考位置（bp）">{{
                  formatNumber(row.alignedReferenceBases)
                }}</el-descriptions-item>
                <el-descriptions-item label="参考长度（bp）">{{
                  formatNumber(row.referenceBases)
                }}</el-descriptions-item>
                <el-descriptions-item label="匹配碱基（bp）">{{
                  formatNumber(row.matchingBases)
                }}</el-descriptions-item>
                <el-descriptions-item label="比对块长度（bp）">{{
                  formatNumber(row.alignmentBlockBases)
                }}</el-descriptions-item>
                <el-descriptions-item label="比对记录数">{{
                  formatNumber(row.alignmentCount)
                }}</el-descriptions-item>
                <el-descriptions-item label="未接受原因">{{
                  displayText(row.rejectionReason)
                }}</el-descriptions-item>
              </el-descriptions>
            </template>
          </el-table-column>
          <el-table-column label="参考 Accession" min-width="160"
            ><template #default="{ row }">{{
              displayText(row.referenceAccession)
            }}</template></el-table-column
          >
          <el-table-column label="选择情况" min-width="110"
            ><template #default="{ row }"
              ><el-tag
                v-if="selectedAccessions.has(row.referenceAccession)"
                type="success"
                size="small"
                >已选中</el-tag
              ><span v-else>未选中</span></template
            ></el-table-column
          >
          <el-table-column label="节段键" min-width="120"
            ><template #default="{ row }">{{
              displayText(row.segmentKey)
            }}</template></el-table-column
          >
          <el-table-column label="证据来源" min-width="120"
            ><template #default="{ row }">{{
              displayText(row.evidenceSource)
            }}</template></el-table-column
          >
          <el-table-column label="序列一致性" min-width="120"
            ><template #default="{ row }">{{
              formatPercent(row.sequenceIdentity)
            }}</template></el-table-column
          >
          <el-table-column label="参考覆盖率" min-width="120"
            ><template #default="{ row }">{{
              formatFraction(row.referenceCoverage)
            }}</template></el-table-column
          >
          <el-table-column label="排序分数" min-width="110"
            ><template #default="{ row }">{{ formatNumber(row.score) }}</template></el-table-column
          >
          <el-table-column label="未接受原因" min-width="160"
            ><template #default="{ row }">{{
              displayText(row.rejectionReason)
            }}</template></el-table-column
          >
        </el-table>
      </el-card>

      <el-card v-if="fallback" shadow="never">
        <template #header>Reads 补充检查</template>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="补充检查状态">{{
            displayCode(fallback.status, {
              NO_READS: '没有 Reads',
              DISABLED: '未启用',
              NOT_NEEDED: '无需补充检查',
              COMPLETED: '已完成',
              UNSUPPORTED_READ_TYPE: '不支持此读长类型'
            })
          }}</el-descriptions-item>
        </el-descriptions>
        <p class="result-note">此状态仅描述补充检查，不代表阶段执行失败。</p>
        <el-collapse v-if="fallbackConfiguration.length" class="fallback-details">
          <el-collapse-item title="查看报告记录的补充检查详情" name="configuration">
            <el-descriptions :column="1" border>
              <el-descriptions-item
                v-for="[key, value] in fallbackConfiguration"
                :key="key"
                :label="key"
              >
                <pre class="raw-value">{{ configurationText(value) }}</pre>
              </el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>
        </el-collapse>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.reference-result {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.result-table {
  width: 100%;
  margin-top: 12px;
}
.result-note {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.unmatched {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.expanded-details {
  margin: 12px 24px;
}
.fallback-details {
  margin-top: 12px;
}
.raw-value {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
</style>
