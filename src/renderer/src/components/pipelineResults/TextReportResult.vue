<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { filterTextReportRows, paginateTextReportRows, type TextReport } from './textReport'

const props = defineProps<{ report: TextReport }>()
const search = ref('')
const page = ref(1)
const pageSize = ref(25)
const columns = computed(() => props.report.columns.filter((column) => !column.hidden))
const filtered = computed(() => filterTextReportRows(props.report, search.value))
const pageRows = computed(() => paginateTextReportRows(filtered.value, page.value, pageSize.value))
const singleMlst = computed(() =>
  props.report.format === 'mlst' && props.report.rows.length === 1 ? props.report.rows[0] : null
)
const mlstLoci = computed(() =>
  singleMlst.value
    ? columns.value
        .filter((column) => !['sample', 'scheme', 'st'].includes(column.key))
        .map((column) => ({
          locus: column.label,
          reported: singleMlst.value?.values[column.key] ?? ''
        }))
    : []
)
watch([search, pageSize], () => {
  page.value = 1
})
watch(
  () => props.report,
  () => {
    search.value = ''
    page.value = 1
  }
)
</script>

<template>
  <el-card shadow="never" class="text-report-result">
    <template #header>{{ report.title }}</template>
    <el-alert
      v-if="report.status === 'error' || report.status === 'unsupported'"
      :type="report.status === 'error' ? 'error' : 'info'"
      :title="report.status === 'error' ? '报告格式读取失败' : '当前报告暂不支持表格展示'"
      :description="report.message"
      :closable="false"
      show-icon
    />
    <template v-else>
      <p v-for="note in report.notes" :key="note" class="report-note">{{ note }}</p>
      <el-empty
        v-if="report.status === 'empty' || !report.rows.length"
        :description="report.message || '报告未提供数据记录'"
        :image-size="64"
      />
      <template v-else-if="singleMlst">
        <el-descriptions :column="3" border class="mlst-summary">
          <el-descriptions-item label="样本／文件名">{{
            singleMlst.values.sample
          }}</el-descriptions-item>
          <el-descriptions-item label="Scheme（原报告）">{{
            singleMlst.values.scheme
          }}</el-descriptions-item>
          <el-descriptions-item label="ST（原报告）">{{
            singleMlst.values.st === '-' ? '未分型（原值 -）' : singleMlst.values.st
          }}</el-descriptions-item>
        </el-descriptions>
        <h4>MLST 位点原始记录</h4>
        <el-table :data="mlstLoci" stripe border max-height="480" empty-text="报告未提供位点字段">
          <el-table-column prop="locus" label="位点" min-width="150" />
          <el-table-column label="报告原值" min-width="200">
            <template #default="{ row }">{{
              row.reported === '' ? '未提供' : row.reported
            }}</template>
          </el-table-column>
        </el-table>
      </template>
      <template v-else>
        <div class="report-toolbar">
          <el-input
            v-model="search"
            clearable
            placeholder="搜索当前可见报告字段"
            aria-label="搜索报告记录"
          />
          <span
            >共 {{ report.rows.length }} 条报告记录<span v-if="search.trim()"
              >，筛选后 {{ filtered.length }} 条</span
            ></span
          >
        </div>
        <el-table
          :data="pageRows"
          row-key="id"
          stripe
          border
          max-height="520"
          empty-text="没有符合筛选条件的报告记录"
        >
          <el-table-column
            v-for="column in columns"
            :key="column.key"
            :label="column.label"
            :min-width="column.label.length > 18 ? 240 : 160"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{
              row.values[column.key] === '' || row.values[column.key] == null
                ? '未提供'
                : row.values[column.key]
            }}</template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[25, 50, 100]"
          :total="filtered.length"
          layout="total, sizes, prev, pager, next"
          class="report-pagination"
        />
      </template>
    </template>
  </el-card>
</template>

<style scoped>
.text-report-result {
  min-width: 0;
}
.report-note {
  margin: 0 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.report-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 16px 0;
}
.report-toolbar .el-input {
  max-width: 320px;
}
.report-toolbar > span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.report-pagination {
  margin-top: 16px;
  overflow-x: auto;
}
.mlst-summary {
  margin: 16px 0;
}
h4 {
  margin: 16px 0 12px;
  font-size: 14px;
}
</style>
