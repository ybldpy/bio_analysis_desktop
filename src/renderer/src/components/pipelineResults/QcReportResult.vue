<script setup lang="ts">
import { computed } from 'vue'
import { formatFraction, formatNumber } from '../../common/pipelineResults'
import { qcReportBarWidth, type QcReport } from './qcReport'

const props = defineProps<{ report: QcReport }>()
const data = computed(() => (props.report.kind === 'qc' ? props.report : null))
const charts = computed(() => {
  if (!data.value) return []
  return [
    {
      key: 'reads',
      title: '过滤前后 reads 数',
      unit: '条 reads',
      before: data.value.before.totalReads,
      after: data.value.after.totalReads
    },
    {
      key: 'bases',
      title: '过滤前后碱基数',
      unit: 'bp',
      before: data.value.before.totalBases,
      after: data.value.after.totalBases
    }
  ].map((chart) => ({ ...chart, maximum: Math.max(chart.before ?? 0, chart.after ?? 0) }))
})
const qualityRows = computed(() => {
  if (!data.value) return []
  return [
    {
      label: 'Q20 碱基比例',
      before: data.value.before.q20Fraction,
      after: data.value.after.q20Fraction,
      unit: 'fraction'
    },
    {
      label: 'Q30 碱基比例',
      before: data.value.before.q30Fraction,
      after: data.value.after.q30Fraction,
      unit: 'fraction'
    },
    {
      label: 'GC 比例',
      before: data.value.before.gcFraction,
      after: data.value.after.gcFraction,
      unit: 'fraction'
    },
    {
      label: 'Q20 碱基数',
      before: data.value.before.q20Bases,
      after: data.value.after.q20Bases,
      unit: 'bp'
    },
    {
      label: 'Q30 碱基数',
      before: data.value.before.q30Bases,
      after: data.value.after.q30Bases,
      unit: 'bp'
    },
    ...data.value.lengths.map((length) => ({ ...length, unit: 'bp' }))
  ]
})
const filteringMaximum = computed(
  () => data.value?.filtering.reduce((maximum, row) => Math.max(maximum, row.reads ?? 0), 0) ?? 0
)

function display(value: number | null, unit = ''): string {
  if (value === null) return '未提供'
  if (unit === 'fraction') return formatFraction(value)
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
}

function retentionText(fraction: number | null, before: number | null): string {
  return before === 0 ? '不适用（过滤前为 0）' : display(fraction, 'fraction')
}
</script>

<template>
  <section class="qc-report" aria-label="QC 报告统计">
    <el-alert
      v-if="report.kind === 'unsupported'"
      title="暂未支持的 QC 报告格式"
      :description="report.reason"
      type="info"
      :closable="false"
      show-icon
    />
    <template v-else-if="data">
      <header class="qc-heading">
        <h3>过滤前后质量统计</h3>
        <el-tag type="info"
          >{{ data.tool }} {{ data.version }} ·
          {{ data.tool === 'fastplong' ? '长读报告' : '短读报告' }}</el-tag
        >
      </header>
      <el-alert
        v-for="warning in data.warnings"
        :key="warning"
        :title="warning"
        type="warning"
        :closable="false"
        show-icon
      />
      <dl class="qc-cards">
        <div>
          <dt>过滤前 reads 数</dt>
          <dd>{{ display(data.before.totalReads) }}</dd>
        </div>
        <div>
          <dt>过滤后 reads 数</dt>
          <dd>{{ display(data.after.totalReads) }}</dd>
        </div>
        <div>
          <dt>Reads 保留比例</dt>
          <dd>{{ retentionText(data.readRetentionFraction, data.before.totalReads) }}</dd>
        </div>
        <div>
          <dt>碱基保留比例</dt>
          <dd>{{ retentionText(data.baseRetentionFraction, data.before.totalBases) }}</dd>
        </div>
      </dl>
      <p class="qc-note">
        保留比例由报告的过滤后数量 / 过滤前数量计算。reads 数按报告原值展示，不换算为 read
        pairs；缺字段不补零。
      </p>
      <div class="qc-charts">
        <section v-for="chart in charts" :key="chart.key" class="qc-panel">
          <h4>{{ chart.title }}</h4>
          <p class="qc-note">单位：{{ chart.unit }}；条长使用本图统一数量比例尺。</p>
          <div
            v-for="row in [
              { label: '过滤前', value: chart.before },
              { label: '过滤后', value: chart.after }
            ]"
            :key="row.label"
            class="qc-bar-row"
          >
            <div class="qc-bar-label">
              <span>{{ row.label }}</span
              ><span>{{ display(row.value, chart.unit) }}</span>
            </div>
            <div v-if="row.value !== null" class="qc-bar-track" aria-hidden="true">
              <span :style="{ width: qcReportBarWidth(row.value, chart.maximum) }" />
            </div>
          </div>
        </section>
      </div>
      <section class="qc-panel">
        <h4>质量与平均长度</h4>
        <table class="qc-table">
          <caption class="qc-sr-only">
            QC 过滤前后质量和读长统计
          </caption>
          <thead>
            <tr>
              <th scope="col">指标</th>
              <th scope="col">过滤前</th>
              <th scope="col">过滤后</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in qualityRows" :key="row.label">
              <th scope="row">{{ row.label }}</th>
              <td>{{ display(row.before, row.unit) }}</td>
              <td>{{ display(row.after, row.unit) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="qc-panel">
        <h4>报告中的过滤分类计数</h4>
        <p class="qc-note">单位：条 reads。各类别按报告原值分别显示，不推断未提供的过滤原因。</p>
        <el-empty
          v-if="!data.filtering.length"
          description="未提供已适配的过滤分类统计"
          :image-size="64"
        />
        <div v-for="row in data.filtering" :key="row.key" class="qc-bar-row">
          <div class="qc-bar-label">
            <span>{{ row.label }}</span
            ><span>{{ display(row.reads, '条 reads') }}</span>
          </div>
          <div v-if="row.reads !== null" class="qc-bar-track" aria-hidden="true">
            <span :style="{ width: qcReportBarWidth(row.reads, filteringMaximum) }" />
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.qc-report {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.qc-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
h3,
h4 {
  margin: 0;
  color: var(--el-text-color-primary);
}
h3 {
  font-size: 16px;
}
h4 {
  font-size: 14px;
  margin-bottom: 12px;
}
.qc-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
  margin: 0;
}
.qc-cards > div {
  border: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-extra-light);
  border-radius: 8px;
  padding: 16px;
}
.qc-cards dt,
.qc-note {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.qc-cards dd {
  margin: 8px 0 0;
  font-size: 20px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.qc-note {
  margin: 0;
}
.qc-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.qc-panel {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow-x: auto;
}
.qc-bar-row {
  margin-top: 16px;
}
.qc-bar-label {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}
.qc-bar-track {
  height: 8px;
  margin-top: 6px;
  background: var(--el-fill-color);
  border-radius: 3px;
  overflow: hidden;
}
.qc-bar-track span {
  display: block;
  height: 100%;
  background: #4b8bbe;
}
.qc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.7;
}
.qc-table th,
.qc-table td {
  border: 1px solid var(--el-border-color-light);
  padding: 10px 12px;
  text-align: right;
  white-space: nowrap;
}
.qc-table th:first-child {
  text-align: left;
}
.qc-table thead {
  background: var(--el-fill-color-extra-light);
}
.qc-table tbody th {
  font-weight: 400;
}
.qc-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (max-width: 900px) {
  .qc-charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
