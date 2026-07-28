<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import StatusTag from '../components/StatusTag.vue'
import { tasks } from '../data/mockData'
import { BioProject, fetchProjectList } from '../api/bioProject.js'
import { AnalysisPipeline, AnalysisPipelineStage, getAnalysisPipelineTypeName } from '../common/analysisPipeline.js'
import { analysisPipelineStageStatus, doRequestPipelineStates, PipelineInput, pipelineInputConstants, PipelineState } from '../api/analysisPipeline.js'
import { ElMessage } from 'element-plus'
import { RAW_RESPONSE_STATUS_OK } from '../api/common.js'

const emit = defineEmits(['navigate', 'view-task'])
const search = ref('')
const status = ref('全部状态')
const analysisType = ref('全部类型')

const filtered = computed(() =>
  tasks.filter((item) => {
    const keyword =
      !search.value ||
      `${item.name}${item.id}${item.sample}${item.project}`
        .toLowerCase()
        .includes(search.value.toLowerCase())
    const state = status.value === '全部状态' || item.status === status.value
    const type = analysisType.value === '全部类型' || item.type === analysisType.value
    return keyword && state && type
  })
)

const statusCounts = [
  { label: '全部任务', value: 286, status: '全部状态' },
  { label: '运行中', value: 6, status: '运行中' },
  { label: '等待确认', value: 1, status: '需要确认' },
  { label: '失败', value: 3, status: '失败' }
]



const pipelineQuery = reactive({
  query: '',
  state: '',
  pipelineType: -1,
  page: 1,
  pageSize: 20
})

const pipelineStateList = ref<PipelineState[]>([])


async function loadPipelineState() {
  try {
    const pipelineStatesResponse = await doRequestPipelineStates()

    if (pipelineStatesResponse.status !== RAW_RESPONSE_STATUS_OK) {
      ElMessage.error(
        pipelineStatesResponse.failMsg || '分析任务列表加载失败'
      )
      return
    }

    pipelineStateList.value = pipelineStatesResponse.data
  } catch (error) {
    console.error(error)
    ElMessage.error('分析任务列表加载失败')
  }
}

loadPipelineState()

const pipelineStateTableView = computed(() => {
  const normalizedQuery = pipelineQuery.query.trim().toLowerCase()

  let filteredPipelineStates = normalizedQuery
    ? pipelineStateList.value.filter((pipelineState) =>
      [
        pipelineState.pipelineName,
        pipelineState.projectName
      ].some((field) =>
        String(field).toLowerCase().includes(normalizedQuery)
      )
    )
    : pipelineStateList.value

  const start = (pipelineQuery.page - 1) * pipelineQuery.pageSize

  return {
    rows: filteredPipelineStates.slice(
      start,
      start + pipelineQuery.pageSize
    ),
    total: filteredPipelineStates.length
  }
})

function getPipelineInputsTypeName(pipelineInputs: PipelineInput[]) {
  if (pipelineInputs.length > 1) {
    return '双端FASTQ'
  }
  return pipelineInputs[0].fileRole === pipelineInputConstants.pipelineInputFileRoleRead ? '单端FASTQ' : '组装contigs'
}

function getPipelineDisplayStatus(pipelineState: PipelineState) {

  const hasActionRequired = pipelineState.pipelineStages.some((stage) => {
    return stage.status === analysisPipelineStageStatus.actionRequired
  })

  if (hasActionRequired) {
    return 'actionRequired'
  }

  const hasFailed = pipelineState.pipelineStages.some((stage) => {
    return stage.status === analysisPipelineStageStatus.failed
  })

  if (hasFailed) {
    return 'failed'
  }

  const isAllCompleted = pipelineState.pipelineStages.every((stage) => {
    return stage.status === analysisPipelineStageStatus.completed || stage.status === analysisPipelineStageStatus.notApplicable
  })
  return isAllCompleted ? 'completed' : 'running'
}

function getRunningStageNames(pipelineState: PipelineState) {

  const runningStages = pipelineState.pipelineStages.filter((stage) => stage.status === analysisPipelineStageStatus.running)
  if (runningStages.length < 1) {
    return ''
  }

  return runningStages.map((stage) => stage.stageName).join(', ')

}

function getPipelineProgress(pipelineState: PipelineState) {

  const stages = pipelineState?.pipelineStages || [];
  const total = stages.length;

  if (total === 0) return 0; // 避免 0 / 0 变成 NaN

  const completedCount = stages.filter(
    (stage) =>
      stage.status === analysisPipelineStageStatus.completed ||
      stage.status === analysisPipelineStageStatus.notApplicable
  ).length;
  return completedCount / total * 100;
}





</script>

<template>
  <div>
    <PageHeader title="任务管理" description="查看、筛选和管理所有生物信息分析任务">
      <el-button type="primary" @click="emit('navigate', 'new-task')"><el-icon>
          <Plus />
        </el-icon>新建分析任务</el-button>
    </PageHeader>
    <div class="status-strip">
      <button v-for="item in statusCounts" :key="item.label" :class="{ active: status === item.status }"
        @click="status = item.status">
        <span>{{ item.label }}</span><strong>{{ item.value }}</strong>
      </button>
    </div>
    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <el-input v-model="search" clearable placeholder="搜索任务或项目" class="search-input"><template #prefix><el-icon>
              <Search />
            </el-icon></template></el-input>
        <el-select v-model="status" style="width: 135px"><el-option
            v-for="item in ['全部状态', '等待中', '运行中', '需要确认', '已完成', '失败']" :key="item" :label="item"
            :value="item" /></el-select>
        <el-select v-model="analysisType" style="width: 155px"><el-option
            v-for="item in ['全部类型', '细菌全基因组', '病毒全基因组', 'SNP 联合分析']" :key="item" :label="item"
            :value="item" /></el-select>
        <div class="spacer"></div>
        <el-button><el-icon>
            <Download />
          </el-icon>导出</el-button><el-button><el-icon>
            <Refresh />
          </el-icon></el-button>
      </div>
      <el-table :data="pipelineStateTableView.rows" @row-dblclick="(row) => emit('view-task', row.pipelineId)">
        <!-- <el-table-column type="selection" width="45" /> -->
        <el-table-column label="任务名称" min-width="180"><template #default="{ row }">
            <div class="primary-cell">
              <strong>{{ row.pipelineName }}</strong>
            </div>
          </template></el-table-column>
        <el-table-column prop="projectName" label="所属项目" min-width="180" show-overflow-tooltip />
        <el-table-column label="分析类型" min-width="135">
          <template #default="{ row }">
            {{ getAnalysisPipelineTypeName(row.pipelineType) }}
          </template>
        </el-table-column>
        <el-table-column label="输入数据" width="115">
          <template #default="{ row }">
            {{ getPipelineInputsTypeName(row.pipelineInputs) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="105"><template #default="{ row }">
            <StatusTag :status="getPipelineDisplayStatus(row)" />
          </template></el-table-column>
        <el-table-column label="当前运行阶段" min-width="180">
          <template #default="{ row }">
              
            <strong>{{ getRunningStageNames(row) }}</strong>  
            
          </template>
        </el-table-column>

        <el-table-column label="流水线进度" min-width="150">
          <template #default="{row}">
            <el-progress :percentage="Math.ceil(getPipelineProgress(row))"/>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="110" />
        <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }"><el-button link
              type="primary" @click="emit('view-task', row.pipelineId)">详情</el-button><el-dropdown><el-button link><el-icon>
                  <MoreFilled />
                </el-icon></el-button><template
                #dropdown><el-dropdown-menu><el-dropdown-item>重新运行</el-dropdown-item><el-dropdown-item>查看日志</el-dropdown-item><el-dropdown-item
                    divided>取消任务</el-dropdown-item></el-dropdown-menu></template></el-dropdown></template></el-table-column>
      </el-table>
      <div class="footer">
        <span>已选择 0 项</span><el-pagination background layout="prev, pager, next" :total="pipelineStateList.length" :page-size="pipelineQuery.pageSize" />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.status-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.status-strip button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 17px;
  border: 1px solid #e2e9e8;
  border-radius: 10px;
  background: #fff;
  color: #6f7e7c;
  cursor: pointer;
  transition: 0.15s;
}

.status-strip button strong {
  color: #293a38;
  font-size: 20px;
  font-weight: 700;
}

.status-strip button.active {
  border-color: #70afa5;
  background: #f0f8f6;
  color: #167c6b;
  box-shadow: 0 0 0 1px #c9e4df inset;
}

.status-strip button.active strong {
  color: #167c6b;
}

.table-card :deep(.el-card__body) {
  padding: 0;
}

.toolbar {
  display: flex;
  gap: 10px;
  padding: 15px 17px;
  border-bottom: 1px solid #edf1f0;
}

.search-input {
  width: 280px;
}

.spacer {
  flex: 1;
}

.primary-cell {
  display: grid;
}

.primary-cell strong {
  color: #253634;
  font-size: 13px;
  font-weight: 650;
}

.primary-cell small {
  color: #96a3a1;
  font-size: 10px;
}

.stage {
  display: grid;
  gap: 5px;
}

.stage>div {
  display: flex;
  justify-content: space-between;
  color: #647370;
  font-size: 11px;
}

.stage small {
  color: #96a19f;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-top: 1px solid #edf1f0;
}

.footer>span {
  color: #8c9997;
  font-size: 11px;
}
</style>
