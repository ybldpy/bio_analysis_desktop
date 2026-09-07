<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import StatusTag from '../components/StatusTag.vue'
import { tasks } from '../data/mockData'
import { BioProject, fetchProjectList } from '../api/bioProject.js'
import { AnalysisPipeline, AnalysisPipelineStage, getAnalysisPipelineTypeName } from '../common/analysisPipeline.js'
import { analysisPipelineStageStatus, analysisPipelineTypeCodes, doRequestPipelineStates, PipelineInput, pipelineInputConstants, PipelineState } from '../api/analysisPipeline.js'
import { ElMessage } from 'element-plus'
import { RAW_RESPONSE_STATUS_OK } from '../api/common.js'
import { query } from 'node_modules/axios/index.cjs'

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


const pipelineFilterStateSelections = {
  all: '全部状态', 
  running: '运行中',
  actionRequired: '等待确认',
  failed: '失败',
  pending: '等待上传序列',
  completed: '已完成'
}

const currentPipelineRunningStateSelection = ref('all')

const pipelineTypeFilterSelections = {
  '-1' : '全部类型',
  [analysisPipelineTypeCodes.virusCovid]: '新冠全基因分析',
  [analysisPipelineTypeCodes.regularVirus]: '常规病毒全基因分析',
  [analysisPipelineTypeCodes.regularBacteria]: '常规细菌全基因分析',
  [analysisPipelineTypeCodes.metagenomeAmplicon16]:'16S 扩增子分析',
  [analysisPipelineTypeCodes.metagenomeShotgun]: '宏基因组鸟枪法分析'
}

const currentSelectedPipelineTypeSelection = ref('-1')

const pipelineQuery = reactive({
  query: '',
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



const pipelineDisplayStateMap = computed<Map<number, string>>(() => {
  const displayStateMap = new Map<number, string>();
  pipelineStateList.value.forEach((state) => {
    displayStateMap.set(state.pipelineId, getPipelineDisplayStatus(state))
  })

  return displayStateMap
})

const pipelineStateTableView = computed(() => {

  if(pipelineStateList.value.length < 1){
    return {
      rows: [],
      total: 0
    }
  }
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

    filteredPipelineStates = filteredPipelineStates.filter((state) => {
      if(currentPipelineRunningStateSelection.value === "all"){
        return true
      }

      return currentPipelineRunningStateSelection.value === getPipelineDisplayStatus(state);
    }).filter((state) => {
      if(currentSelectedPipelineTypeSelection.value === "-1"){
        return true;
      }
      return currentSelectedPipelineTypeSelection.value === String(state.pipelineType)
    })






  const start = (pipelineQuery.page - 1) * pipelineQuery.pageSize

  return {
    rows: filteredPipelineStates.slice(
      start,
      start + pipelineQuery.pageSize
    ),
    total: filteredPipelineStates.length
  }
})

function getPipelineInputsTypeName(pipelineState: PipelineState) {


 // console.log("pipeline state list length " + pipelineStateList.value.length)



 


  if (pipelineState.pipelineInputs.length > 1) {
    return '双端FASTQ'
  }else if(pipelineState.pipelineInputs.length < 1){
    return '--'
  }

  return pipelineState.pipelineInputs[0].fileRole === pipelineInputConstants.pipelineInputFileRoleRead ? '单端FASTQ' : '组装contigs'
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
    <!-- <div class="status-strip">
      <button v-for="(label, key) in pipelineFilterState" :key="key" :class="{ active: key === currentFilterPipelineState }"
        @click="currentFilterPipelineState = key">
        <span>{{ label }}</span>
      </button>
    </div> -->
    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <el-input v-model="pipelineQuery.query" clearable placeholder="搜索任务或项目" class="search-input"><template #prefix><el-icon>
              <Search />
            </el-icon></template></el-input>
        <el-select v-model="currentPipelineRunningStateSelection" style="width: 135px"><el-option
            v-for="(label, status) in pipelineFilterStateSelections" :key="status" :label="label"
            :value="status" /></el-select>
        <el-select v-model="currentSelectedPipelineTypeSelection" style="width: 155px"><el-option
            v-for="(typeName, typeCode) in pipelineTypeFilterSelections" :key="typeCode" :label="typeName"
            :value="typeCode" /></el-select>
        <div class="spacer"></div>
        <!-- <el-button><el-icon>
            <Download />
          </el-icon>
          导出
        </el-button> -->
        <el-button @click="loadPipelineState"><el-icon>
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
          <template #default="{ row, $index }">
            <template v-if="$index >= 0">
              {{ getAnalysisPipelineTypeName(row.pipelineType) }}
            </template>
          </template>
        </el-table-column>
        <el-table-column label="输入数据" width="115">
          <template #default="{ row, $index }">
            <template v-if="$index >= 0">
              {{ getPipelineInputsTypeName(row) }}
            </template>
            
          </template>
        </el-table-column>
        <el-table-column label="状态" width="105"><template #default="{ row }">
            <StatusTag :status="pipelineDisplayStateMap.get(row.pipelineId)" />
          </template></el-table-column>
        <el-table-column label="当前运行阶段" min-width="180">
          <template #default="{ row, $index}">
            <template v-if="$index >= 0">
              <strong>{{ getRunningStageNames(row) }}</strong> 
            </template>
          </template>
        </el-table-column>

        <el-table-column label="流水线进度" min-width="150">
          <template #default="{row, $index}">

            <template v-if="$index >= 0">
              <el-progress :percentage="Math.ceil(getPipelineProgress(row))"/>
            </template>
            
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
        <span>已选择 0 项</span><el-pagination v-model:current-page="pipelineQuery.page" background layout="prev, pager, next"  :total="pipelineStateList.length" :page-size="pipelineQuery.pageSize" />
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
