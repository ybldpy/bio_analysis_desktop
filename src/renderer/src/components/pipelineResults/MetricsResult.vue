<script setup lang="ts">
import { computed } from 'vue'
import { asRecord, formatDepth, formatFraction, formatNumber } from '../../common/pipelineResults'
import {
  metricBarWidth,
  metricDistribution,
  metricFraction,
  metricLabel,
  metricMaskDistribution,
  metricMaximum,
  metricNumber,
  metricRatio,
  metricRecords,
  type MetricRecord
} from './metricsDisplay'

const props = defineProps<{ stageType: number; metrics: Record<string, any> }>()

type MetricUnit = 'fraction' | 'depth' | 'bp' | 'records' | 'segments' | 'number'
interface MetricField {
  key: string
  label: string
  unit: MetricUnit
}

const mappingFields: MetricField[] = [
  { key: 'mappingFraction', label: '比对率', unit: 'fraction' },
  { key: 'coverageFractionAt1x', label: '至少 1× 覆盖率', unit: 'fraction' },
  { key: 'meanDepth', label: '平均深度', unit: 'depth' },
  { key: 'maxDepth', label: '最高深度', unit: 'depth' },
  { key: 'totalReferenceBases', label: '参考总长度', unit: 'bp' },
  { key: 'coveredBases', label: '有覆盖位置数', unit: 'bp' },
  { key: 'zeroDepthBases', label: '零深度位置数', unit: 'bp' },
  { key: 'mappedReadSegments', label: '已比对 read segments', unit: 'segments' },
  { key: 'unmappedReadSegments', label: '未比对 read segments', unit: 'segments' },
  { key: 'totalReadSegments', label: '总 read segments', unit: 'segments' }
]
const variantFields: MetricField[] = [
  { key: 'variantRecords', label: '变异记录总数', unit: 'records' },
  { key: 'snpCount', label: 'SNP 记录数', unit: 'records' },
  { key: 'indelCount', label: 'INDEL 记录数', unit: 'records' },
  { key: 'otherCount', label: '其他变异记录数', unit: 'records' },
  { key: 'totalVcfRecords', label: '全部 VCF 数据记录数', unit: 'records' }
]
const maskFields: MetricField[] = [
  { key: 'minimumDepth', label: '深度遮罩阈值', unit: 'depth' },
  { key: 'totalBases', label: '参考坐标总位置数', unit: 'bp' },
  { key: 'unmaskedBases', label: '未遮罩位置数', unit: 'bp' },
  { key: 'maskedBases', label: '低深度遮罩位置数', unit: 'bp' },
  { key: 'unmaskedFraction', label: '未遮罩比例', unit: 'fraction' },
  { key: 'maskedFraction', label: '低深度遮罩比例', unit: 'fraction' }
]
const filterFields: MetricField[] = [
  { key: 'explicitPassCount', label: '明确 PASS', unit: 'records' },
  { key: 'filteredCount', label: '未通过过滤（已标记）', unit: 'records' },
  { key: 'unfilteredCount', label: '未明确过滤状态（FILTER 为 .）', unit: 'records' }
]

const data = computed<MetricRecord>(() => asRecord(props.metrics) ?? {})
const supported = computed(() => [20, 40, 41].includes(props.stageType))
const fields = computed(() => {
  if (props.stageType === 20) return mappingFields
  if (props.stageType === 40) return variantFields
  return maskFields
})
const rowsValue = computed(() =>
  props.stageType === 41 ? data.value.sequences : data.value.references
)
const rows = computed(() => metricRecords(rowsValue.value))
const invalidRowCount = computed(() =>
  Array.isArray(rowsValue.value) ? rowsValue.value.length - rows.value.length : 0
)
const rowNameKey = computed(() => (props.stageType === 41 ? 'sequenceName' : 'referenceName'))
const tableFields = computed<MetricField[]>(() => {
  if (props.stageType === 20) {
    return [
      { key: 'referenceLength', label: '参考长度', unit: 'bp' },
      ...mappingFields.filter(
        ({ key }) => !['mappingFraction', 'totalReferenceBases', 'totalReadSegments'].includes(key)
      ),
      { key: 'depthSum', label: '深度总和（depthSum）', unit: 'number' }
    ]
  }
  if (props.stageType === 40) {
    return [
      { key: 'referenceLength', label: '参考长度', unit: 'bp' },
      ...variantFields,
      ...filterFields
    ]
  }
  return maskFields.filter(({ key }) => key !== 'minimumDepth')
})
const tableEmptyText = computed(() => {
  if (rowsValue.value === null || rowsValue.value === undefined) return '未提供分参考统计'
  if (!Array.isArray(rowsValue.value)) return '分参考统计格式无法识别'
  return invalidRowCount.value ? '没有可读取的分参考统计' : '报告未列出分参考统计'
})

function display(value: unknown, unit: MetricUnit): string {
  const number = unit === 'fraction' ? metricFraction(value) : metricNumber(value)
  if (number === null) return '未提供'
  if (unit === 'fraction') return formatFraction(number)
  if (unit === 'depth') return formatDepth(number)
  const suffix = { bp: ' bp', records: ' 条记录', segments: '', number: '' }[unit]
  return `${formatNumber(number)}${suffix}`
}

const mappingCharts = computed(() => [
  {
    key: 'coverageFractionAt1x',
    title: '分参考至少 1× 覆盖率',
    unit: 'fraction' as const,
    scale: 1
  },
  {
    key: 'meanDepth',
    title: '分参考平均深度',
    unit: 'depth' as const,
    scale: metricMaximum(rows.value.map((row) => row.meanDepth))
  }
])
const variantDistributions = computed(() => [
  {
    title: '变异类型分布',
    ...metricDistribution(data.value, 'variantRecords', [
      { key: 'snpCount', label: 'SNP', color: '#4b8bbe' },
      { key: 'indelCount', label: 'INDEL', color: '#9482bf' },
      { key: 'otherCount', label: '其他变异', color: '#8594a8' }
    ])
  },
  {
    title: '过滤状态分布',
    ...metricDistribution(data.value, 'variantRecords', [
      { key: 'explicitPassCount', label: '明确 PASS', color: '#4b8bbe' },
      { key: 'filteredCount', label: '未通过过滤（已标记）', color: '#d6a04a' },
      { key: 'unfilteredCount', label: '未明确过滤状态（FILTER 为 .）', color: '#8594a8' }
    ])
  }
])
const maskDistribution = computed(() => metricMaskDistribution(data.value))

function distributionMessage(state: string, isMask = false): string {
  if (state === 'empty')
    return isMask ? '报告中的参考坐标总位置数为 0。' : '报告中的变异记录总数为 0。'
  if (state === 'missing') return '未提供完整的统计字段，暂不绘制组成比例。'
  return '统计字段未形成完整组成，暂不绘制比例；下方保留报告提供的数值。'
}
</script>

<template>
  <section class="metrics-result" aria-label="阶段指标">
    <el-empty v-if="!supported" description="此阶段尚未适配指标展示" :image-size="72" />
    <template v-else>
      <dl class="metrics-summary">
        <div v-for="field in fields" :key="field.key" class="metric-card">
          <dt>{{ field.label }}</dt>
          <dd>{{ display(data[field.key], field.unit) }}</dd>
        </div>
      </dl>

      <template v-if="stageType === 20">
        <p class="metrics-note">
          总体指标取自报告顶层。平均深度包含零深度位置；read segments
          按读段计数，双端的两端分别计数。
        </p>
        <div v-if="rows.length" class="metrics-charts">
          <section v-for="chart in mappingCharts" :key="chart.key" class="metric-chart">
            <h4>{{ chart.title }}</h4>
            <p class="metrics-note">
              {{
                chart.unit === 'fraction'
                  ? '固定比例尺：0–100%'
                  : chart.scale === null
                    ? '未提供有效的深度比例尺'
                    : `深度比例尺：0–${display(chart.scale, 'depth')}`
              }}
            </p>
            <div class="reference-bars">
              <div v-for="(row, index) in rows" :key="index" class="reference-bar-row">
                <div class="reference-bar-label">
                  <span class="reference-name">{{ metricLabel(row.referenceName) }}</span>
                  <span>{{ display(row[chart.key], chart.unit) }}</span>
                </div>
                <div
                  v-if="metricRatio(row[chart.key], chart.scale) !== null"
                  class="metric-track"
                  aria-hidden="true"
                >
                  <span
                    class="metric-bar"
                    :style="{ width: metricBarWidth(metricRatio(row[chart.key], chart.scale)) }"
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </template>

      <template v-else-if="stageType === 40">
        <p class="metrics-note">
          按处理后 VCF 的记录统计，不是替代等位基因数量。全部 VCF 数据记录可能包含非变异参考记录。
          过滤标记不表示记录已删除；FILTER 为 . 不等同于 PASS。
        </p>
        <div class="metrics-charts">
          <section
            v-for="distribution in variantDistributions"
            :key="distribution.title"
            class="metric-chart"
          >
            <h4>{{ distribution.title }}</h4>
            <p class="metrics-note">分母：变异记录总数；与另一分布分别统计。</p>
            <div v-if="distribution.state === 'ready'" class="metric-stack" aria-hidden="true">
              <span
                v-for="part in distribution.parts"
                :key="part.key"
                :style="{ width: metricBarWidth(part.fraction), backgroundColor: part.color }"
              />
            </div>
            <p v-else class="chart-empty">{{ distributionMessage(distribution.state) }}</p>
            <ul class="metric-legend">
              <li v-for="part in distribution.parts" :key="part.key">
                <span class="legend-title"
                  ><i :style="{ backgroundColor: part.color }" />{{ part.label }}</span
                >
                <span
                  >{{ display(part.value, 'records') }} ·
                  {{ display(part.fraction, 'fraction') }}</span
                >
              </li>
            </ul>
          </section>
        </div>
      </template>

      <template v-else-if="stageType === 41">
        <el-alert
          title="遮罩统计基于参考坐标与深度，不代表最终 FASTA 的实际长度、N 数或基因组完整率。"
          type="info"
          :closable="false"
          show-icon
        />
        <section class="metric-chart">
          <h4>参考坐标的深度遮罩组成</h4>
          <div v-if="maskDistribution.state === 'ready'" class="metric-stack" aria-hidden="true">
            <span
              v-for="part in maskDistribution.parts"
              :key="part.key"
              :style="{ width: metricBarWidth(part.fraction), backgroundColor: part.color }"
            />
          </div>
          <p v-else class="chart-empty">{{ distributionMessage(maskDistribution.state, true) }}</p>
          <ul class="metric-legend">
            <li v-for="part in maskDistribution.parts" :key="part.key">
              <span class="legend-title"
                ><i :style="{ backgroundColor: part.color }" />{{ part.label }}</span
              >
              <span
                >{{ display(part.value, 'bp') }} · {{ display(part.fraction, 'fraction') }}</span
              >
            </li>
          </ul>
        </section>
      </template>

      <section class="metrics-table">
        <h4>{{ stageType === 41 ? '分参考遮罩统计' : '分参考统计' }}</h4>
        <p v-if="stageType !== 41" class="metrics-note">
          参考标识按报告原值显示，未自动关联 accession 或节段名称。
        </p>
        <p v-if="invalidRowCount" class="metrics-note">
          列表中有 {{ invalidRowCount }} 个无法识别的条目，以下仅显示可读取的统计。
        </p>
        <el-table :data="rows" :empty-text="tableEmptyText" border stripe max-height="480">
          <el-table-column label="参考序列标识" min-width="180" fixed>
            <template #default="{ row }">{{ metricLabel(row[rowNameKey]) }}</template>
          </el-table-column>
          <el-table-column
            v-for="field in tableFields"
            :key="field.key"
            :label="field.label"
            :min-width="field.label.length > 12 ? 205 : 155"
            align="right"
          >
            <template #default="{ row }">{{ display(row[field.key], field.unit) }}</template>
          </el-table-column>
        </el-table>
      </section>
    </template>
  </section>
</template>

<style scoped>
.metrics-result {
  display: grid;
  gap: 18px;
  min-width: 0;
}
.metrics-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 0;
}
.metric-card {
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-fill-color-extra-light);
}
.metric-card dt {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.metric-card dd {
  margin: 8px 0 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.metrics-note {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.metrics-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.metric-chart {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}
h4 {
  margin: 0 0 12px;
  color: var(--el-text-color-primary);
  font-size: 14px;
}
.reference-bars {
  display: grid;
  gap: 16px;
  max-height: 360px;
  margin-top: 14px;
  overflow: auto;
}
.reference-bar-label,
.metric-legend li {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.6;
}
.reference-name {
  overflow-wrap: anywhere;
}
.metric-track {
  height: 8px;
  margin-top: 6px;
  background: var(--el-fill-color);
  border-radius: 3px;
  overflow: hidden;
}
.metric-bar {
  display: block;
  height: 100%;
  background: #4b8bbe;
}
.metric-stack {
  display: flex;
  height: 24px;
  margin: 16px 0;
  border-radius: 4px;
  overflow: hidden;
  background: var(--el-fill-color);
}
.metric-stack span {
  flex-shrink: 0;
}
.metric-legend {
  display: grid;
  gap: 12px;
  padding: 0;
  margin: 16px 0 0;
  list-style: none;
}
.legend-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.legend-title i {
  flex: 0 0 10px;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.chart-empty {
  margin: 16px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.metrics-table {
  min-width: 0;
}
.metrics-table .metrics-note {
  margin-bottom: 12px;
}
@media (max-width: 1000px) {
  .metrics-charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
