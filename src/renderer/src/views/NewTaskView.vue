<script setup lang="ts">
import { computed, onBeforeMount, reactive, Ref, ref, watch } from 'vue'
import { ElMessage, genFileId, UploadInstance, UploadProps, UploadRawFile, UploadUserFile } from 'element-plus'
import {
  analysisPipelineTypeCodes,
  canUseBatchPrefix,
  fetchProjectList,
  fetchReferenceGenomeList
} from '../api/analysisTaskBuild.js'

const emit = defineEmits(['cancel', 'submitted'])
const activeSectionId = ref(0)
const activeSectionStack = []
const activeTaskIndex = ref(0)
let taskSequence = 1

interface AnalysisTask {
  name: string,
  r1: UploadUserFile[],
  r2: UploadUserFile[],
  assembly: UploadUserFile[], 
  customerReferenceGenome: UploadUserFile[],
  type: 0 | 1 | 2
}

interface AnalysisTasksBuildJob {
  projectId: number | null,
  analysisPipelineTypeCode: number | null
  referenceGenomeId: number | null,
  tasks: AnalysisTask[]
}



const batchNamePrefix = ref('')

const r1UploadRef = ref<UploadInstance>(null)
const r2UploadRef = ref<UploadInstance>(null)
const contigUploadRef = ref<UploadInstance>(null)


watch(batchNamePrefix, (newBatchName) => {
  analysisTasksBuildJob.tasks.forEach((task, index) => {
    task.name = createTaskName(newBatchName, index)
  })
})

const sectionMap = {
  projectAndAnalysisTypeSelection: 0,
  virusSpecificTypeSelection: 10,
  metagenomeSpecificTypeSelection: 11,
  referenceGenomeSelection: 2,
  taskCreate: 3, 
  comfirmation: 4
}

const analysisTasksBuildJob: AnalysisTasksBuildJob = reactive({
  referenceGenomeId: computed(() => {
    if (!selectedReference.value) {
      return null
    }
    return selectedReference.value.refId
  }),
  projectId: null,
  analysisPipelineTypeCode: computed(() => {
    for (const item of Object.values(analysisTypes)) {
      if (item.id === pipelineTypeSelection.typeId) {
        if (item.code !== undefined && item.code !== null && Number.isInteger(item.code)) {
          return item.code
        } else if (item.specificTypes !== undefined && item.specificTypes !== null) {
          for (const specificType of Object.values(item.specificTypes)) {
            if (specificType.id === pipelineTypeSelection.specificTypeId) {
              return specificType.code
            }
          }
        }
        break
      }
    }
    return null
  }),
  tasks: []
})


const analysisTaskViewKeysMap = new WeakMap()
function getAnalysisTaskViewKey(task: AnalysisTask) {

  const existingKey = analysisTaskViewKeysMap.get(task)

  if (existingKey) {
    return existingKey
  }

  const newKey = crypto.randomUUID()
  analysisTaskViewKeysMap.set(task, newKey)

  return newKey
}



//-1 no status; 0: ok, 1: duplicate; 2: do checking
const batchNamePrefixAvailable = ref(-1)


const onBatchNameChange = (() => {
  let timer = null
  let latestSentRequest = 0

  return function (prefix) {
    clearTimeout(timer)
    batchNamePrefixAvailable.value = -1

    const normalizedPrefix = prefix.trim()
    if (!normalizedPrefix) return

    timer = setTimeout(async () => {
      const sentRequestId = ++latestSentRequest
      try {
        batchNamePrefixAvailable.value = 2
        const canUse = await canUseBatchPrefix(normalizedPrefix, analysisTasksBuildJob.projectId)

        // 旧请求的结果直接丢弃
        if (sentRequestId !== latestSentRequest) {
          return
        }

        if (canUse) {
          batchNamePrefixAvailable.value = 0
        } else {
          batchNamePrefixAvailable.value = 1
        }
      } catch (error) {
        // 旧请求的错误也不处理
        if (sentRequestId !== latestSentRequest) {
          return
        }

        batchNamePrefixAvailable.value = -1

        console.error(error)
        ElMessage.error('检查任务名称前缀失败')
      }
    }, 700)
  }
})()

function createTask(source = {}, name): AnalysisTask {
  return {
    name: name,
    r1: [],
    r2: [],
    assembly: [],
    customerReferenceGenome: [],
    type: 0
  }
}




analysisTasksBuildJob.tasks.push(createTask(null, createTaskName(batchNamePrefix.value, activeTaskIndex.value)))



const analysisTypes = {
  bacteria: {
    id: 'bacteria',
    title: '细菌全基因组',
    subtitle: 'Bacterial WGS',
    icon: 'DataAnalysis',
    color: '#167c6b',
    desc: '质控、组装、物种鉴定、ANI、耐药、毒力及分型分析',
    code: analysisPipelineTypeCodes.regularBacteria
  },
  virus: {
    id: 'virus',
    title: '病毒全基因组',
    subtitle: 'Viral WGS',
    icon: 'Histogram',
    color: '#456fa8',
    desc: '参考比对、变异检测、注释、一致性序列及系统发育分析',
    specificTypes: {
      covid19: {
        id: 'sars-cov-2',
        title: '新型冠状病毒',
        subtitle: 'SARS-CoV-2',
        desc: '新冠病毒全基因组分析, 额外添加SNP注释',
        code: analysisPipelineTypeCodes.virusCovid
      },
      generalVirus: {
        id: 'general-virus-wgs',
        title: '常规病毒',
        subtitle: 'General Viral WGS',
        desc: '适用于新冠病毒以外的常规病毒全基因组分析',
        code: analysisPipelineTypeCodes.regularVirus
      }
    }
  },
  snp: {
    id: 'snp',
    title: 'SNP 分析',
    subtitle: 'SNP Analysis',
    icon: 'Share',
    color: '#885bb0',
    desc: '单样本或多样本变异比较、聚类与溯源分析',
    disabled: true
  },
  metagenome: {
    id: 'metagenome',
    title: '宏基因组 / mNGS',
    subtitle: 'Metagenomics',
    icon: 'Grid',
    color: '#b6792c',
    desc: '物种分类、丰度分析和物种组成可视化',
    specificTypes: {
      amplicon16s: {
        id: 'amplicon-16s',
        title: '16S 扩增子分析',
        subtitle: '16S Amplicon Sequencing',
        desc: '细菌和古菌物种组成、丰度、ASV/OTU 及 α 多样性分析',
        code: analysisPipelineTypeCodes.metagenomeAmplicon16
      },
      metagenomeshotgun: {
        id: 'metagenome-shotgun',
        title: 'Shotgun 宏基因组',
        subtitle: 'Shotgun Metagenomics',
        desc: '物种组成、功能基因、代谢通路、耐药基因及宏基因组组装分析',
        code: analysisPipelineTypeCodes.metagenomeShotgun
      }
    }
  }
}


const pipelineTypeSelection = reactive({
  typeId: null,
  specificTypeId: null
})


const selectedReferenceLabel = computed(() =>
  selectedReference.value
    ? `${selectedReference.value.accession} · ${selectedReference.value.speciesName}`
    : '--'
)
const activeTask = computed(() => analysisTasksBuildJob.tasks[activeTaskIndex.value])
const selectedReference = ref(null)


const referenceListLoading = ref(false)
const referenceList = ref([])
const referenceGenomePageInfoAtSearchCondition = reactive({
  search: '',
  page: 1,
  pageSize: 20,
  totalRecords: 0
})

async function loadReferenceGenomeList(query, pageIndex, pageSize) {

  let fetchedReferenceGenomeResult = null;
  while (true) {
    const from = pageIndex * pageSize
    fetchedReferenceGenomeResult = await fetchReferenceGenomeList(query, from, pageSize)
    if (pageIndex * pageSize >= fetchedReferenceGenomeResult.totalRecords && fetchedReferenceGenomeResult.totalRecords > 0) {
      const maxPage = Math.max(
        1,
        Math.ceil(fetchedReferenceGenomeResult.totalRecords / pageSize)
      )
      pageIndex = maxPage - 1
    } else {
      break
    }
  }

  referenceGenomePageInfoAtSearchCondition.totalRecords = fetchedReferenceGenomeResult.totalRecords
  referenceGenomePageInfoAtSearchCondition.page = pageIndex + 1
  referenceList.value = fetchedReferenceGenomeResult.referenceGenomes
}

const projectList = ref([])
const projectListLoading = ref(false)

async function initProjectList() {
  projectListLoading.value = true

  try {
    const analysisProjectList = await fetchProjectList()
    projectList.value = analysisProjectList
  } catch (error) {
    console.error(error)
    ElMessage.error('项目列表加载失败')
  }
  projectListLoading.value = false
}

function createTaskName(
  prefix: string,
  index: number
): string {
  const normalizedPrefix = prefix.trim()
  const sequence = String(index + 1).padStart(4, '0')

  return `${normalizedPrefix}-${sequence}`
}

function addTask(source) {
  activeTaskIndex.value = analysisTasksBuildJob.tasks.length
  analysisTasksBuildJob.tasks.push(createTask(source, createTaskName(batchNamePrefix.value, activeTaskIndex.value)))
}

function removeTask(index) {
  if (analysisTasksBuildJob.tasks.length === 1) {
    ElMessage.warning('至少需要保留一个分析任务')
    return
  }
  analysisTasksBuildJob.tasks.splice(index, 1)
  activeTaskIndex.value = Math.min(activeTaskIndex.value, analysisTasksBuildJob.tasks.length - 1)

  analysisTasksBuildJob.tasks.forEach((task, index) => {
    task.name = createTaskName(batchNamePrefix.value, index)
  })

}

function uploadedFileCount(task) {
  if (task.dataType === 'paired') return task.r1Files.length + task.r2Files.length
  return task.dataFiles.length
}

function uploadReady(task) {
  if (task.dataType === 'paired') return task.r1Files.length > 0 && task.r2Files.length > 0
  return task.dataFiles.length > 0
}

function automaticTaskName(index) {
  if (!batchNamePrefix.value.trim()) return `未命名任务 ${index + 1}`
  const suffix = String(form.startIndex + index).padStart(form.indexDigits, '0')
  return `${form.taskPrefix.trim()}${form.separator}${suffix}`
}

function displayTaskName(task, index) {
  if (!batchNamePrefix.value.trim()){
    return `未命名任务 ${index+1}`
  }

  return task.name
}

function selectReference(reference) {
  selectedReference.value = reference
}


function doCheckForBuildJobBeforeConfirmation() {
  const notSatisfiedTaskList =
    analysisTasksBuildJob.tasks.filter((task) => {
      switch (task.type) {
        case 0:
          return task.r1.length < 1 || task.r2.length < 1

        case 1:
          return task.r1.length < 1

        case 2:
          return task.assembly.length < 1

        default:
          return true
      }
    })

  if (notSatisfiedTaskList.length > 0) {
    return {
      satisfied: false,
      msg: `以下任务缺少文件：${notSatisfiedTaskList
        .map(task => task.name)
        .join('、')}`
    }
  }

  return {
    satisfied: true,
    msg: ''
  }
}

function checkCurrentSectionSatisfied(currentSectionId) {

  let satisfied = true
  let msg = ''
  if (currentSectionId === sectionMap.projectAndAnalysisTypeSelection) {
    satisfied = !!analysisTasksBuildJob.projectId && !!pipelineTypeSelection.typeId
    msg = '请选择项目和分析任务类型'
  } else if (currentSectionId === sectionMap.referenceGenomeSelection) {
    satisfied = !!selectedReference.value
    msg = '请选择参考基因组'
  } else if (currentSectionId === sectionMap.virusSpecificTypeSelection || currentSectionId === sectionMap.metagenomeSpecificTypeSelection) {
    satisfied = !!pipelineTypeSelection.specificTypeId
    msg = '请选择具体类型'
  } else if (currentSectionId === sectionMap.taskCreate) {
    return doCheckForBuildJobBeforeConfirmation()
  }

  return { satisfied, msg }
}

function calculateNextSectionId(currentSectionId) {

  if (currentSectionId === sectionMap.projectAndAnalysisTypeSelection) {
    if (pipelineTypeSelection.typeId === analysisTypes.bacteria.id) {
      return sectionMap.taskCreate
    }
    if (pipelineTypeSelection.typeId === analysisTypes.virus.id) {
      return sectionMap.virusSpecificTypeSelection
    }
    if (pipelineTypeSelection.typeId === analysisTypes.metagenome.id) {
      return sectionMap.metagenomeSpecificTypeSelection
    }
  }

  if (currentSectionId === sectionMap.virusSpecificTypeSelection) {
    if (pipelineTypeSelection.specificTypeId === analysisTypes.virus.specificTypes.covid19.id) {
      return sectionMap.taskCreate
    } else {
      return sectionMap.referenceGenomeSelection
    }
  }

  if (currentSectionId === sectionMap.referenceGenomeSelection) {
    return sectionMap.taskCreate
  }

  if (currentSectionId === sectionMap.metagenomeSpecificTypeSelection) {
    return sectionMap.taskCreate
  }

  if(currentSectionId === sectionMap.taskCreate){
    return sectionMap.comfirmation
  }

  return sectionMap.projectAndAnalysisTypeSelection
}

function next() {
  const { satisfied, msg } = checkCurrentSectionSatisfied(activeSectionId.value)
  if (!satisfied) {
    ElMessage.warning(msg)
    return
  }
  const nextSectionId = calculateNextSectionId(activeSectionId.value)
  activeSectionStack.push(activeSectionId.value)
  activeSectionId.value = nextSectionId
}

function submit() {
  ElMessage.success(`已提交 ${analysisTasksBuildJob.tasks.length} 个任务并进入分析队列`)
  emit('submitted')
}

const uploadProps = {
  autoUpload: false,
  action: '#',
  showFileList: true,
  limit: 1
}

function replaceWithNewFile(files, uploadInstance: UploadInstance){

  uploadInstance.clearFiles()

  const file = files[0] as UploadRawFile
  file.uid = genFileId()
  uploadInstance.handleStart(file)

}

async function handleReferenceListTablePageChange(currentPage) {
  referenceGenomePageInfoAtSearchCondition.page = currentPage
  referenceListLoading.value = true

  try {
    await loadReferenceGenomeList(
      referenceGenomePageInfoAtSearchCondition.search,
      currentPage - 1,
      referenceGenomePageInfoAtSearchCondition.pageSize
    )
  } catch (error) {
    console.error(error)
    ElMessage.error('加载参考基因组列表失败')
  } finally {
    referenceListLoading.value = false
  }
}



async function doReferenceGenomeSearch() {

  referenceListLoading.value = true
  try {
    await loadReferenceGenomeList(referenceGenomePageInfoAtSearchCondition.search, 1, referenceGenomePageInfoAtSearchCondition.pageSize)
  } catch (error) {
    console.error(error)
    ElMessage.error('加载参考基因组列表失败')
  } finally {
    referenceListLoading.value = false
  }
}


onBeforeMount(() => {
  initProjectList()
  loadReferenceGenomeList('', 0, referenceGenomePageInfoAtSearchCondition.pageSize)
})

function calculateActiveStep() {


  const activeZeroSections = [sectionMap.projectAndAnalysisTypeSelection, sectionMap.virusSpecificTypeSelection, sectionMap.metagenomeSpecificTypeSelection]
  if (activeZeroSections.some(sectionId => sectionId === activeSectionId.value)) { return 0 }
  if (activeSectionId.value === sectionMap.referenceGenomeSelection) {
    return 1
  }

  if (activeSectionId.value === sectionMap.taskCreate) {
    return 2
  }
}

function canMoveBackward() {
  return activeSectionStack.length > 0
}

function hasNextSection() {
  return true
}

function selectAnalysisType(id:string) {
  pipelineTypeSelection.typeId = id
}

function moveSectionBackward() {
  const lastSectionId = activeSectionStack.pop()
  activeSectionId.value = lastSectionId
}

function selectSpeceficType(speceficTypeId) {
  pipelineTypeSelection.specificTypeId = speceficTypeId
}

function 

</script>

<template>
  <div class="new-task-page">
    <el-card shadow="never" class="step-card">
      <el-steps :active="calculateActiveStep()" align-center finish-status="success">
        <el-step title="项目与分析类型" description="选择流程" />
        <el-step title="参考基因组" description="搜索并选择" />
        <el-step title="任务与数据" :description="`已创建 ${analysisTasksBuildJob.tasks.length} 个任务`" />
        <el-step title="确认提交" description="检查信息" />
      </el-steps>
    </el-card>

    <el-card shadow="never" class="form-card">
      <div v-if="activeSectionId === sectionMap.projectAndAnalysisTypeSelection" class="step-content">
        <div class="section-heading">
          <span>01</span>
          <div>
            <h2>选择所属项目</h2>
            <p>分析任务和样本将归入所选项目</p>
          </div>
        </div>
        <el-form label-position="top"><el-form-item label="所属项目" required><el-select
              v-model="analysisTasksBuildJob.projectId" filterable placeholder="请选择项目" style="width: 100%"><el-option
                v-for="item in projectList" :key="item.id" :label="item.name"
                :value="item.id" /></el-select></el-form-item></el-form>
        <el-divider />
        <div class="section-heading">
          <span>02</span>
          <div>
            <h2>选择分析类型</h2>
            <p>系统将根据分析类型加载对应流程和参数</p>
          </div>
        </div>
        <div class="type-grid">
          <button v-for="(v, k) in analysisTypes" :key="v.id" :disabled="v.disabled" :class="[
            'type-card',
            { selected: pipelineTypeSelection.typeId === v.id, disabled: v.disabled }
          ]" @click="selectAnalysisType(v.id)">
            <span v-if="v.disabled" class="coming">即将开放</span>
            <div class="type-icon" :style="{ color: v.color, background: `${v.color}13` }">
              <el-icon :size="24">
                <component :is="v.icon" />
              </el-icon>
            </div>
            <div>
              <h3>{{ v.title }}</h3>
              <small>{{ v.subtitle }}</small>
              <p>{{ v.desc }}</p>
            </div>
            <el-icon v-if="pipelineTypeSelection.typeId === v.id" class="selected-icon">
              <CircleCheckFilled />
            </el-icon>
          </button>
        </div>
      </div>

      <div v-else-if="activeSectionId === sectionMap.virusSpecificTypeSelection"
        class="step-content virusSpecificTypeSelection">
        <div class="section-heading">
          <div>
            <h2>选择病毒分析流程</h2>
            <p>根据样本类型选择新冠病毒专项分析或常规病毒全基因组分析</p>
          </div>
        </div>


        <div class="type-grid">
          <button v-for="(specificType, typeId) in analysisTypes.virus.specificTypes" :key="typeId" type="button"
            :class="[
              'type-card',
              {
                selected:
                  pipelineTypeSelection.specificTypeId ===
                  specificType.id
              }
            ]" @click="
              selectSpeceficType(specificType.id)
              ">
            <div>
              <h3>{{ specificType.title }}</h3>
              <small>{{ specificType.subtitle }}</small>
              <p>{{ specificType.desc }}</p>
            </div>

            <el-icon v-if="
              pipelineTypeSelection.specificTypeId ===
              specificType.id
            " class="selected-icon">
              <CircleCheckFilled />
            </el-icon>
          </button>
        </div>
      </div>



      <div v-else-if="activeSectionId === sectionMap.referenceGenomeSelection" class="step-content">
        <div class="section-heading">
          <span>01</span>
          <div>
            <h2>选择参考基因组</h2>
            <p>本批次内的所有任务将使用同一个参考基因组</p>
          </div>
        </div>

        <div class="reference-browser">
          <div class="reference-toolbar">
            <el-input v-model="referenceGenomePageInfoAtSearchCondition.search" clearable placeholder="搜索物种名称、Tax ID"
              @@keyup.enter="doReferenceGenomeSearch">
              <template #prefix>
                <el-icon>
                  <Search />
                </el-icon>
              </template>
            </el-input>
            <!-- <span>共 {{ filteredReferenceGenomes.length }} 条参考基因组</span> -->
          </div>

          <div v-loading="referenceListLoading" element-loading-text="正在加载参考基因组..." class="reference-browser">
            <el-table :data="referenceList" row-key="ref_id" highlight-current-row class="reference-table"
              @row-click="selectReference">
              <el-table-column width="52" align="center">
                <template #default="{ row }">
                  <el-radio :model-value="selectedReference?.refId" :value="row.refId" @change="selectReference(row)" />
                </template>
              </el-table-column>
              <!-- <el-table-column prop="accession" label="Accession" min-width="145" /> -->
              <el-table-column prop="speciesName" label="物种" min-width="230" />
              <el-table-column prop="taxId" label="Tax ID" width="110" />
              <el-table-column prop="genomeLength" label="基因组长度" width="110" />
              <el-table-column prop="version" label="版本" width="75" />
            </el-table>

            <div class="reference-pagination">
              <span>每页 {{ referenceGenomePageInfoAtSearchCondition.pageSize }} 条</span>
              <el-pagination :current-page="referenceGenomePageInfoAtSearchCondition.page"
                :page-size="referenceGenomePageInfoAtSearchCondition.pageSize"
                @current-change="handleReferenceListTablePageChange"
                :total="referenceGenomePageInfoAtSearchCondition.totalRecords" background layout="prev, pager, next" />
            </div>
          </div>
        </div>

        <div v-if="selectedReference" class="selected-reference">
          <div class="selected-reference-icon">
            <el-icon>
              <CircleCheckFilled />
            </el-icon>
          </div>
          <div>
            <span>已选择参考基因组</span>
            <strong>{{ selectedReferenceLabel }}</strong>
            <small>Tax ID {{ selectedReference.taxId }} · {{ selectedReference.genomeLength }}</small>
          </div>
          <el-button link type="primary" @click="selectedReference = null">
            重新选择
          </el-button>
        </div>
      </div>

      <div v-else-if="sectionMap.taskCreate" class="step-content batch-step">
        <div class="batch-heading">
          <div class="section-heading">
            <span>01</span>
            <div>
              <h2>创建分析任务</h2>
              <p>同一批次使用相同的分析类型和流程参数，每个任务独立上传数据</p>
            </div>
          </div>
          <el-button type="primary" plain @click="addTask()">
            <el-icon>
              <Plus />
            </el-icon>添加任务
          </el-button>
        </div>

        <div class="naming-panel">
          <div class="naming-title">
            <div>
              <strong>批次任务命名</strong><span>设置一次，系统将按顺序生成本批次全部任务名称</span>
            </div>
            <el-tag type="success" effect="plain">自动编号</el-tag>
          </div>
          <el-form label-position="top" class="naming-form">
            <el-form-item label="任务名称前缀" required>
              <div class="prefix-field">
                <el-input v-model="batchNamePrefix" :class="[
                  'prefix-input',
                  {
                    'is-available': batchNamePrefixAvailable === 0,
                    'is-duplicate': batchNamePrefixAvailable === 1
                  }
                ]" clearable placeholder="例如：EC-20260721" @input="onBatchNameChange">
                  <template #suffix>
                    <el-icon v-if="batchNamePrefixAvailable === 2" class="prefix-status-icon is-checking">
                      <Loading />
                    </el-icon>
                    <el-icon v-else-if="batchNamePrefixAvailable === 0" class="prefix-status-icon is-available">
                      <CircleCheckFilled />
                    </el-icon>
                    <el-icon v-else-if="batchNamePrefixAvailable === 1" class="prefix-status-icon is-duplicate">
                      <CircleCloseFilled />
                    </el-icon>
                  </template>
                </el-input>
                <div v-if="batchNamePrefix.trim() && batchNamePrefixAvailable !== -1" :class="[
                  'prefix-feedback',
                  {
                    'is-checking': batchNamePrefixAvailable === 2,
                    'is-available': batchNamePrefixAvailable === 0,
                    'is-duplicate': batchNamePrefixAvailable === 1
                  }
                ]">
                  <span v-if="batchNamePrefixAvailable === 2">正在检查当前项目中的前缀...</span>
                  <!-- <span v-else-if="batchNamePrefixAvailable === 0">
                    前缀可以使用
                  </span> -->
                  <span v-else-if = 'batchNamePrefixAvailable === 1'>该前缀已在当前项目中使用，请更换</span>
                </div>
              </div>
            </el-form-item>
            <!-- <el-form-item label="分隔符">
              <el-select v-model="form.separator">
                <el-option label="-（短横线）" value="-" />
                <el-option label="_（下划线）" value="_" />
                <el-option label="无分隔符" value="" />
              </el-select>
            </el-form-item>
            <el-form-item label="起始编号">
              <el-input-number
                v-model="form.startIndex"
                :min="0"
                :max="99999"
                controls-position="right"
              />
            </el-form-item>
            <el-form-item label="编号位数">
              <el-select v-model="form.indexDigits">
                <el-option label="2 位（01）" :value="2" />
                <el-option label="3 位（001）" :value="3" />
                <el-option label="4 位（0001）" :value="4" />
              </el-select>
            </el-form-item> -->
          </el-form>
          <!-- <div class="name-preview">
            <span>名称预览</span>
            <code>{{ automaticTaskName(0) }}</code>
            <el-icon v-if="taskItems.length > 1"><Right /></el-icon>
            <code v-if="taskItems.length > 1">{{ automaticTaskName(taskItems.length - 1) }}</code>
            <small>共 {{ taskItems.length }} 个任务</small>
          </div> -->
        </div>

        <div class="batch-editor">
          <aside class="task-list">
            <div class="task-list-title">
              <span>任务列表</span><el-tag round size="small">{{ analysisTasksBuildJob.tasks.length }}</el-tag>
            </div>
            <button v-for="(item, index) in analysisTasksBuildJob.tasks" :key="getAnalysisTaskViewKey(item)"
              :class="['task-list-item', { active: activeTaskIndex === index }]" @click="activeTaskIndex = index">
              <span class="task-order">{{ index + 1 }}</span>
              <span class="task-label">
                <strong>{{ displayTaskName(item, index) }}</strong>
                <small>{{
                  { 0: '双端 FASTQ', 1: '单端 FASTQ', 2: 'Contigs FASTA' }[
                  item.type
                  ]
                  }}</small>
              </span>
              <el-icon v-if="false" class="task-valid">
                <CircleCheckFilled />
              </el-icon>
            </button>
            <button class="add-task-row" @click="addTask()">
              <el-icon>
                <Plus />
              </el-icon>添加一个任务
            </button>
          </aside>

          <section class="task-editor">
            <div class="editor-heading">
              <div>
                <span>任务 {{ activeTaskIndex + 1 }}</span><strong>{{ displayTaskName(activeTask, activeTaskIndex)
                }}</strong>
              </div>
              <div>
                <el-tooltip content="删除当前任务">
                  <el-button text circle type="danger" @click="removeTask(activeTaskIndex)"><el-icon>
                      <Delete />
                    </el-icon></el-button>
                </el-tooltip>
              </div>
            </div>

            <el-form label-position="top">
              <div class="two-col">
                <!-- <el-form-item label="任务名称">
                  <div class="task-name-field">
                    <el-label :model-value="activeTask.name" />
                  </div>
                </el-form-item> -->
                <el-form-item label="任务描述">
                  <el-input placeholder="来源、批次或其他备注" />
                </el-form-item>
              </div>
            </el-form>

            <div class="subsection-title">
              <strong>测序数据</strong><span>为当前任务选择数据类型并上传文件</span>
            </div>
            <el-radio-group v-model="activeTask.type" class="data-type">
              <el-radio-button :value='0'>双端测序 FASTQ</el-radio-button>
              <el-radio-button :value='1'>单端测序 FASTQ</el-radio-button>
              <el-radio-button :value='2'>已组装 Contigs</el-radio-button>
            </el-radio-group>
            <div v-if="activeTask.type === 0" class="upload-grid">
              <el-upload ref="r1UploadRef" v-model:file-list="activeTask.r1" drag v-bind="uploadProps" :on-exceed="(files) => {replaceWithNewFile(files, r1UploadRef)}">
                <el-icon class="upload-icon">
                  <UploadFilled />
                </el-icon>
                <div class="upload-title">上传 R1 文件</div>
                <div class="upload-tip">正向 reads，支持 .fastq / .fq / .gz</div>
              </el-upload>
              <el-upload ref="r2UploadRef" v-model:file-list="activeTask.r2" drag v-bind="uploadProps" :on-exceed="(files) => {replaceWithNewFile(files, r2UploadRef)}">
                <el-icon class="upload-icon">
                  <UploadFilled />
                </el-icon>
                <div class="upload-title">上传 R2 文件</div>
                <div class="upload-tip">反向 reads，需与 R1 成对</div>
              </el-upload>
            </div>
            <div v-else-if="activeTask.type === 1" class="upload-single">
              <el-upload ref="r1UploadRef" v-model:file-list="activeTask.r1" drag v-bind="uploadProps" :on-exceed="(files) => {replaceWithNewFile(files, r1UploadRef)}">
                <el-icon class="upload-icon">
                  <UploadFilled />
                </el-icon>
                <div class="upload-title">
                  {{
                      '上传单端 FASTQ 文件'
                  }}
                </div>
                <div class="upload-tip">拖拽文件到此处，或点击选择文件</div>
              </el-upload>
            </div>
            <div v-else class="upload-single">
              <el-upload :ref="contigUploadRef" v-model:file-list="activeTask.assembly" drag v-bind="uploadProps" :on-exceed="(files) => {replaceWithNewFile(files, contigUploadRef)}">
                <el-icon class="upload-icon">
                  <UploadFilled />
                </el-icon>
                <div class="upload-title">
                  {{
                      '上传contigs/assembly FASTA文件'
                  }}
                </div>
                <div class="upload-tip">拖拽文件到此处，或点击选择文件</div>
              </el-upload>
            </div>
            <el-alert v-if="activeTask.type === 2 && pipelineTypeSelection.typeId === analysisTypes.virus.id" title="使用已组装数据时，系统将只使用参考基因组进行序列比较" type="info"
              :closable="false" show-icon />
          </section>
        </div>
      </div>

      <div v-else class="step-content confirm-step">
        <div class="confirm-icon">
          <el-icon>
            <DocumentChecked />
          </el-icon>
        </div>
        <h2>确认任务信息</h2>
        <p>本批次包含 {{ analysisTasksBuildJob.tasks.length }} 个任务，提交后将分别进入分析队列。</p>
        <el-descriptions :column="2" border class="summary">
          <el-descriptions-item label="所属项目">{{projectList.find(
            (project) =>
              project.id === analysisTasksBuildJob.projectId
          )?.name ?? '--'}}</el-descriptions-item>
          <el-descriptions-item label="分析类型">{{ Object.values(analysisTypes).find((type) => type.id === pipelineTypeSelection.typeId).title }}</el-descriptions-item>
          <el-descriptions-item v-if="!!pipelineTypeSelection.specificTypeId" label="具体类型"></el-descriptions-item>
          <el-descriptions-item label="任务名称前缀">{{ batchNamePrefix }}</el-descriptions-item>
          <el-descriptions-item label="任务数量">{{ analysisTasksBuildJob.tasks.length }} 个</el-descriptions-item>
          <el-descriptions-item v-if="form.analysisType === 'virus'" label="参考基因组">
            {{ selectedReferenceLabel }}
          </el-descriptions-item>
        </el-descriptions>
        <div class="confirm-list">
          <div class="confirm-list-heading">
            <strong>本次创建的任务</strong><span>共 {{ analysisTasksBuildJob.tasks.length }} 项</span>
          </div>
          <el-table :data="analysisTasksBuildJob.tasks" max-height="240" border>
            <el-table-column type="index" label="#" width="48" />
            <el-table-column label="任务名称" min-width="180">
              <template #default="{ row, $index }">
                {{ displayTaskName(row, $index) }}
                <el-tag v-if="row.customName" size="small" type="info">自定义</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="任务描述" min-width="180">
              <template #default="{ row }">{{ row.description || '--' }}</template>
            </el-table-column>
            <el-table-column label="数据类型" min-width="145">
              <template #default="{ row }">
                {{
                  { paired: '双端测序 FASTQ', single: '单端测序 FASTQ', contigs: '已组装 Contigs' }[
                  row.dataType
                  ]
                }}
              </template>
            </el-table-column>
            <el-table-column label="文件" width="110">
              <template #default="{ row }">
                <el-tag v-if="uploadReady(row)" type="success" size="small">
                  {{ uploadedFileCount(row) }} 个文件
                </el-tag>
                <el-tag v-else type="warning" size="small">待补充</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <!-- <el-checkbox checked>我已确认全部任务信息和上传文件无误</el-checkbox> -->
      </div>

      <div class="form-footer">
        <el-button v-if="canMoveBackward()" @click="moveSectionBackward">
          <el-icon>
            <ArrowLeft />
          </el-icon>
          上一步
        </el-button>
        <span v-else></span>
        <div>
          <el-button @click="emit('cancel')">取消</el-button>
          <el-button v-if="hasNextSection()" type="primary" @click="next">
            下一步
            <el-icon>
              <ArrowRight />
            </el-icon>
          </el-button>
          <el-button v-else type="primary" @click="submit">
            <el-icon>
              <Promotion />
            </el-icon>
            提交分析任务
          </el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.new-task-page {
  max-width: 1000px;
  margin: 0 auto;
}

.step-card {
  margin-bottom: 16px;
}

.step-card :deep(.el-card__body) {
  padding: 20px 34px;
}

.form-card :deep(.el-card__body) {
  padding: 0;
}

.step-content {
  max-width: 820px;
  min-height: 430px;
  margin: auto;
  padding: 28px 34px;
}

.step-content.wide {
  max-width: 920px;
}

.step-content.batch-step {
  max-width: 1000px;
  padding-right: 24px;
  padding-left: 24px;
}

.batch-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.naming-panel {
  margin-bottom: 14px;
  padding: 15px 17px 13px;
  border: 1px solid #dce8e5;
  border-radius: 10px;
  background: #f7fbfa;
}

.naming-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.naming-title>div {
  display: grid;
}

.naming-title strong {
  color: #30423f;
  font-size: 12px;
  font-weight: 650;
}

.naming-title span {
  margin-top: 2px;
  color: #899693;
  font-size: 10px;
}

.naming-form {
  display: grid;
  grid-template-columns: minmax(320px, 1fr);
  gap: 12px;
}

.naming-form :deep(.el-form-item) {
  margin-bottom: 10px;
}

.naming-form :deep(.el-input-number),
.naming-form :deep(.el-select) {
  width: 100%;
}

.prefix-field {
  width: 100%;
}

.prefix-input.is-available :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-success) inset;
}

.prefix-input.is-duplicate :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}

.prefix-status-icon {
  font-size: 16px;
}

.prefix-status-icon.is-checking {
  color: var(--el-color-primary);
  animation: prefix-spin 1s linear infinite;
}

.prefix-status-icon.is-available,
.prefix-feedback.is-available {
  color: var(--el-color-success);
}

.prefix-status-icon.is-duplicate,
.prefix-feedback.is-duplicate {
  color: var(--el-color-danger);
}

.prefix-feedback {
  min-height: 18px;
  margin-top: 5px;
  color: #7f8d8a;
  font-size: 10px;
  line-height: 1.4;
}

.prefix-feedback.is-checking {
  color: var(--el-color-primary);
}

.reference-browser {
  overflow: hidden;
  border: 1px solid #dfe7e5;
  border-radius: 10px;
  background: #fff;
}

.reference-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 16px;
  border-bottom: 1px solid #e7eceb;
  background: #f8faf9;
}

.reference-toolbar :deep(.el-input) {
  width: 360px;
}

.reference-toolbar>span {
  color: #82908d;
  font-size: 10px;
}

.reference-table {
  cursor: pointer;
}

.reference-table :deep(.el-radio__label) {
  display: none;
}

.reference-pagination {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 15px;
  border-top: 1px solid #e7eceb;
}

.reference-pagination>span {
  color: #8b9895;
  font-size: 10px;
}

.selected-reference {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-top: 13px;
  padding: 12px 14px;
  border: 1px solid #b8dbd4;
  border-radius: 9px;
  background: #eff8f5;
}

.selected-reference-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 50%;
  background: #d9eee8;
  color: #16806e;
}

.selected-reference>div:nth-child(2) {
  min-width: 0;
  display: grid;
  flex: 1;
}

.selected-reference span,
.selected-reference small {
  color: #71817e;
  font-size: 9px;
}

.selected-reference strong {
  overflow: hidden;
  color: #2c4541;
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes prefix-spin {
  to {
    transform: rotate(360deg);
  }
}

.name-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 6px 10px;
  border-radius: 7px;
  background: #eaf4f1;
  color: #68807b;
  font-size: 10px;
}

.name-preview code {
  padding: 2px 7px;
  border: 1px solid #cae0db;
  border-radius: 5px;
  background: #fff;
  color: #176f61;
  font-family: Consolas, monospace;
  font-size: 10px;
  font-weight: 650;
}

.name-preview small {
  margin-left: auto;
  color: #81908d;
  font-size: 9px;
}

.batch-editor {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 455px;
  overflow: hidden;
  border: 1px solid #dfe7e5;
  border-radius: 10px;
  background: #fff;
}

.task-list {
  padding: 13px 10px;
  border-right: 1px solid #e2e9e8;
  background: #f7f9f9;
}

.task-list-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1px 8px 10px;
  color: #687774;
  font-size: 11px;
  font-weight: 650;
}

.task-list-item,
.add-task-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 6px;
  padding: 10px 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #50605d;
  text-align: left;
  cursor: pointer;
}

.task-list-item:hover {
  background: #fff;
}

.task-list-item.active {
  border-color: #a9d0c9;
  background: #fff;
  box-shadow: 0 2px 7px rgba(32, 83, 75, 0.06);
}

.task-order {
  width: 25px;
  height: 25px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 7px;
  background: #e6eeec;
  color: #69807c;
  font-size: 10px;
  font-weight: 700;
}

.task-list-item.active .task-order {
  background: #167c6b;
  color: #fff;
}

.task-label {
  min-width: 0;
  display: grid;
  flex: 1;
}

.task-label strong {
  overflow: hidden;
  color: #344542;
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-label small {
  color: #93a09d;
  font-size: 9px;
}

.task-valid {
  color: #48a06b;
  font-size: 13px;
}

.add-task-row {
  justify-content: center;
  margin-top: 8px;
  border: 1px dashed #b9cbc8;
  color: #2c8778;
  font-size: 10px;
}

.add-task-row:hover {
  border-color: #54a698;
  background: #eef8f5;
}

.task-editor {
  padding: 18px 21px 20px;
}

.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 17px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e8edec;
}

.editor-heading>div:first-child {
  display: grid;
}

.editor-heading span {
  color: #8b9895;
  font-size: 9px;
}

.editor-heading strong {
  color: #30413e;
  font-size: 14px;
  font-weight: 650;
}

.subsection-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 3px 0 12px;
}

.task-name-field {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px;
}

.subsection-title strong {
  color: #394a47;
  font-size: 12px;
  font-weight: 650;
}

.subsection-title span {
  color: #929e9c;
  font-size: 10px;
}

.task-editor :deep(.el-upload-dragger) {
  padding: 16px 10px;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  margin-bottom: 19px;
}

.section-heading>span {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  color: #167c6b;
  background: #e8f4f2;
  font-size: 11px;
  font-weight: 700;
}

.section-heading h2 {
  margin: 0;
  color: #243533;
  font-size: 16px;
  font-weight: 650;
}

.section-heading p {
  margin: 3px 0 0;
  color: #8b9896;
  font-size: 11px;
}

.type-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px;
}

.type-card {
  position: relative;
  display: flex;
  grid-template-columns: 46px 1fr;
  gap: 13px;
  text-align: left;
  padding: 17px;
  border: 1px solid #e1e8e7;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: 0.15s;
}

.type-card:hover {
  border-color: #86bcb4;
}

.type-card.selected {
  border-color: #3b9788;
  background: #f3faf8;
  box-shadow: 0 0 0 1px #9ac9c1 inset;
}

.type-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.type-icon {
  width: 43px;
  height: 43px;
  display: grid;
  place-items: center;
  border-radius: 10px;
}

.type-card h3 {
  margin: 0;
  color: #293937;
  font-size: 14px;
  font-weight: 650;
}

.type-card small {
  color: #96a29f;
  font-size: 10px;
}

.type-card p {
  margin: 7px 0 0;
  color: #6f7d7a;
  font-size: 11px;
  line-height: 1.45;
}

.selected-icon {
  position: absolute;
  right: 11px;
  top: 11px;
  color: #167c6b;
}

.coming {
  position: absolute;
  right: 8px;
  top: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #eef1f1;
  color: #80908d;
  font-size: 9px;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

.data-type {
  margin-bottom: 17px;
}

.upload-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 15px;
}

.upload-single {
  margin-bottom: 15px;
}

.upload-single :deep(.el-upload),
.upload-single :deep(.el-upload-dragger) {
  width: 100%;
}

.upload-icon {
  color: #4c9b8e;
  font-size: 30px;
}

.upload-title {
  margin: 7px 0 3px;
  color: #344542;
  font-weight: 600;
}

.upload-tip {
  color: #94a09e;
  font-size: 11px;
}

.confirm-step {
  max-width: 900px;
  text-align: center;
}

.confirm-icon {
  width: 60px;
  height: 60px;
  display: grid;
  place-items: center;
  margin: 10px auto 12px;
  border-radius: 50%;
  background: #e7f5f1;
  color: #167c6b;
  font-size: 30px;
}

.confirm-step h2 {
  margin: 0;
  color: #263735;
  font-weight: 650;
}

.confirm-step>p {
  margin: 5px 0 22px;
  color: #82908e;
  font-size: 12px;
}

.summary {
  margin: 0 0 20px;
  text-align: left;
}

.confirm-list {
  margin: 0 0 18px;
  text-align: left;
}

.confirm-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.confirm-list-heading strong {
  color: #42514f;
  font-size: 12px;
  font-weight: 650;
}

.confirm-list-heading span {
  color: #8d9997;
  font-size: 10px;
}

.form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-top: 1px solid #e8edec;
  background: #fafcfc;
  border-radius: 0 0 12px 12px;
}

.form-footer>div {
  display: flex;
  gap: 8px;
}
</style>
