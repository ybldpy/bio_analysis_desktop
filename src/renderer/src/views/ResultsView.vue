<script setup>
import { ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'

const analysis = ref('细菌全基因组')
const tabs = [
  { title: '质控结果', count: 18, icon: 'CircleCheck' },
  { title: '物种鉴定', count: 18, icon: 'Search' },
  { title: '耐药基因', count: 14, icon: 'FirstAidKit' },
  { title: '毒力因子', count: 11, icon: 'Warning' },
  { title: 'MLST / cgMLST', count: 16, icon: 'DataAnalysis' },
  { title: '血清型', count: 9, icon: 'CollectionTag' }
]
</script>

<template>
  <div>
    <PageHeader title="结果中心" description="集中查看已完成任务的分析结果与报告"
      ><el-button
        ><el-icon><Download /></el-icon>批量导出报告</el-button
      ></PageHeader
    >
    <el-card shadow="never" class="filter-card"
      ><div class="filter-row">
        <el-radio-group v-model="analysis"
          ><el-radio-button value="细菌全基因组">细菌全基因组</el-radio-button
          ><el-radio-button value="病毒全基因组">病毒全基因组</el-radio-button
          ><el-radio-button value="SNP 分析">SNP 分析</el-radio-button></el-radio-group
        ><el-input placeholder="搜索样本或任务" style="width: 260px"
          ><template #prefix
            ><el-icon><Search /></el-icon></template
        ></el-input></div
    ></el-card>
    <div class="result-grid">
      <el-card v-for="item in tabs" :key="item.title" shadow="hover" class="result-card"
        ><div class="result-icon">
          <el-icon><component :is="item.icon" /></el-icon>
        </div>
        <div>
          <strong>{{ item.title }}</strong
          ><span>{{ item.count }} 个样本有结果</span>
        </div>
        <el-icon class="arrow"><ArrowRight /></el-icon
      ></el-card>
    </div>
    <el-card shadow="never"
      ><template #header
        ><div class="latest">
          <div><strong>最近生成的分析报告</strong><span>已完成任务的综合报告</span></div>
          <el-button link type="primary">查看全部</el-button>
        </div></template
      ><el-table
        :data="[
          {
            sample: 'KP-ICU-0719-12',
            species: 'Klebsiella pneumoniae',
            type: '细菌全基因组',
            date: '今天 12:27'
          },
          {
            sample: 'SAL-FD-0718-21',
            species: 'Salmonella enterica',
            type: '细菌全基因组',
            date: '今天 11:21'
          },
          {
            sample: 'EC-0718-14',
            species: 'Escherichia coli',
            type: '细菌全基因组',
            date: '昨天 17:46'
          }
        ]"
        ><el-table-column prop="sample" label="样本编号" /><el-table-column
          prop="species"
          label="物种结果"
        /><el-table-column prop="type" label="分析类型" /><el-table-column
          prop="date"
          label="生成时间"
        /><el-table-column label="操作"
          ><template #default
            ><el-button link type="primary">查看报告</el-button
            ><el-button link>下载 PDF</el-button></template
          ></el-table-column
        ></el-table
      ></el-card
    >
  </div>
</template>

<style scoped>
.filter-card {
  margin-bottom: 16px;
}
.filter-card :deep(.el-card__body) {
  padding: 13px 16px;
}
.filter-row {
  display: flex;
  justify-content: space-between;
}
.result-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}
.result-card {
  cursor: pointer;
}
.result-card :deep(.el-card__body) {
  display: flex;
  align-items: center;
  gap: 13px;
}
.result-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #eaf5f3;
  color: #167c6b;
  font-size: 19px;
}
.result-card > :deep(.el-card__body) > div:nth-child(2) {
  display: grid;
  flex: 1;
}
.result-card strong {
  font-size: 13px;
  font-weight: 650;
}
.result-card span {
  color: #8a9795;
  font-size: 10px;
}
.arrow {
  color: #9aa6a4;
}
.latest {
  display: flex;
  justify-content: space-between;
}
.latest > div {
  display: grid;
}
.latest strong {
  font-weight: 650;
}
.latest span {
  color: #8d9997;
  font-size: 10px;
}
</style>
