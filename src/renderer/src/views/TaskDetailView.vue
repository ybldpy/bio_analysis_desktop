<script setup lang="ts">
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import StatusTag from '../components/StatusTag.vue'
import { pipelineNodes, resultFiles, tasks } from '../data/mockData'
import type {
  AnalysisPipeline,
  AnalysisPipelineStage
} from '../common/analysisPipeline.js'
import {
  analysisPipelineStageStatus,
  analysisPipelineTypeCodes,
  doComfirmTaxonomy,
  PipelineInput,
  pipelineStageTypeCode,
  pipelineStatusCode,
  pipelineTypeCode,
  requestPipeline,
  requestPipelineStages,
  taxonomyResultStatusCode
} from '../api/analysisPipeline'
import { ElMessage } from 'element-plus'
import { Graph, Selection } from '@antv/x6'
import { getAnalysisPipelineTypeName } from '../common/analysisPipeline.js'
import { prop } from '@antv/x6/lib/common/dom/prop.js'
import { RAW_RESPONSE_STATUS_OK } from '../api/common.js'
import { API_BASE_URL, backendAPI, backendService } from '../api/backendService.js'
import { line } from '@antv/x6/lib/registry/port-layout/line.js'



Graph.registerNode(
  'pipeline-stage',
  {
    inherit: 'rect',
    width: 170,
    height: 64,

    markup: [
      {
        tagName: 'rect',
        selector: 'body'
      },
      {
        tagName: 'circle',
        selector: 'statusBadge'
      },
      {
        tagName: 'text',
        selector: 'statusIcon'
      },
      {
        tagName: 'text',
        selector: 'stageName'
      },
      {
        tagName: 'text',
        selector: 'statusLabel'
      }
    ],

    attrs: {
      body: {
        refWidth: '100%',
        refHeight: '100%',
        fill: '#ffffff',
        stroke: '#dcdfe6',
        strokeWidth: 1.5,
        rx: 9,
        ry: 9
      },

      statusBadge: {
        cx: 23,
        cy: 32,
        r: 13,
        fill: '#909399'
      },

      statusIcon: {
        x: 23,
        y: 32,
        fill: '#ffffff',
        fontSize: 15,
        fontWeight: 700,
        textAnchor: 'middle',
        textVerticalAnchor: 'middle'
      },

      stageName: {
        x: 46,
        y: 25,
        fill: '#303133',
        fontSize: 13,
        fontWeight: 600,
        textAnchor: 'start'
      },

      statusLabel: {
        x: 46,
        y: 44,
        fill: '#909399',
        fontSize: 10,
        textAnchor: 'start'
      }
    }
  },
  true
)


const props = defineProps<{
  pipelineId: number

}>()
const emit = defineEmits(['back'])
const activeTab = ref('pipeline')
const selectedNodeId = ref('species')
const logVisible = ref(false)
const selectedNode = computed(() => pipelineNodes.find((item) => item.id === selectedNodeId.value))
const pipelineLoading = ref(true)
const initPipelineAndStagesFailed = ref(false)




type StageStatus = 'waitting' | 'running' | 'failed' | 'actionRequired' | 'notApplicable'


interface StageNodeAppearance {
  label: string
  icon: string
  color: string
  background: string
  borderDasharray?: string
  opacity?: number
  className?: string
}



interface Taxon {
  taxid: number
  name: string
  score: number
}

interface TaxonomyOutput {
  status: number
  best: Taxon
  candidates: Taxon[]
}

interface StageResult {
  displayName: string | null
  resultOutputName: string | null
  resultOutputUrl: string | null
  resultOutputObject: null | TaxonomyOutput
  downloading: boolean
}


interface PipelineDependencyConfig {
  entries: number[],
  stagesDependency: Record<number, number[]>
}

const pipelineDependencyConfigs = {
  regularVirusRead: {
    entries: [pipelineStageTypeCode.readInspect],
    stagesDependency: {
      [pipelineStageTypeCode.qc]: [pipelineStageTypeCode.readInspect],
      [pipelineStageTypeCode.mapping]: [pipelineStageTypeCode.qc],
      [pipelineStageTypeCode.variantCall]: [pipelineStageTypeCode.mapping],
      [pipelineStageTypeCode.consensus]: [pipelineStageTypeCode.variantCall]
    }
  },
  regularVirusAssembly: {
    entries: [pipelineStageTypeCode.referenceComparison],
    stagesDependency: {

    }
  },
  covid19: {
    entries: [pipelineStageTypeCode.readInspect],
    stagesDependency: {
      [pipelineStageTypeCode.qc]: [pipelineStageTypeCode.readInspect],
      [pipelineStageTypeCode.mapping]: [pipelineStageTypeCode.qc],
      [pipelineStageTypeCode.variantCall]: [pipelineStageTypeCode.mapping],
      [pipelineStageTypeCode.consensus]: [pipelineStageTypeCode.variantCall],
      [pipelineStageTypeCode.snpAnnotation]: [pipelineStageTypeCode.variantCall]
    }
  },
  bacteriaRead: {
    entries: [pipelineStageTypeCode.readInspect],
    stagesDependency: {
      [pipelineStageTypeCode.qc]: [pipelineStageTypeCode.readInspect],
      [pipelineStageTypeCode.assembly]: [pipelineStageTypeCode.qc],
      [pipelineStageTypeCode.taxonomy]: [pipelineStageTypeCode.assembly],
      [pipelineStageTypeCode.amr]: [pipelineStageTypeCode.assembly],
      [pipelineStageTypeCode.virulence]: [pipelineStageTypeCode.assembly],
      [pipelineStageTypeCode.mlst]: [pipelineStageTypeCode.assembly],
      [pipelineStageTypeCode.cgmlst]: [pipelineStageTypeCode.taxonomy],
      [pipelineStageTypeCode.serotype]: [pipelineStageTypeCode.taxonomy]
    }
  },
  bacteriaAssembly: {
    entries: [pipelineStageTypeCode.taxonomy, pipelineStageTypeCode.amr, pipelineStageTypeCode.virulence, pipelineStageTypeCode.mlst],
    stagesDependency: {
      [pipelineStageTypeCode.cgmlst]: [pipelineStageTypeCode.taxonomy],
      [pipelineStageTypeCode.serotype]: [pipelineStageTypeCode.taxonomy]
    }
  }
} satisfies Record<string, PipelineDependencyConfig>

const stageNodeAppearance: Record<
  number,
  StageNodeAppearance
> = {
  [analysisPipelineStageStatus.pending]: {
    label: '等待中',
    icon: '…',
    color: '#909399',
    background: '#f5f7fa'
  },
  [analysisPipelineStageStatus.queuing]: {
    label: '等待中',
    icon: '…',
    color: '#909399',
    background: '#f5f7fa'
  },

  [analysisPipelineStageStatus.running]: {
    label: '运行中',
    icon: '↻',
    color: '#409eff',
    background: '#ecf5ff',
    className: 'pipeline-node-running'
  },

  [analysisPipelineStageStatus.completed]: {
    label: '已完成',
    icon: '✓',
    color: '#67c23a',
    background: '#f0f9eb'
  },

  [analysisPipelineStageStatus.failed]: {
    label: '失败',
    icon: '×',
    color: '#f56c6c',
    background: '#fef0f0'
  },

  [analysisPipelineStageStatus.actionRequired]: {
    label: '需要处理',
    icon: '!',
    color: '#e6a23c',
    background: '#fdf6ec'
  },

  [analysisPipelineStageStatus.notApplicable]: {
    label: '不适用',
    icon: '—',
    color: '#a8abb2',
    background: '#f5f7fa',
    borderDasharray: '5 3',
    opacity: 0.7
  }
}


const analysisPipeline = ref<AnalysisPipeline | null>(null)
const pipelineStages = ref<AnalysisPipelineStage[]>([])
const currentFocusStage = ref<AnalysisPipelineStage | null>(null)
const flowGraphContainer = ref<HTMLElement | null>(null)
let flowGraph: Graph | null = null
const pipelineStagesResultsMap = ref<Map<number, StageResult[]>>(new Map())



function getStageResultDisplayName(outputKey, stageType) {
  const displayNameMap = {
    r1: '质控后 Read1 数据',
    r2: '质控后 Read2 数据',
    html: '质控后html文件',
    json: '质控后json文件',
    amr: '耐药性分析结果',
    serotype: '血清型分析结果',
    mlst: 'MLST 分型结果',
    bam: '序列比对结果',
    bamIndex: '序列比对索引',
    vcfgz: '压缩变异检测结果',
    vcftbi: '变异检测结果索引',
    coverageDepth: '测序覆盖深度',
    consensus: '一致性序列',
    annotatedvcf: '变异注释结果',
    pafpath: '序列比对结果（PAF）',
    differencepath: '序列差异分析结果'

  }

  const normalizedKey = outputKey.toLocaleLowerCase().trim()
  const displayName = Object.entries(displayNameMap).find(([key, value]) => normalizedKey.includes(key))
  return displayName === undefined ? '--' : displayName[1]
}




function createStageResults(pipelineStage: AnalysisPipelineStage, stageResults: StageResult[]) {





  const stage = pipelineStage

  if (stage.status !== analysisPipelineStageStatus.completed && stage.status !== analysisPipelineStageStatus.actionRequired) {
    return
  }

  let inlineOutput = null


  if (stage.stageType === pipelineStageTypeCode.readInspect) {
    return
  }
  else if (stage.stageType === pipelineStageTypeCode.taxonomy) {
    inlineOutput = stage.output.inline
    stageResults.push({
      displayName: '--',
      resultOutputName: '--',
      resultOutputUrl: '#',
      resultOutputObject: (inlineOutput as TaxonomyOutput),
      downloading: false
    })
  } else {
    Object.entries(stage.output.urls).forEach(([key, url]) => {
      if (url === null || url === undefined) {
        return
      }



      stageResults.push({
        displayName: getStageResultDisplayName(key, stage.stageType),
        resultOutputName: url.substring(url.lastIndexOf("/") + 1),
        resultOutputUrl: url,
        resultOutputObject: null,
        downloading: false
      })
    })
  }

}

function updateStageResults(pipelineStage: AnalysisPipelineStage) {

  const stageResults = pipelineStagesResultsMap.value.get(pipelineStage.stageId)
  stageResults.splice(0, stageResults.length)
  createStageResults(pipelineStage, stageResults)
}



const allFinishedResultsViewList = computed(() => {

  const resultViewList = []
  const finishedStages = pipelineStages.value.filter((stage) => { return stage.status === analysisPipelineStageStatus.completed })
  pipelineStagesResultsMap.value.forEach((stageResults, stageId) => {
    const stage = finishedStages.find(stage => stage.stageId === stageId)
    if (!stage) {
      console.log('error: not find target stage: ' + stageId)
      return
    }
    if (stageResults.length < 1 || stage.stageType === pipelineStageTypeCode.readInspect || stage.stageType === pipelineStageTypeCode.taxonomy) {
      return
    }
    resultViewList.push(...stageResults.map((stageResult) => {
      return {
        stageName: stage.stageName,
        result: stageResult
      }
    }))
  })


  return resultViewList
})

watch(pipelineStages, (newStageList, oldStageList) => {

  if (newStageList.length < 1) {
    return
  }

  pipelineStages.value.forEach((stage) => {

    let inlineOutput = null
    let output: StageResult[] = []
    pipelineStagesResultsMap.value.set(stage.stageId, output)

    createStageResults(stage, pipelineStagesResultsMap.value.get(stage.stageId))
  })


}, { flush: 'post' })



function getCurrentPipelineDependencyConfig():
  | PipelineDependencyConfig
  | null {


  let isInputReadLevel = false

  if (analysisPipeline.value.pipelineType === analysisPipelineTypeCodes.virusCovid) {
    isInputReadLevel = true
  } else {
    isInputReadLevel = pipelineStages.value.some((stage) => stage.stageType === pipelineStageTypeCode.qc || stage.stageType === pipelineStageTypeCode.readInspect)
  }

  switch (analysisPipeline.value.pipelineType) {
    case pipelineTypeCode.regularVirus:
      return isInputReadLevel ? pipelineDependencyConfigs.regularVirusRead : pipelineDependencyConfigs.regularVirusAssembly
    case pipelineTypeCode.covid19:
      return pipelineDependencyConfigs.covid19
    case pipelineTypeCode.bacteria:
      return isInputReadLevel
        ? pipelineDependencyConfigs.bacteriaRead
        : pipelineDependencyConfigs.bacteriaAssembly
    default:
      return null
  }
}

function getStageDepths(
  dependencyByStageId: Map<number, number[]>
): Map<number, number> {
  const depths = new Map<number, number>()
  const visiting = new Set<number>()

  function getDepth(stageId: number): number {
    const cachedDepth = depths.get(stageId)
    if (cachedDepth !== undefined) {
      return cachedDepth
    }

    if (visiting.has(stageId)) {
      throw new Error('Pipeline Stage 依赖中存在循环')
    }

    visiting.add(stageId)
    const dependencies =
      dependencyByStageId.get(stageId) ?? []
    const depth =
      dependencies.length === 0
        ? 0
        : Math.max(
          ...dependencies.map(dependencyStageId =>
            getDepth(dependencyStageId)
          )
        ) + 1

    visiting.delete(stageId)
    depths.set(stageId, depth)
    return depth
  }

  pipelineStages.value.forEach(stage => {
    getDepth(stage.stageId)
  })

  return depths
}

function initPipelineGraph() {
  if (!flowGraphContainer.value) {
    throw new Error('Pipeline Graph 容器尚未挂载')
  }

  flowGraph?.dispose()

  flowGraph = new Graph({
    container: flowGraphContainer.value,
    autoResize: true,
    background: {
      color: '#fafcfc'
    },
    grid: {
      visible: true,
      size: 18,
      type: 'dot',
      args: {
        color: '#dfe7e5',
        thickness: 1
      }
    },
    interacting: {
      nodeMovable: false,
      edgeMovable: false
    },
    panning: true,
    mousewheel: {
      enabled: true,
      modifiers: ['ctrl', 'meta'],
      minScale: 0.5,
      maxScale: 1.5
    }
  })

  flowGraph.use(
    new Selection({
      enabled: true,
      multiple: false,
      rubberband: false,
      movable: false,
      showNodeSelectionBox: true,
      filter: cell => cell.isNode()
    })
  )

  const dependencyConfig = getCurrentPipelineDependencyConfig()

  const dependencyByStageId =
    new Map<number, number[]>()
  pipelineStages.value.forEach(stage => {
    dependencyByStageId.set(stage.stageId, [])
  })

  if (dependencyConfig) {
    Object.entries(
      dependencyConfig.stagesDependency
    ).forEach(([stageType, dependency]) => {


      console.log(stageType)
      const stage = pipelineStages.value.find((stage) => { return stage.stageType === Number(stageType) })

      if (stage === undefined) {
        return
      }

      const dependencyStageIds = pipelineStages.value.filter((stage) => {
        return dependency.some((dependencyStageType) => { return dependencyStageType === stage.stageType })
      }).map((stage) => { return stage.stageId })



      dependencyByStageId.set(stage.stageId, dependencyStageIds)

    })
  } else {
    console.warn(
      `尚未配置 Pipeline Type ${analysisPipeline.value?.pipelineType} 的依赖关系`
    )
  }

  const stageDepths = getStageDepths(
    dependencyByStageId
  )
  const nextRowByDepth = new Map<number, number>()



  pipelineStages.value.forEach(stage => {
    const depth = stageDepths.get(stage.stageId) ?? 0
    const row = nextRowByDepth.get(depth) ?? 0
    nextRowByDepth.set(depth, row + 1)

    const nodeViewConfig = stageNodeAppearance[stage.status]

    flowGraph!.addNode({
      id: String(stage.stageId),
      shape: 'rect',
      x: 40 + depth * 210,
      y: 35 + row * 90,
      width: 160,
      height: 58,
      label: `${stage.stageName}\n${nodeViewConfig.label}`,
      attrs: {
        body: {
          fill: nodeViewConfig.background,
          stroke: nodeViewConfig.color,
          strokeWidth:
            stage.status ===
              analysisPipelineStageStatus.running
              ? 2
              : 1.5,
          strokeDasharray:
            nodeViewConfig.borderDasharray ?? '',
          opacity: nodeViewConfig.opacity ?? 1,
          class: nodeViewConfig.className ?? ''
        },

        statusBadge: {
          fill: nodeViewConfig.color
        },

        statusIcon: {
          text: nodeViewConfig.icon
        },

        stageName: {
          text: stage.stageName
        },

        statusLabel: {
          text: nodeViewConfig.label,
          fill: nodeViewConfig.color
        }
      }
    })
  })

  dependencyByStageId.forEach(
    (dependencyStageIds, stageId) => {
      dependencyStageIds.forEach(dependencyStageId => {
        flowGraph!.addEdge({
          source: String(dependencyStageId),
          target: String(stageId),
          router: {
            name: 'manhattan',
            args: {
              padding: 16
            }
          },
          connector: {
            name: 'rounded',
            args: {
              radius: 8
            }
          },
          attrs: {
            line: {
              stroke: '#aebdba',
              strokeWidth: 1.5,
              targetMarker: {
                name: 'block',
                width: 8,
                height: 6
              }
            }
          },
          zIndex: 0
        })
      })
    }
  )

  flowGraph.on('node:selected', ({ node }) => {
    const stageId = Number(node.id)
    currentFocusStage.value =
      pipelineStages.value.find(
        stage => stage.stageId === stageId
      ) ?? null

    updatePipelineStageNode(currentFocusStage.value)
  })

  updatePipelineStageNode(currentFocusStage.value)
  flowGraph.resetSelection(
    String(currentFocusStage.value.stageId)
  )


  flowGraph.zoomToFit({
    padding: 24,
    maxScale: 1
  })

}


async function downloadOutput(stageResult: StageResult) {
  if (stageResult.downloading) {
    return
  }

  if (!stageResult.resultOutputUrl) {
    ElMessage.error('结果文件下载地址不存在')
    return
  }

  stageResult.downloading = true

  try {
    const fileBlob = await backendService.get<Blob, Blob>(
      backendAPI.stageOutputDownload,
      {
        params: {
          outputUrl: stageResult.resultOutputUrl
        },
        responseType: 'blob',
        timeout: 0
      }
    )

    const blobUrl = URL.createObjectURL(fileBlob)
    const link = document.createElement('a')

    link.href = blobUrl
    link.download = `${analysisPipeline.value.analysisPipelineName}_${stageResult.resultOutputName}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(blobUrl)
    ElMessage.success('文件下载完成')
  } catch (error) {
    console.error(error)
    ElMessage.error('文件下载失败')
  } finally {
    stageResult.downloading = false
  }
}


const updateStages = (() => {

  let checkLock = true

  return async () => {
    if (!checkLock) { return; }
    checkLock = false

    try {
      const updatedStageList = await requestPipelineStages(analysisPipeline.value.pipelineId)
      //something error happens in request
      if (!updatedStageList || updatedStageList.length !== pipelineStages.value.length) {
        ElMessage.error('更新分析阶段失败：返回的阶段数据不完整')
        return
      }

      const idStageMap = new Map<number, AnalysisPipelineStage>()
      updatedStageList.forEach((stage) => idStageMap.set(stage.stageId, stage))
      pipelineStages.value.forEach((curStage) => {

        const newStage = idStageMap.get(curStage.stageId)
        if (newStage.status !== curStage.status) {
          curStage.status = newStage.status
          curStage.output = newStage.output
          updatePipelineStageNode(curStage)
          updateStageResults(curStage)
        }

      })


    } catch (error) {
      console.error(error)
      ElMessage.error('更新分析阶段失败，请稍后重试')
    } finally {
      checkLock = true
    }

  }
})()


function updatePipelineStageNode(
  stage: AnalysisPipelineStage
) {
  const node = flowGraph?.getCellById(
    String(stage.stageId)
  )

  if (!node || !node.isNode()) {
    return
  }

  const appearance =
    stageNodeAppearance[stage.status]

  // node.setData({
  //   status: stage.status
  // })


  node.attr({
    label: {
      text: `${stage.stageName}\n${appearance.label}`
    },
    body: {
      fill: appearance.background,
      stroke: appearance.color,
      strokeDasharray:
        appearance.borderDasharray ?? '',
      opacity: appearance.opacity ?? 1,
      class: appearance.className ?? ''
    },

    statusBadge: {
      fill: appearance.color
    },

    statusIcon: {
      text: appearance.icon
    },

    statusLabel: {
      text: appearance.label,
      fill: appearance.color
    }
  })
}

const intervalTasks = []
const intervalTaskExeuctionId = setInterval(() => {
  intervalTasks.forEach((task) => {
    task()
  })
}, 3500)


watch(
  [
    flowGraphContainer,
    analysisPipeline,
    () => pipelineStages.value.length,
    initPipelineAndStagesFailed
  ],
  ([
    container,
    pipeline,
    stageCount,
    loadFailed
  ]) => {
    if (!container || !pipeline || stageCount === 0 || loadFailed
    ) {
      return
    }

    initPipelineGraph()
  },
  {
    flush: 'post'
  }
)

async function loadPipelineAndStages() {
  pipelineLoading.value = true

  let pipelineId = props.pipelineId

  // pipelineId = Math.ceil(Math.random() * 100000)

  // pipelineId = 1

  console.log("pipeline id" + pipelineId)


  try {
    const [pipelineResult, stagesResult] =
      await Promise.allSettled([
        requestPipeline(pipelineId),
        requestPipelineStages(pipelineId)
      ])

    if (
      pipelineResult.status === 'rejected' ||
      stagesResult.status === 'rejected'
    ) {
      initPipelineAndStagesFailed.value = true

      if (pipelineResult.status === 'rejected') {
        console.error(
          '加载 Pipeline 信息失败：',
          pipelineResult.reason
        )
      }

      if (stagesResult.status === 'rejected') {
        console.error(
          '加载 Pipeline Stage 失败：',
          stagesResult.reason
        )
      }

      ElMessage.error('加载分析流水线信息失败')
      return
    }
    analysisPipeline.value = pipelineResult.value
    pipelineStages.value = stagesResult.value
    intervalTasks.push(updateStages)
    initPipelineAndStagesFailed.value = false

    let focusStage = pipelineStages.value.find((stage) => {
      stage.status === analysisPipelineStageStatus.completed
    })

    if (!focusStage) {
      focusStage = pipelineStages.value[0]
    }
    currentFocusStage.value = focusStage
    console.log('current stage' + currentFocusStage.value)
  } catch (error) {
    console.error(error)
    initPipelineAndStagesFailed.value = true
    ElMessage.error('初始化流水线图失败')
  } finally {
    pipelineLoading.value = false
  }
}



const statusMeta = {
  [analysisPipelineStageStatus.completed]: { label: '已完成', icon: 'Check', class: 'completed' },
  [analysisPipelineStageStatus.running]: { label: '运行中', icon: 'Loading', class: 'running' },
  [analysisPipelineStageStatus.pending]: {
    label: '等待中',
    icon: 'Clock',
    class: 'pending'
  },

  [analysisPipelineStageStatus.queuing]: {
    label: '排队中',
    icon: 'Timer',
    class: 'queuing'
  },
  [analysisPipelineStageStatus.failed]: { label: '失败', icon: 'Close', class: 'failed' },
  [analysisPipelineStageStatus.actionRequired]: { label: '需要确认', icon: 'Warning', class: 'confirm' }
}


function formatStartDate(startDate: Date): string {
  const year = startDate.getFullYear()
  const month = String(startDate.getMonth() + 1).padStart(2, '0')
  const day = String(startDate.getDate()).padStart(2, '0')
  const hour = String(startDate.getHours()).padStart(2, '0')
  const minute = String(startDate.getMinutes()).padStart(2, '0')
  const second = String(startDate.getSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function canShowResultOverview() {
  return currentFocusStage.value != null && currentFocusStage.value.stageType !== pipelineStageTypeCode.readInspect && (currentFocusStage.value.status === analysisPipelineStageStatus.completed || currentFocusStage.value.status === analysisPipelineStageStatus.actionRequired)
}

const currentTaxonomyOutput = computed<TaxonomyOutput | null>(() => {
  if (
    currentFocusStage.value === null ||
    currentFocusStage.value.stageType !== pipelineStageTypeCode.taxonomy
  ) {
    return null
  }

  const taxonomyOutput =
    currentFocusStage.value.output.inline as Partial<TaxonomyOutput>

  return taxonomyOutput
})

const taxonomyConfirmationViewList = ref<Taxon[]>([])

watch(currentTaxonomyOutput, (newOutput, oldOutput) => {


  if (newOutput === null || newOutput === undefined || newOutput.candidates.length < 1) {
    taxonomyConfirmationViewList.value = []
    return
  }
  newOutput.candidates?.forEach((taxon) => {
    taxonomyConfirmationViewList.value.push(taxon)
  })
})



const selectedComfirmationTaxon = ref<Taxon | null>(null)
const isComfirmingTaxonomy = ref(false)



async function comfirmTaxonomy() {

  const stage = currentFocusStage.value
  const selectedTaxon = selectedComfirmationTaxon.value

  if (stage === null || selectedTaxon === null) {
    ElMessage.warning('请选择需要确认的物种')
    return
  }

  isComfirmingTaxonomy.value = true

  try {
    const response = await doComfirmTaxonomy(stage.stageId, selectedTaxon.taxid)

    response.status = RAW_RESPONSE_STATUS_OK
    if (response.status !== RAW_RESPONSE_STATUS_OK) {
      ElMessage.error(response.failMsg)
      return
    } else {
      ElMessage.success('人工确认成功')
    }
    stage.status = analysisPipelineStageStatus.completed

    const taxonomyOutput =
      stage.output.inline as Partial<TaxonomyOutput>

    taxonomyOutput.status = taxonomyResultStatusCode.userManul
    taxonomyOutput.best = selectedTaxon
  } catch (error) {
    console.error(error)
    ElMessage.error('人工确认物种失败，请稍后重试')
  } finally {
    isComfirmingTaxonomy.value = false
  }
}


const pipelineInputs = ref<PipelineInput[]>([])






onBeforeMount(() => {
  loadPipelineAndStages()
})

onBeforeUnmount(() => {
  flowGraph?.dispose()
  flowGraph = null
  clearInterval(intervalTaskExeuctionId)
})


</script>

<template>
  <div class="detail-page">

    <div v-if="pipelineLoading" class="loading-box" v-loading="pipelineLoading" element-loading-text="正在加载...">

    </div>

    <div class="detail-load-error" v-if="!pipelineLoading && initPipelineAndStagesFailed">
      <el-result icon="error" title="任务详情加载失败" sub-title="暂时无法获取分析流水线信息，请重新尝试">
        <template #extra>
          <div class="detail-load-error-actions">
            <el-button type="primary" :loading="pipelineLoading" @click="loadPipelineAndStages">
              重新尝试
            </el-button>
            <el-button @click="emit('back')">
              返回任务列表
            </el-button>
          </div>
        </template>
      </el-result>
    </div>

    <template v-else-if="!pipelineLoading && !initPipelineAndStagesFailed">
      <div class="detail-header">
        <el-button text class="back" @click="emit('back')"><el-icon>
            <ArrowLeft />
          </el-icon>返回任务列表</el-button>
        <div class="title-row">
          <div>
            <div class="title-line">
              <h1>{{ analysisPipeline.analysisPipelineName }}</h1>
              <!-- <StatusTag :status="task.status" /> -->
            </div>
            <!-- <p>{{ 'task.id' }} · {{ 'task.project' }}</p> -->
          </div>
          <div class="actions">
            <template>
              <el-button @click="logVisible = true">
                <el-icon>
                  <Document />
                </el-icon>
                运行日志
              </el-button>

              <el-button>
                <el-icon>
                  <Download />
                </el-icon>
                下载结果
              </el-button>

              <el-button type="primary">
                <el-icon>
                  <DocumentChecked />
                </el-icon>
                查看报告
              </el-button>
            </template>
          </div>
        </div>
        <div class="summary-strip">
          <div>
            <span>分析类型</span><strong>{{ getAnalysisPipelineTypeName(analysisPipeline.pipelineType) }}</strong>
          </div>
          <div>
            <span>创建时间</span><strong>{{ analysisPipeline.createTime.toLocaleDateString() }}</strong>
          </div>
        </div>
      </div>

      <el-tabs v-model="activeTab" class="detail-tabs">
        <el-tab-pane label="分析流水线" name="pipeline">
          <div class="pipeline-layout">
            <el-card shadow="never" class="pipeline-card">
              <div class="pipeline-canvas" ref="flowGraphContainer">
              </div>
            </el-card>

            <el-card shadow="never" class="node-detail">
              <template #header>
                <div class="node-heading">
                  <span :class="['big-status', statusMeta[currentFocusStage.status].class]"><el-icon>
                      <component :is="statusMeta[currentFocusStage.status].icon" />
                    </el-icon></span>
                  <div>
                    <strong>{{ currentFocusStage.stageName }}</strong><small>{{
                      statusMeta[currentFocusStage.status].label }}</small>
                  </div>
                </div>
              </template>
              <div class="node-body">
                <div class="detail-pair">
                  <span>执行状态</span><strong>{{ statusMeta[currentFocusStage.status].label }}</strong>
                </div>
                <div class="detail-pair">
                  <span>开启时间</span><strong>{{
                    currentFocusStage.startTime == null ? '--' : formatStartDate(currentFocusStage.startTime)
                  }}</strong>
                </div>
                <el-divider />

                <div v-if="canShowResultOverview()" class="detail-result-overview"
                  style="display: flex;align-items: center; justify-content: center;">
                  <div v-if="currentFocusStage.stageType !== pipelineStageTypeCode.taxonomy" style="width: 100%">
                    <el-table :data="pipelineStagesResultsMap.get(currentFocusStage.stageId) ?? []" style="width: 100%">
                      <el-table-column prop="displayName" label="结果" />
                      <el-table-column prop="resultOutputName" label="文件名" />
                      <el-table-column label="操作" width="120" align="right">
                        <template #default="{ row }">
                          <el-button type="primary" link :loading="row.downloading" @click="downloadOutput(row)">
                            <span v-if="!row.downloading">下载</span>
                          </el-button>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>

                  <div v-else style="width: 100%">
                    <template v-if="currentTaxonomyOutput">
                      <el-descriptions v-if="currentTaxonomyOutput.status === taxonomyResultStatusCode.confident"
                        title="最佳匹配结果" :column="1" border size="small">
                        <el-descriptions-item label="物种名称">
                          {{ currentTaxonomyOutput.best.name }}
                        </el-descriptions-item>
                        <el-descriptions-item label="Tax ID">
                          {{ currentTaxonomyOutput.best.taxid }}
                        </el-descriptions-item>
                        <el-descriptions-item label="匹配评分">
                          {{ currentTaxonomyOutput.best.score }}
                        </el-descriptions-item>
                      </el-descriptions>

                      <el-descriptions v-else-if="currentTaxonomyOutput.status === taxonomyResultStatusCode.userManul"
                        title="人工确认结果" :column="1" border size="small">
                        <el-descriptions-item label="物种名称">
                          {{ currentTaxonomyOutput.best.name }}
                        </el-descriptions-item>
                        <el-descriptions-item label="Tax ID">
                          {{ currentTaxonomyOutput.best.taxid }}
                        </el-descriptions-item>
                      </el-descriptions>

                      <!-- 这里是物种鉴定的结果是需要用户手动选择的时候才有的。用户可以手动输入物种。当然了也可以选择某个在candiates里面的一个物种。下面的table不要动，就保持 -->
                      <div v-else v-loading="isComfirmingTaxonomy">
                        <template v-if="currentTaxonomyOutput.status !== taxonomyResultStatusCode.outPanel">
                          <el-alert title="系统未能确定唯一物种" description="请选择候选物种，或者手动输入物种名称。" type="warning"
                            :closable="false" show-icon />
                          <el-form label-position="top" style="margin-top: 16px">
                            <el-form-item label="确认物种">
                              <el-select v-model="selectedComfirmationTaxon" value-key='taxid' clearable
                                placeholder="选择候选物种或输入物种名称" style="width: 100%">
                                <el-option v-for="taxon in taxonomyConfirmationViewList" :key="taxon.taxid"
                                  :label="`${taxon.name}（Tax ID: ${taxon.taxid}）`" :value="taxon" />
                              </el-select>
                            </el-form-item>
                          </el-form>

                          <el-button type="primary" @click="comfirmTaxonomy">确认物种</el-button>
                        </template>


                        <template v-else>
                          <el-alert title="物种超出鉴定范围" description="当前样本超出系统支持范围，依赖物种鉴定的后续分析流程已终止" type="error"
                            :closable="false" show-icon />
                        </template>


                      </div>
                      <el-divider content-position="center">候选物种</el-divider>

                      <el-table :data="currentTaxonomyOutput.candidates" style="width: 100%" max-height="500">
                        <el-table-column prop="name" label="物种名称" />
                        <el-table-column prop="taxid" label="Tax ID" width="100" />
                        <el-table-column prop="score" label="匹配评分" width="100" />
                      </el-table>
                    </template>
                    <el-empty v-else description="暂无物种鉴定结果" />
                  </div>


                </div>
                <!-- <h3>阶段摘要</h3>
                <p>{{ 'selectedNode.summary' }}</p>
                <h3>输出文件</h3>
                <div class="output-file">
                  <el-icon>
                    <Document />
                  </el-icon><span>{{ 'selectedNode.output' }}</span><el-button v-if="true" link type="primary"><el-icon>
                      <Download />
                    </el-icon></el-button>
                </div>
                <el-button class="full-button" @click="logVisible = true"><el-icon>
                    <Document />
                  </el-icon>查看阶段日志</el-button> -->
              </div>
            </el-card>
          </div>
          <!-- <el-card shadow="never" class="run-info">
          <div class="run-status">
            <span class="pulse"></span>
            <div>
              <strong>正在执行：物种鉴定</strong><small>正在使用 Kraken2 进行分类初筛，完成后将进入 ANI 物种确认。</small>
            </div>
          </div>
          <div class="run-progress">
            <span>预计剩余 4 分钟</span><el-progress :percentage="68" :stroke-width="7" />
          </div>
        </el-card> -->
        </el-tab-pane>

        <!-- <el-tab-pane label="样本信息" name="sample"><el-card shadow="never"><el-descriptions :column="3"
              border><el-descriptions-item label="样本编号">{{ 'task.sample' }}</el-descriptions-item><el-descriptions-item
                label="任务编号">{{ 'task.id' }}</el-descriptions-item><el-descriptions-item label="所属项目">{{ 'task.project'
                }}</el-descriptions-item><el-descriptions-item label="数据类型">{{ 'task.input'
                }}</el-descriptions-item><el-descriptions-item label="分析流程">{{ 'task.type'
                }}</el-descriptions-item><el-descriptions-item
                label="创建人">张老师</el-descriptions-item></el-descriptions></el-card></el-tab-pane> -->
        <el-tab-pane label="结果文件" name="files">
          <el-card shadow="never"><el-table :data="allFinishedResultsViewList">
              <el-table-column prop="result.resultOutputName" label="文件名" min-width="120" />
              <el-table-column prop="stageName" label="分析阶段" />
              <!-- <el-table-column prop="" label="格式" />
              <el-table-column prop="size" label="大小" />
              <el-table-column prop="updatedAt" label="生成时间" /> -->
              <el-table-column label="操作">
                <template #default="{ row }">
                  <el-button link type="primary" :loading="row.result.downloading" @click="downloadOutput(row.result)">
                    <span v-if="!row.result.downloading">下载</span>
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

        </el-tab-pane>
        <!-- <el-tab-pane label="确认记录" name="records"><el-empty description="暂无用户确认记录" /></el-tab-pane> -->


      </el-tabs>

      <!-- <el-drawer v-model="logVisible" title="运行日志" size="560px">
      <div class="log-toolbar">
        <el-tag type="success">实时更新</el-tag><el-button text><el-icon>
            <Download />
          </el-icon>下载完整日志</el-button>
      </div>
      <pre class="log-output">
    [14:32:06] INFO Task TASK-0721-008 started
    [14:32:08] INFO Input pair validation passed
    [14:34:24] INFO Preprocess completed successfully
    [14:43:06] INFO Quality control completed · Q30=94.7%
    [14:54:11] INFO Assembly completed · N50=186420
    [14:54:18] INFO Starting Kraken2 classification
    [14:55:42] INFO Loading database taxonomy...
    [14:56:03] INFO Processing contigs.fasta
    _</pre>
    </el-drawer> -->
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  max-width: 1280px;
  margin: 0 auto;
  /* height: calc(100vh - 120px); */
}


.detail-load-error,
.loading-box {
  min-height: calc(100vh - 150px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-load-error-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.detail-header {
  margin-bottom: 7px;
}

.back {
  margin: -8px 0 9px -12px;
  color: #71817e;
}

.title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 11px;
}

.title-line h1 {
  margin: 0;
  color: #1f302e;
  font-size: 23px;
  font-weight: 700;
}

.title-row p {
  margin: 4px 0 0;
  color: #899693;
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 8px;
}

.summary-strip {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1fr 1fr;
  margin-top: 19px;
  padding: 14px 18px;
  border: 1px solid #e3eae9;
  border-radius: 10px;
  background: #fff;
}

.summary-strip>div {
  display: grid;
  gap: 3px;
  padding: 0 16px;
  border-right: 1px solid #e8edec;
}

.summary-strip>div:first-child {
  padding-left: 0;
}

.summary-strip>div:last-child {
  border: 0;
}

.summary-strip span {
  color: #8b9895;
  font-size: 10px;
}

.summary-strip strong {
  color: #394947;
  font-size: 12px;
  font-weight: 600;
}

.detail-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}

.pipeline-layout {
  display: grid;
  grid-template-columns: minmax(500px, 1fr) 400px;
  gap: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-header>div:first-child {
  display: grid;
}

.panel-header strong {
  font-weight: 650;
}

.panel-header small {
  color: #8c9896;
  font-size: 10px;
}

.legend {
  display: flex;
  gap: 13px;
  color: #85928f;
  font-size: 10px;
}

.legend span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #b3bfbd;
}

.legend .done {
  background: #47a16a;
}

.legend .run {
  background: #2b8e7d;
}

.pipeline-card :deep(.el-card__body) {
  padding: 14px;
}

.pipeline-canvas {
  position: relative;
  min-height: 410px;
  padding: 20px 12px;
  background-color: #fafcfc;
  background-image: radial-gradient(#dfe7e5 1px, transparent 1px);
  background-size: 18px 18px;
  border-radius: 8px;
  overflow: auto;
}

.flow-row {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 34px;
}

.main-flow {
  justify-content: center;
}

.main-flow .node:not(:last-child)::after,
.branch-flow .node:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 100%;
  top: 50%;
  width: 35px;
  height: 1px;
  background: #cbd6d4;
}

.main-flow .node:not(:last-child)::before,
.branch-flow .node:not(:last-child)::before {
  content: '';
  position: absolute;
  left: calc(100% + 28px);
  top: calc(50% - 3px);
  width: 6px;
  height: 6px;
  border-top: 1px solid #aebdba;
  border-right: 1px solid #aebdba;
  transform: rotate(45deg);
}

.node {
  position: relative;
  width: 135px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px;
  border: 1px solid #dce5e3;
  border-radius: 9px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 3px 8px rgba(46, 72, 68, 0.04);
}

.node:hover,
.node.selected {
  border-color: #54a698;
  box-shadow: 0 0 0 2px rgba(22, 124, 107, 0.1);
}

.node-icon {
  width: 29px;
  height: 29px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 50%;
  background: #eff3f2;
  color: #879592;
}

.node-text {
  display: grid;
}

.node-text strong {
  font-size: 11px;
  font-weight: 650;
  color: #3a4947;
}

.node-text small {
  font-size: 9px;
  color: #919e9b;
}

.node.completed .node-icon {
  color: #fff;
  background: #49a46e;
}

.node.running .node-icon {
  color: #fff;
  background: #218e7c;
}

.node.running {
  border-color: #58a99b;
  background: #f2faf8;
}

.node.running .node-icon :deep(svg) {
  animation: spin 1.2s linear infinite;
}

.branch-line {
  position: absolute;
  z-index: 1;
  border-left: 1px solid #cbd6d4;
  border-bottom: 1px solid #cbd6d4;
}

.branch-line.one {
  top: 81px;
  left: 52%;
  width: 190px;
  height: 94px;
}

.branch-line.two {
  top: 81px;
  left: 52%;
  width: 115px;
  height: 207px;
}

.branch-flow {
  margin-top: 71px;
  justify-content: flex-end;
  padding-right: 38px;
}

.branch-flow.second {
  margin-top: 72px;
}

.branch-flow.second .node:last-child {
  margin-left: 64px;
}

.node-detail :deep(.el-card__header) {
  padding: 16px;
}

.node-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.big-status {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #9ca9a7;
}

.big-status.completed {
  background: #49a46e;
}

.big-status.running {
  background: #218e7c;
}

.node-heading>div {
  display: grid;
}

.node-heading strong {
  font-size: 14px;
  font-weight: 650;
}

.node-heading small {
  color: #2a8e7d;
  font-size: 10px;
}

.node-detail :deep(.el-card__body) {
  padding: 0;
}

.node-body {
  padding: 17px;
}

.detail-pair {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  color: #83918e;
  font-size: 11px;
}

.detail-pair strong {
  color: #3b4b48;
  font-weight: 600;
}

.node-body h3 {
  margin: 15px 0 7px;
  color: #465552;
  font-size: 11px;
  font-weight: 650;
}

.node-body p {
  margin: 0;
  padding: 10px;
  border-radius: 7px;
  background: #f5f8f7;
  color: #657471;
  font-size: 11px;
  line-height: 1.5;
}

.output-file {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px;
  border: 1px solid #e4eae9;
  border-radius: 7px;
  color: #60706d;
  font-size: 10px;
}

.output-file span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.full-button {
  width: 100%;
  margin-top: 18px;
}

.run-info {
  margin-top: 15px;
}

.run-info :deep(.el-card__body) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
}

.run-status {
  display: flex;
  align-items: center;
  gap: 11px;
}

.pulse {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #208e7c;
  box-shadow: 0 0 0 5px #dff0ed;
}

.run-status>div {
  display: grid;
}

.run-status strong {
  font-size: 12px;
  font-weight: 650;
}

.run-status small {
  color: #83918e;
  font-size: 10px;
}

.run-progress {
  width: 280px;
  color: #83918e;
  font-size: 10px;
}

.log-toolbar {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}

.log-output {
  min-height: 560px;
  margin: 0;
  padding: 18px;
  border-radius: 8px;
  background: #14201f;
  color: #b8d6d0;
  font:
    11px/1.8 Consolas,
    monospace;
  white-space: pre-wrap;
}

.detail-tabs :deep(.el-empty) {
  padding-top: 100px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1200px) {
  .pipeline-layout {
    grid-template-columns: 1fr;
  }

  .node-detail {
    display: none;
  }
}
</style>
