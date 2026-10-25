<script setup lang="ts">
import { computed, onBeforeMount, onScopeDispose, reactive, ref, watch } from 'vue'
import { isAxiosError } from 'axios'
import { ElMessage, genFileId, UploadInstance, UploadProps, UploadRawFile, UploadUserFile } from 'element-plus'
import {
  analysisPipelineTypeCodes,
  canUseBatchPrefix,
  fetchVirusTargets,
  type SequencingPlatform,
  type VirusTarget
} from '../../api/analysisPipeline'
import {
  fetchProjectList,
  BioProject
} from '../../api/bioProject'
import {
  AnalysisTaskDataType,
  setTaskUploadRequest,
  type TaskUploadRequest
} from './taskCreationCommon'
import { RAW_RESPONSE_STATUS_OK } from '../../api/common'
import { prepareBatchFileImport } from './batchFileImport'
import TaskReferenceSelection from '../../components/referenceLibrary/TaskReferenceSelection.vue'
import { useTaskReferenceSelection } from '../../composables/useTaskReferenceSelection'

const emit = defineEmits(['cancel', 'submitted', 'upload'])
const activeSectionId = ref(0)
const activeSectionStack = []
const activeTaskIndex = ref(0)
let taskSequence = 1



interface UserTaskInputSlot {
  r1: UploadUserFile[],
  r2: UploadUserFile[],
  assembly: UploadUserFile[]
  type: AnalysisTaskDataType
}


interface UserCreateAnalysisTask {
  name: string,
  inputSlots: UserTaskInputSlot[]
  type: 0 | 1 | 2
}

interface AnalysisTasksBuildJob {
  projectId: number | null,
  analysisPipelineTypeCode: number | null
  taxId: number | null,
  customerReferenceGenome: UploadUserFile[],
  sequencingPlatform: SequencingPlatform,
  tasks: UserCreateAnalysisTask[]
}



const sequencingPlatformOptions: { label: string; value: SequencingPlatform }[] = [
  { label: '未知（自动识别）', value: 0 },
  { label: 'Illumina', value: 1001 },
  { label: '华大智造 MGI / DNBSEQ', value: 1002 },
  { label: 'Oxford Nanopore（ONT）', value: 2001 },
  { label: 'PacBio', value: 2002 }
]

const batchNamePrefix = ref('')

const r1UploadRef = ref<UploadInstance>(null)
const r2UploadRef = ref<UploadInstance>(null)
const contigUploadRef = ref<UploadInstance>(null)
const batchFilesInput = ref<HTMLInputElement | null>(null)
const batchDirectoryInput = ref<HTMLInputElement | null>(null)
const batchImportSummary = ref<{
  paired: number
  single: number
  ignored: number
  ambiguous: number
  skippedSubdirectoryFiles: number
} | null>(null)

const batchImportMessage = computed(() => {
  const summary = batchImportSummary.value
  if (!summary) return ''

  const messages = [`本次导入：${summary.paired} 个双端任务，${summary.single} 个单端任务。`]
  if (summary.single) messages.push('未能唯一配对的 FASTQ 已按单端导入，请检查文件分配。')
  if (summary.ambiguous) messages.push(`其中 ${summary.ambiguous} 个文件存在多个配对候选，未自动配对。`)
  if (summary.ignored) messages.push(`已忽略 ${summary.ignored} 个非 FASTQ 文件。`)
  if (summary.skippedSubdirectoryFiles) messages.push(`已忽略子目录中的 ${summary.skippedSubdirectoryFiles} 个文件，仅导入当前目录直属文件。`)
  return messages.join(' ')
})


watch(batchNamePrefix, (newBatchName) => {
  analysisTasksBuildJob.tasks.forEach((task, index) => {
    task.name = createTaskName(newBatchName, index)
  })
})

const sectionMap = {
  projectAndAnalysisTypeSelection: 0,
  metagenomeSpecificTypeSelection: 11,
  virusTargetSelection: 2,
  taskCreate: 3,
  comfirmation: 4
}

const analysisTasksBuildJob: AnalysisTasksBuildJob = reactive({
  taxId: computed(() => isVirusAnalysis.value ? selectedVirusTarget.value?.taxId ?? null : null),
  projectId: null,
  analysisPipelineTypeCode: computed(() => {
    if (isVirusAnalysis.value) {
      return selectedVirusTarget.value?.pipelineType ?? null
    }
    for (const item of Object.values(analysisTypes)) {
      if (item.id === pipelineTypeSelection.typeId) {
        if ('code' in item) {
          return item.code
        } else if ('specificTypes' in item) {
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
  sequencingPlatform: 0,
  tasks: []
})

const sequencingPlatformLabel = computed(() =>
  sequencingPlatformOptions.find(
    (option) => option.value === analysisTasksBuildJob.sequencingPlatform
  )?.label ?? '未知（自动识别）'
)


const analysisTaskViewKeysMap = new WeakMap()
function getAnalysisTaskViewKey(task: UserCreateAnalysisTask) {

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

        console.log("checking prefix " + normalizedPrefix)
        const canUseReponse = await canUseBatchPrefix(normalizedPrefix, analysisTasksBuildJob.projectId)

        // 旧请求的结果直接丢弃
        if (sentRequestId !== latestSentRequest) {
          return
        }

        if (canUseReponse.status !== RAW_RESPONSE_STATUS_OK) {
          ElMessage.error(canUseReponse.failMsg)
          batchNamePrefixAvailable.value = -1
          return
        }

        if (canUseReponse.data) {
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

function createTask(source = {}, name): UserCreateAnalysisTask {
  return {
    name: name,
    inputSlots: [{
      r1: [],
      r2: [],
      assembly: [],
      type: 0
    }],
    type: 0
  }
}




analysisTasksBuildJob.tasks.push(createTask(null, createTaskName(batchNamePrefix.value, activeTaskIndex.value)))



const analysisTypes = {
  bacteria: {
    id: 'bacteria',
    title: '细菌全基因组分析',
    subtitle: 'Bacterial WGS',
    icon: 'DataAnalysis',
    color: '#167c6b',
    desc: '细菌全基因组分析流水线包含质量控制、组装、物种鉴定、耐药基因分析、毒力因子及MLST',
    code: analysisPipelineTypeCodes.regularBacteria
  },
  virus: {
    id: 'virus',
    title: '病毒全基因组分析',
    subtitle: 'Viral WGS',
    icon: 'Histogram',
    color: '#456fa8',
    desc: '选择分析目标后，由系统加载候选参考并选择使用的参考；支持新冠及常规病毒分析'
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
    title: '宏基因组 / mNGS分析',
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
        title: 'Shotgun 宏基因组分析',
        subtitle: 'Shotgun Metagenomics',
        desc: '物种组成、功能基因、代谢通路、耐药基因及宏基因组组装分析',
        code: analysisPipelineTypeCodes.metagenomeShotgun
      }
    }
  }
} as const


const pipelineTypeSelection = reactive({
  typeId: null,
  specificTypeId: null
})

const isVirusAnalysis = computed(() => pipelineTypeSelection.typeId === analysisTypes.virus.id)
const virusTargets = ref<VirusTarget[]>([])
const selectedVirusTargetKey = ref<string | null>(null)
const virusTargetsLoading = ref(false)
const virusTargetsLoaded = ref(false)
const virusTargetsError = ref('')
const virusTargetSearch = ref('')
const virusTargetPage = ref(1)
const virusTargetPageSize = 12
let virusTargetsRequestId = 0

function getVirusTargetKey(target: VirusTarget): string {
  return `${target.pipelineType}:${target.taxId}`
}

const selectedVirusTarget = computed(() =>
  virusTargets.value.find((target) => getVirusTargetKey(target) === selectedVirusTargetKey.value) ?? null
)
const virusTargetSelectionReady = computed(() =>
  virusTargetsLoaded.value &&
  !virusTargetsLoading.value &&
  !virusTargetsError.value &&
  selectedVirusTarget.value !== null
)
const {
  candidates: referenceCandidates,
  selectedIds: enabledReferenceIds,
  loading: referenceCandidatesLoading,
  loaded: referenceCandidatesLoaded,
  error: referenceCandidatesError,
  ready: referenceSelectionReady,
  validationMessage: referenceSelectionMessage,
  missingSelectedIds,
  setTarget: setReferenceTarget,
  refresh: refreshReferenceCandidates,
  setSelected: setReferenceSelected,
  selectAll: selectAllReferences,
  clearSelection: clearReferenceSelection,
  removeUnavailableSelection
} = useTaskReferenceSelection()

watch(
  () => isVirusAnalysis.value && selectedVirusTarget.value
    ? getVirusTargetKey(selectedVirusTarget.value)
    : null,
  () => { void setReferenceTarget(isVirusAnalysis.value ? selectedVirusTarget.value : null) },
  { flush: 'sync' }
)
onScopeDispose(() => { virusTargetsRequestId++ })

const filteredVirusTargets = computed(() => {
  const query = virusTargetSearch.value.trim().toLowerCase()
  return virusTargets.value.filter((target) =>
    target.label.toLowerCase().includes(query) || String(target.taxId).includes(query)
  )
})
const pagedVirusTargets = computed(() => {
  const start = (virusTargetPage.value - 1) * virusTargetPageSize
  return filteredVirusTargets.value.slice(start, start + virusTargetPageSize)
})

watch(virusTargetSearch, () => {
  virusTargetPage.value = 1
})

function handleVirusTargetPageChange(page: number) {
  virusTargetPage.value = page
}

function selectVirusTarget(target: VirusTarget) {
  selectedVirusTargetKey.value = getVirusTargetKey(target)
}

async function loadVirusTargets() {
  const requestId = ++virusTargetsRequestId
  virusTargetsLoading.value = true
  virusTargetsLoaded.value = false
  virusTargetsError.value = ''

  try {
    const response = await fetchVirusTargets()
    if (requestId !== virusTargetsRequestId) return
    if (response.status !== RAW_RESPONSE_STATUS_OK) {
      throw new Error(response.failMsg || '加载分析目标失败')
    }

    if (!Array.isArray(response.data)) throw new Error('分析目标列表格式不正确')
    const supportedTargets = response.data.filter(target => target.pipelineType === 100 || target.pipelineType === 101)
    if (supportedTargets.some(target => !Number.isSafeInteger(target.taxId) || target.taxId <= 0 ||
      typeof target.label !== 'string' || !target.label.trim() ||
      (target.pipelineType === 101 && target.taxId !== 2697049))) {
      throw new Error('分析目标列表包含无效的专项信息')
    }
    virusTargets.value = [...new Map(supportedTargets.map(target => [getVirusTargetKey(target), target])).values()]
    virusTargetSearch.value = ''
    virusTargetPage.value = 1
    if (
      selectedVirusTargetKey.value !== null &&
      !virusTargets.value.some((target) => getVirusTargetKey(target) === selectedVirusTargetKey.value)
    ) {
      selectedVirusTargetKey.value = null
      ElMessage.warning('原分析目标已不可选，请重新选择')
    }
    virusTargetsLoaded.value = true
  } catch (error) {
    if (requestId !== virusTargetsRequestId) return
    console.error(error)
    const errorData = isAxiosError(error) ? error.response?.data : null
    virusTargetsError.value =
      (typeof errorData === 'string' ? errorData : errorData?.failMsg) ||
      (error instanceof Error ? error.message : '加载分析目标失败，请重试')
    virusTargets.value = []
    selectedVirusTargetKey.value = null
  } finally {
    if (requestId === virusTargetsRequestId) {
      virusTargetsLoading.value = false
    }
  }
}

const selectedTypeSelectionName = computed(() => {
  const type = Object.values(analysisTypes).find((type) => type.id === pipelineTypeSelection.typeId)
  const specificType = type && 'specificTypes' in type
    ? Object.values(type.specificTypes).find(
      (item) => item.id === pipelineTypeSelection.specificTypeId
    )
    : null
  return {
    typeName: type?.title ?? '--',
    specificTypeName: isVirusAnalysis.value
      ? selectedVirusTarget.value?.label ?? '--'
      : specificType?.title ?? type?.title ?? '--'
  }
})


const selectedProject = computed<BioProject | null>(() => {
  const project = projectList.value.find((project) => { return project.pid === analysisTasksBuildJob.projectId })
  if (project === undefined) {
    return null
  }
  return project
})

const activeTask = computed(() => analysisTasksBuildJob.tasks[activeTaskIndex.value] ?? null)

const projectList = ref<BioProject[]>([])
const projectListLoading = ref(false)

async function initProjectList() {
  projectListLoading.value = true

  try {
    const analysisProjectListResponse = await fetchProjectList()

    if (analysisProjectListResponse.status !== RAW_RESPONSE_STATUS_OK) {
      ElMessage.error('项目列表加载失败' + analysisProjectListResponse.failMsg)
    }

    debugger
    projectList.value = analysisProjectListResponse.data


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

function toUploadUserFile(file: File): UploadUserFile {
  const raw = file as UploadRawFile
  raw.uid = genFileId()
  return {
    name: file.name,
    size: file.size,
    uid: raw.uid,
    status: 'ready',
    raw
  }
}

function getTaskInputSummary(task: UserCreateAnalysisTask): string {
  const slot = task.inputSlots[0]
  const files = slot.type === 2
    ? slot.assembly
    : slot.type === 0 ? [...slot.r1, ...slot.r2] : slot.r1
  return files.map((file) => file.raw?.webkitRelativePath || file.name).join(' / ') || '尚未选择文件'
}

function importBatchFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // Clear the picker so choosing the same files again still fires change.
  input.value = ''
  if (!files.length) return

  const fromDirectory = input.hasAttribute('webkitdirectory')
  const { groups, ignoredFiles, ambiguousFiles, skippedSubdirectoryFiles } =
    prepareBatchFileImport(files, fromDirectory)
  const paired = groups.filter((group) => group.r2 !== null).length
  batchImportSummary.value = {
    paired,
    single: groups.length - paired,
    ignored: ignoredFiles.length,
    ambiguous: ambiguousFiles.length,
    skippedSubdirectoryFiles
  }

  if (!groups.length) {
    ElMessage.warning(fromDirectory
      ? '当前目录没有可导入的 FASTQ 文件，子目录文件不导入'
      : '未找到 FASTQ 文件，请选择 .fastq、.fq 或对应的 .gz 文件')
    return
  }

  const tasks = analysisTasksBuildJob.tasks
  const replaceEmptyTask = tasks.length === 1 && tasks[0].inputSlots.every((slot) =>
    slot.r1.length === 0 && slot.r2.length === 0 && slot.assembly.length === 0
  )
  const startIndex = replaceEmptyTask ? 0 : tasks.length
  const importedTasks = groups.map((group, index): UserCreateAnalysisTask => {
    const type: AnalysisTaskDataType = group.r2 ? 0 : 1
    return {
      name: createTaskName(batchNamePrefix.value, startIndex + index),
      type,
      inputSlots: [{
        r1: [toUploadUserFile(group.r1)],
        r2: group.r2 ? [toUploadUserFile(group.r2)] : [],
        assembly: [],
        type
      }]
    }
  })

  if (replaceEmptyTask) tasks.splice(0, 1)
  for (const task of importedTasks) tasks.push(task)
  activeTaskIndex.value = startIndex
}

function removeTask(index: number) {
  analysisTasksBuildJob.tasks.splice(index, 1)
  if (index < activeTaskIndex.value) {
    activeTaskIndex.value--
  }
  activeTaskIndex.value = Math.max(0, Math.min(activeTaskIndex.value, analysisTasksBuildJob.tasks.length - 1))
  batchImportSummary.value = null

  analysisTasksBuildJob.tasks.forEach((task, index) => {
    task.name = createTaskName(batchNamePrefix.value, index)
  })

}

function clearTasks() {
  analysisTasksBuildJob.tasks.splice(0)
  activeTaskIndex.value = 0
  batchImportSummary.value = null
}

function uploadedFileCount(task) {
  if (task.type === 0) return task.r1Files.length + task.r2Files.length
  return 0
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
  if (!batchNamePrefix.value.trim()) {
    return `未命名任务 ${index + 1}`
  }

  return task.name
}

function doCheckForBuildJobBeforeConfirmation() {
  if (analysisTasksBuildJob.tasks.length === 0) {
    return {
      satisfied: false,
      msg: '请至少添加一个任务或批量导入文件'
    }
  }

  if (isVirusAnalysis.value && !referenceSelectionReady.value) {
    return { satisfied: false, msg: referenceSelectionMessage.value || '请确认本批次参考范围' }
  }

  if (!batchNamePrefix?.value.trim()) {
    return {
      satisfied: false,
      msg: '未给任务命名'
    }
  }

  const notSatisfiedTaskList =
    analysisTasksBuildJob.tasks.filter((task) => {
      switch (task.inputSlots[0].type) {
        case 0:
          return task.inputSlots[0].r1.length < 1 || task.inputSlots[0].r2.length < 1

        case 1:
          return task.inputSlots[0].r1.length < 1

        case 2:
          return task.inputSlots[0].assembly.length < 1

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
    satisfied = selectedProject.value !== null && pipelineTypeSelection.typeId !== null
    msg = '请选择项目和分析任务类型'
  } else if (currentSectionId === sectionMap.virusTargetSelection) {
    satisfied = virusTargetSelectionReady.value && referenceSelectionReady.value
    msg = !virusTargetSelectionReady.value
      ? '请加载并选择有效的分析目标'
      : referenceSelectionMessage.value || '请确认本批次参考范围'
  } else if (currentSectionId === sectionMap.metagenomeSpecificTypeSelection) {
    satisfied = !!pipelineTypeSelection.specificTypeId
    msg = '请选择具体类型'
  }
  else if (currentSectionId === sectionMap.taskCreate) {
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
      return sectionMap.virusTargetSelection
    }
    if (pipelineTypeSelection.typeId === analysisTypes.metagenome.id) {
      return sectionMap.metagenomeSpecificTypeSelection
    }
  }

  if (currentSectionId === sectionMap.virusTargetSelection) {
    return sectionMap.taskCreate
  }

  if (currentSectionId === sectionMap.metagenomeSpecificTypeSelection) {
    return sectionMap.taskCreate
  }

  if (currentSectionId === sectionMap.taskCreate) {
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

function getRawFile(
  files: UploadUserFile[]
): File | null {
  return files[0]?.raw ?? null
}

function submit() {
  const { satisfied, msg } = doCheckForBuildJobBeforeConfirmation()
  if (!satisfied) {
    ElMessage.warning(msg)
    return
  }
  if (isVirusAnalysis.value && !virusTargetSelectionReady.value) {
    ElMessage.warning('请加载并选择有效的分析目标')
    return
  }
  if (
    !selectedProject.value ||
    analysisTasksBuildJob.analysisPipelineTypeCode === null
  ) {
    ElMessage.warning('任务创建信息不完整')
    return
  }

  const request: TaskUploadRequest = {
    project: selectedProject.value,
    referenceGenome: null,
    virusTarget: isVirusAnalysis.value ? { ...selectedVirusTarget.value } : null,
    ...(isVirusAnalysis.value ? { enabledReferenceIds: [...enabledReferenceIds.value] } : {}),
    analysisType: analysisTasksBuildJob.analysisPipelineTypeCode,
    customerReferenceGenome: null,
    tasks: analysisTasksBuildJob.tasks.map((task) => ({
      name: task.name,
      sequencingPlatform: analysisTasksBuildJob.sequencingPlatform ?? 0,
      type: task.inputSlots[0].type,
      inputSlots: task.inputSlots.map((slot) => {
        return {
          r1: getRawFile(slot.r1),
          r2: getRawFile(slot.r2),
          contigs: getRawFile(slot.assembly),
          type: slot.type
        }
      })
    }))
  }

  setTaskUploadRequest(request)
  emit('upload')
}

const uploadProps = {
  autoUpload: false,
  action: '#',
  showFileList: true,
  limit: 1
}

function replaceWithNewFile(files, uploadInstance: UploadInstance) {

  uploadInstance.clearFiles()

  const file = files[0] as UploadRawFile
  file.uid = genFileId()
  uploadInstance.handleStart(file)

}

onBeforeMount(() => {
  initProjectList()
  loadVirusTargets()
})

function calculateActiveStep() {


  const activeZeroSections = [sectionMap.projectAndAnalysisTypeSelection, sectionMap.metagenomeSpecificTypeSelection]
  if (activeZeroSections.some(sectionId => sectionId === activeSectionId.value)) { return 0 }
  if (activeSectionId.value === sectionMap.virusTargetSelection) {
    return 1
  }

  if (activeSectionId.value === sectionMap.taskCreate) {
    return 2
  }
  if (activeSectionId.value === sectionMap.comfirmation) {
    return 3
  }
}

function canMoveBackward() {
  return activeSectionStack.length > 0
}

function hasNextSection() {
  return sectionMap.comfirmation !== activeSectionId.value
}

function selectAnalysisType(id: string) {
  if (pipelineTypeSelection.typeId !== id) {
    pipelineTypeSelection.specificTypeId = null
  }
  pipelineTypeSelection.typeId = id
}

function moveSectionBackward() {
  const lastSectionId = activeSectionStack.pop()
  activeSectionId.value = lastSectionId
}

function selectSpeceficType(speceficTypeId) {
  pipelineTypeSelection.specificTypeId = speceficTypeId
}


</script>

<template>
  <div class="new-task-page">
    <el-card shadow="never" class="step-card">
      <el-steps :active="calculateActiveStep()" align-center finish-status="success">
        <el-step title="项目与分析类型" description="选择流程" />
        <el-step title="分析目标" description="病毒分析时选择" />
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
                v-for="item in projectList" :key="item.pid" :label="item.projectName"
                :value="item.pid" /></el-select></el-form-item></el-form>
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

      <div v-else-if="activeSectionId === sectionMap.metagenomeSpecificTypeSelection"
        class="step-content">
        <div class="section-heading">
          <div>
            <h2>选择宏基因分析类型</h2>
          </div>
        </div>

        <div class="type-grid">
          <button v-for="(specificType, typeId) in analysisTypes.metagenome.specificTypes" :key="typeId" type="button"
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

      <!-- <div v-else-if="activeSectionId === sectionMap.metagenomeSpecificTypeSelection" class="step-content">

        <div class="section-heading">
          <div>
            <h2>选择宏基因分析流程</h2>
          </div>
        </div>

        <div class="type-grid">
          <button type="button" :class="['type-card'], {selected: }">

          </button>
        </div>
      </div> -->



      <div v-else-if="activeSectionId === sectionMap.virusTargetSelection" class="step-content">
        <div class="section-heading">
          <span>01</span>
          <div>
            <h2>选择分析目标</h2>
            <p>本批次任务使用同一个分析目标，系统会加载该目标的候选参考，并在分析时选择使用的参考。</p>
          </div>
        </div>

        <div class="virus-target-toolbar">
          <el-input
            v-model="virusTargetSearch"
            clearable
            placeholder="搜索目标名称或 Tax ID"
            aria-label="搜索分析目标"
            :disabled="virusTargetsLoading || !virusTargetsLoaded"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button :loading="virusTargetsLoading" @click="loadVirusTargets">
            <el-icon v-if="!virusTargetsLoading"><Refresh /></el-icon>
            {{ virusTargetsError ? '重新加载' : '刷新列表' }}
          </el-button>
        </div>
        <el-alert v-if="virusTargetsLoading" title="正在加载分析目标..." type="info" :closable="false" show-icon />
        <el-alert
          v-else-if="virusTargetsError"
          title="分析目标加载失败"
          :description="virusTargetsError"
          type="error"
          :closable="false"
          show-icon
        />
        <el-empty v-else-if="virusTargetsLoaded && !virusTargets.length" description="暂无可选分析目标" />
        <template v-else-if="virusTargetsLoaded">
          <el-empty v-if="!filteredVirusTargets.length" description="未找到匹配的分析目标，请调整搜索条件" />
          <template v-else>
            <div class="virus-target-grid" role="group" aria-label="分析目标（单选）">
              <button
                v-for="target in pagedVirusTargets"
                :key="getVirusTargetKey(target)"
                type="button"
                :class="['type-card', 'virus-target-card', { selected: selectedVirusTargetKey === getVirusTargetKey(target) }]"
                :aria-pressed="selectedVirusTargetKey === getVirusTargetKey(target)"
                @click="selectVirusTarget(target)"
              >
                <span class="virus-target-name">{{ target.label }}</span>
                <small>Tax ID {{ target.taxId }}</small>
                <el-icon v-if="selectedVirusTargetKey === getVirusTargetKey(target)" class="selected-icon">
                  <CircleCheckFilled />
                </el-icon>
              </button>
            </div>
            <div class="virus-target-pagination">
              <span>共 {{ filteredVirusTargets.length }} 个目标 · 每页 {{ virusTargetPageSize }} 项</span>
              <el-pagination
                :current-page="virusTargetPage"
                :page-size="virusTargetPageSize"
                :total="filteredVirusTargets.length"
                :pager-count="5"
                background
                layout="prev, pager, next"
                @current-change="handleVirusTargetPageChange"
              />
            </div>
          </template>
        </template>

        <div v-if="selectedVirusTarget && virusTargetSelectionReady" class="selected-reference">
          <div class="selected-reference-icon">
            <el-icon>
              <CircleCheckFilled />
            </el-icon>
          </div>
          <div>
            <span>已选择分析目标</span>
            <strong>{{ selectedVirusTarget.label }}</strong>
            <small>
              Tax ID {{ selectedVirusTarget.taxId }} ·
              {{ selectedVirusTarget.pipelineType === analysisPipelineTypeCodes.virusCovid ? '新冠病毒分析流程' : '常规病毒分析流程' }}
            </small>
          </div>
          <el-button link type="primary" @click="selectedVirusTargetKey = null">
            清除选择
          </el-button>
        </div>
        <TaskReferenceSelection
          v-if="selectedVirusTarget && virusTargetSelectionReady"
          :candidates="referenceCandidates"
          :selected-ids="enabledReferenceIds"
          :loading="referenceCandidatesLoading"
          :loaded="referenceCandidatesLoaded"
          :error="referenceCandidatesError"
          :validation-message="referenceSelectionMessage"
          :missing-selected-ids="missingSelectedIds"
          @refresh="refreshReferenceCandidates"
          @select="setReferenceSelected"
          @select-all="selectAllReferences"
          @clear-selection="clearReferenceSelection"
          @remove-unavailable="removeUnavailableSelection"
        />
      </div>

      <div v-else-if="activeSectionId === sectionMap.taskCreate" class="step-content batch-step">
        <div class="batch-heading">
          <div class="section-heading">
            <span>01</span>
            <div>
              <h2>创建分析任务</h2>
              <p>同一批次使用相同的分析类型和流程参数，每个任务独立上传数据</p>
            </div>
          </div>
          <div class="batch-heading-actions">
            <el-popconfirm
              title="清空本批次的所有任务和已选文件？批次设置将保留。"
              :width="280"
              confirm-button-text="清空"
              cancel-button-text="取消"
              @confirm="clearTasks"
            >
              <template #reference>
                <el-button type="danger" plain :disabled="analysisTasksBuildJob.tasks.length === 0">
                  清空任务
                </el-button>
              </template>
            </el-popconfirm>
            <el-button type="primary" plain @click="addTask()">
              <el-icon>
                <Plus />
              </el-icon>添加任务
            </el-button>
          </div>
        </div>

        <div class="naming-panel">
          <div class="naming-title">
            <div>
              <strong>批次设置</strong><span>统一设置本批次的任务名称前缀和测序平台，任务名称按顺序自动编号</span>
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
                  <span v-else-if='batchNamePrefixAvailable === 1'>该前缀已在当前项目中使用，请更换</span>
                </div>
              </div>
            </el-form-item>
            <el-form-item label="测序平台">
              <div class="sequencing-platform-field">
                <el-select
                  v-model="analysisTasksBuildJob.sequencingPlatform"
                  clearable
                  placeholder="未知（自动识别）"
                  @clear="analysisTasksBuildJob.sequencingPlatform = 0"
                >
                  <el-option
                    v-for="option in sequencingPlatformOptions"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <p class="sequencing-platform-tip">
                  请选择生成测序数据的平台。不确定时请选择“未知（自动识别）”，由系统尝试识别。
                </p>
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

        <div class="batch-import-panel">
          <div class="batch-import-heading">
            <div>
              <strong>批量导入测序文件</strong>
              <p>每对 R1 / R2 创建一个双端任务，未配对文件创建单端任务，导入后可手动调整。</p>
            </div>
            <div class="batch-import-actions">
              <el-button type="primary" plain @click="batchFilesInput?.click()">
                <el-icon><Files /></el-icon>多选文件
              </el-button>
              <el-button plain @click="batchDirectoryInput?.click()">
                <el-icon><FolderOpened /></el-icon>选择目录
              </el-button>
            </div>
          </div>
          <input
            ref="batchFilesInput"
            type="file"
            accept=".fastq,.fq,.fastq.gz,.fq.gz"
            multiple
            hidden
            @change="importBatchFiles"
          />
          <input
            ref="batchDirectoryInput"
            type="file"
            webkitdirectory
            multiple
            hidden
            @change="importBatchFiles"
          />
          <p class="batch-import-tip">
            支持 .fastq / .fq / .fastq.gz / .fq.gz，按 sample_R1 / sample_R2、sample_1 / sample_2
            或 sample_R1_001 / sample_R2_001 配对。仅匹配本次选取的文件；选择目录时只导入当前目录直属文件，忽略所有子目录；不同 lane 分别创建任务。
          </p>
          <p class="batch-import-tip">导入会追加到任务列表，沿用批次前缀编号；只替换初始的单个空任务，已有文件保留。</p>
          <el-alert
            v-if="batchImportSummary"
            :title="batchImportMessage"
            :type="batchImportSummary.single || batchImportSummary.ignored || batchImportSummary.skippedSubdirectoryFiles ? 'warning' : 'success'"
            :closable="false"
            show-icon
          />
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
                  item.inputSlots[0].type
                  ]
                }}</small>
                <small class="task-source" :title="getTaskInputSummary(item)">{{ getTaskInputSummary(item) }}</small>
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

          <section v-if="activeTask" class="task-editor">
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
            <el-radio-group v-model="activeTask.inputSlots[0].type" class="data-type">
              <el-radio-button :value='0'>双端测序 FASTQ</el-radio-button>
              <el-radio-button :value='1'>单端测序 FASTQ</el-radio-button>
              <el-radio-button :value='2'>已组装 Contigs</el-radio-button>
            </el-radio-group>
            <div v-if="activeTask.inputSlots[0].type === 0" class="upload-grid">
              <el-upload ref="r1UploadRef" v-model:file-list="activeTask.inputSlots[0].r1" drag v-bind="uploadProps"
                :on-exceed="(files) => { replaceWithNewFile(files, r1UploadRef) }">
                <el-icon class="upload-icon">
                  <UploadFilled />
                </el-icon>
                <div class="upload-title">上传 R1 文件</div>
                <div class="upload-tip">正向 reads，支持 .fastq / .fq / .gz</div>
              </el-upload>
              <el-upload ref="r2UploadRef" v-model:file-list="activeTask.inputSlots[0].r2" drag v-bind="uploadProps"
                :on-exceed="(files) => { replaceWithNewFile(files, r2UploadRef) }">
                <el-icon class="upload-icon">
                  <UploadFilled />
                </el-icon>
                <div class="upload-title">上传 R2 文件</div>
                <div class="upload-tip">反向 reads，需与 R1 成对</div>
              </el-upload>
            </div>
            <div v-else-if="activeTask.inputSlots[0].type === 1" class="upload-single">
              <el-upload ref="r1UploadRef" v-model:file-list="activeTask.inputSlots[0].r1" drag v-bind="uploadProps"
                :on-exceed="(files) => { replaceWithNewFile(files, r1UploadRef) }">
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
              <el-upload ref="contigUploadRef" v-model:file-list="activeTask.inputSlots[0].assembly" drag
                v-bind="uploadProps" :on-exceed="(files) => { replaceWithNewFile(files, contigUploadRef) }">
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
            <el-alert
              v-if="activeTask.inputSlots[0].type === 2 && pipelineTypeSelection.typeId === analysisTypes.virus.id"
              title="使用已组装数据时，系统将只使用参考基因组进行序列比较" type="info" :closable="false" show-icon />
          </section>
          <section v-else class="task-editor task-editor-empty">
            <el-empty description="暂无任务" :image-size="100">
              <p class="empty-task-tip">添加一个任务，或通过上方“多选文件”“选择目录”批量导入。</p>
              <el-button type="primary" plain @click="addTask()">添加任务</el-button>
            </el-empty>
          </section>
        </div>
      </div>

      <div v-else-if="activeSectionId === sectionMap.comfirmation" class="step-content confirm-step">
        <div class="confirm-icon">
          <el-icon>
            <DocumentChecked />
          </el-icon>
        </div>
        <h2>确认任务信息</h2>
        <p>本批次包含 {{ analysisTasksBuildJob.tasks.length }} 个任务，提交后将分别进入分析队列。</p>
        <el-descriptions :column="2" border class="summary">
          <el-descriptions-item label="所属项目">{{ selectedProject.projectName }}</el-descriptions-item>
          <el-descriptions-item label="分析类型">{{ selectedTypeSelectionName.typeName }}</el-descriptions-item>
          <el-descriptions-item :label="isVirusAnalysis ? '分析目标' : '具体类型'">
            {{ selectedTypeSelectionName.specificTypeName }}
          </el-descriptions-item>
          <el-descriptions-item label="任务名称前缀">{{ batchNamePrefix }}</el-descriptions-item>
          <el-descriptions-item label="测序平台">{{ sequencingPlatformLabel }}</el-descriptions-item>
          <el-descriptions-item label="任务数量">{{ analysisTasksBuildJob.tasks.length }} 个</el-descriptions-item>
          <el-descriptions-item
            v-if="isVirusAnalysis"
            label="目标 Tax ID">
            {{ analysisTasksBuildJob.taxId ?? '--' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="isVirusAnalysis" label="本批次参考范围">
            已选 {{ enabledReferenceIds.length }} / 共 {{ referenceCandidates.length }} 条（仅本批次生效）
          </el-descriptions-item>
        </el-descriptions>
        <el-alert v-if="isVirusAnalysis && !referenceSelectionReady" :title="referenceSelectionMessage"
          type="warning" :closable="false" show-icon />
        <div class="confirm-list">
          <div class="confirm-list-heading">
            <strong>本次创建的任务</strong><span>共 {{ analysisTasksBuildJob.tasks.length }} 项</span>
          </div>
          <el-table :data="analysisTasksBuildJob.tasks" max-height="240" border>
            <el-table-column type="index" label="#" width="48" />
            <el-table-column label="任务名称" min-width="180">
              <template #default="{ row, $index }">
                {{ row.name }}
                <el-tag v-if="row.customName" size="small" type="info">自定义</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="任务描述" min-width="180">
              <template #default="{ row }">{{ row.description || '--' }}</template>
            </el-table-column>
            <el-table-column label="数据类型" min-width="145">
              <template #default="{ row, $index }">
                <span v-if="$index >= 0">
                  {{
                    { 0: '双端测序 FASTQ', 1: '单端测序 FASTQ', 2: '已组装 Contigs' }[
                    row.inputSlots[0].type
                    ]
                  }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="文件" min-width="240" show-overflow-tooltip>
              <template #default="{ row, $index }">
                <span v-if="$index >= 0">{{ getTaskInputSummary(row) }}</span>
              </template>
            </el-table-column>
            <!-- <el-table-column label="文件" width="110">
              <template #default="{ row }">
                <el-tag v-if="uploadReady(row)" type="success" size="small">
                  {{ uploadedFileCount(row) }} 个文件
                </el-tag>
                <el-tag v-else type="warning" size="small">待补充</el-tag>
              </template>
            </el-table-column> -->
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
          <el-button
            v-if="hasNextSection()"
            type="primary"
            :disabled="
              (activeSectionId === sectionMap.virusTargetSelection && (!virusTargetSelectionReady || !referenceSelectionReady)) ||
              (activeSectionId === sectionMap.taskCreate && analysisTasksBuildJob.tasks.length === 0)
            "
            @click="next"
          >
            下一步
            <el-icon>
              <ArrowRight />
            </el-icon>
          </el-button>
          <el-button v-else type="primary"
            :disabled="analysisTasksBuildJob.tasks.length === 0 || (isVirusAnalysis && (!virusTargetSelectionReady || !referenceSelectionReady))"
            @click="submit">
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
  flex-wrap: wrap;
  gap: 12px;
}

.batch-heading-actions {
  display: flex;
  flex-shrink: 0;
  margin-bottom: 14px;
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

.sequencing-platform-field {
  width: 100%;
}

.sequencing-platform-tip {
  margin: 6px 0 0;
  color: #71817e;
  font-size: 12px;
  line-height: 1.6;
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

.virus-target-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.virus-target-toolbar :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.virus-target-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.virus-target-grid .virus-target-card {
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
  min-height: 96px;
  padding: 16px;
  gap: 10px;
}

.virus-target-card:focus-visible {
  outline: 2px solid #167c6b;
  outline-offset: 3px;
}

.virus-target-name {
  padding-right: 18px;
  color: #293937;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.virus-target-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

.virus-target-pagination>span {
  color: #82908d;
  font-size: 12px;
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

.batch-import-panel {
  margin-bottom: 14px;
  padding: 15px 17px;
  border: 1px solid #dce8e5;
  border-radius: 10px;
  background: #f7fbfa;
}

.batch-import-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.batch-import-heading strong {
  color: #30423f;
  font-size: 13px;
}

.batch-import-heading p,
.batch-import-tip {
  margin: 5px 0 0;
  color: #71817e;
  font-size: 12px;
  line-height: 1.6;
}

.batch-import-actions {
  display: flex;
  flex-shrink: 0;
}

.batch-import-panel :deep(.el-alert) {
  margin-top: 12px;
}

.task-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.task-editor-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-task-tip {
  margin: 0 0 16px;
  color: #899693;
  font-size: 12px;
  line-height: 1.6;
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
