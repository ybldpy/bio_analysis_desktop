<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  AnalysisPipeline,
  AnalysisPipelineStage
} from '../common/analysisPipeline.js'
import {
  analysisPipelineStageStatus,
  pipelineStageTypeCode,
  pipelineTypeCode,
  requestPipeline,
  requestPipelineStages
} from '../api/analysisPipeline'
import { ElMessage } from 'element-plus'
import { Graph, Selection } from '@antv/x6'
import { getAnalysisPipelineTypeName } from '../common/analysisPipeline.js'
import { formatDate, getStageStatusMeta } from '../common/pipelineResults'



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
const emit = defineEmits<{
  back: []
  'view-results': [context: { pipelineId: number; stageId?: number }]
}>()
const activeTab = ref('pipeline')
const pipelineLoading = ref(true)
const initPipelineAndStagesFailed = ref(false)
const refreshError = ref('')




interface StageNodeAppearance {
  label: string
  icon: string
  color: string
  background: string
  borderDasharray?: string
  opacity?: number
  className?: string
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
      [pipelineStageTypeCode.assembly]: [pipelineStageTypeCode.qc],
      [pipelineStageTypeCode.referenceSelection]: [pipelineStageTypeCode.assembly],
      [pipelineStageTypeCode.mapping]: [pipelineStageTypeCode.referenceSelection],
      [pipelineStageTypeCode.variantCall]: [pipelineStageTypeCode.mapping],
      [pipelineStageTypeCode.consensus]: [pipelineStageTypeCode.variantCall],
      [pipelineStageTypeCode.snpAnnotation]: [pipelineStageTypeCode.variantCall]
    }
  },
  regularVirusAssembly: {
    entries: [pipelineStageTypeCode.referenceSelection],
    stagesDependency: {
      [pipelineStageTypeCode.referenceComparison]: [pipelineStageTypeCode.referenceSelection]
    }
  },
  covid19: {
    entries: [pipelineStageTypeCode.readInspect],
    stagesDependency: {
      [pipelineStageTypeCode.qc]: [pipelineStageTypeCode.readInspect],
      [pipelineStageTypeCode.assembly]: [pipelineStageTypeCode.qc],
      [pipelineStageTypeCode.referenceSelection]: [pipelineStageTypeCode.assembly],
      [pipelineStageTypeCode.mapping]: [pipelineStageTypeCode.referenceSelection],
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
    label: '排队中',
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






function getCurrentPipelineDependencyConfig():
  | PipelineDependencyConfig
  | null {


  if (!analysisPipeline.value) return null
  const isInputReadLevel = pipelineStages.value.some(
    stage => stage.stageType === pipelineStageTypeCode.qc || stage.stageType === pipelineStageTypeCode.readInspect
  )

  switch (analysisPipeline.value.pipelineType) {
    case pipelineTypeCode.regularVirus:
      return isInputReadLevel ? pipelineDependencyConfigs.regularVirusRead : pipelineDependencyConfigs.regularVirusAssembly
    case pipelineTypeCode.covid19:
      return isInputReadLevel ? pipelineDependencyConfigs.covid19 : pipelineDependencyConfigs.regularVirusAssembly
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
  if (!flowGraphContainer.value || !pipelineStages.value.length) return

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

    const nodeViewConfig = getStageNodeAppearance(stage.status)

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

  if (currentFocusStage.value) {
    updatePipelineStageNode(currentFocusStage.value)
    flowGraph.resetSelection(String(currentFocusStage.value.stageId))
  }


  flowGraph.zoomToFit({
    padding: 24,
    maxScale: 1
  })

}




function getStageNodeAppearance(status: number): StageNodeAppearance {
  return stageNodeAppearance[status] ?? {
    ...stageNodeAppearance[analysisPipelineStageStatus.pending],
    label: `未知状态（${status}）`,
    icon: '?'
  }
}

function updatePipelineStageNode(stage: AnalysisPipelineStage | null) {
  if (!stage) return
  const node = flowGraph?.getCellById(
    String(stage.stageId)
  )

  if (!node || !node.isNode()) {
    return
  }

  const appearance = getStageNodeAppearance(stage.status)

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
      strokeWidth: stage.status === analysisPipelineStageStatus.running ? 2 : 1.5,
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

let requestController: AbortController | null = null
let requestSequence = 0
let disposed = false
let refreshTimer: ReturnType<typeof setInterval> | null = null

function replaceStages(stages: AnalysisPipelineStage[]) {
  const focusedId = currentFocusStage.value?.stageId
  pipelineStages.value = stages
  currentFocusStage.value =
    stages.find(stage => stage.stageId === focusedId) ??
    stages.find(stage => stage.status === analysisPipelineStageStatus.completed) ??
    stages[0] ?? null
  stages.forEach(updatePipelineStageNode)
}

async function refreshPipeline(showLoading: boolean) {
  if (disposed || (!showLoading && (requestController || pipelineLoading.value))) return

  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  const sequence = ++requestSequence
  const pipelineId = props.pipelineId
  if (showLoading) {
    pipelineLoading.value = true
    initPipelineAndStagesFailed.value = false
  }

  try {
    const [pipeline, stages] = await Promise.all([
      requestPipeline(pipelineId, controller.signal),
      requestPipelineStages(pipelineId, controller.signal)
    ])
    if (disposed || controller.signal.aborted || sequence !== requestSequence || pipelineId !== props.pipelineId) return

    analysisPipeline.value = pipeline
    replaceStages(stages)
    initPipelineAndStagesFailed.value = false
    refreshError.value = ''
  } catch (error) {
    if (disposed || controller.signal.aborted || sequence !== requestSequence || pipelineId !== props.pipelineId) return
    controller.abort()
    console.error(error)
    if (showLoading) {
      initPipelineAndStagesFailed.value = true
      ElMessage.error('加载分析流水线信息失败')
    } else {
      refreshError.value = '刷新任务状态失败，当前显示上次加载的信息'
    }
  } finally {
    if (!disposed && sequence === requestSequence) {
      requestController = null
      if (showLoading) pipelineLoading.value = false
    }
  }
}

function loadPipelineAndStages() {
  return refreshPipeline(true)
}

function openResults(stageId?: number) {
  emit('view-results', {
    pipelineId: props.pipelineId,
    ...(stageId === undefined ? {} : { stageId })
  })
}

const currentStageStatus = computed(() => {
  const status = currentFocusStage.value?.status
  const icons: Record<number, { icon: string; class: string }> = {
    0: { icon: 'Clock', class: 'pending' },
    1: { icon: 'Timer', class: 'queuing' },
    2: { icon: 'Loading', class: 'running' },
    3: { icon: 'Close', class: 'failed' },
    4: { icon: 'Check', class: 'completed' },
    5: { icon: 'Warning', class: 'confirm' },
    6: { icon: 'Minus', class: 'pending' }
  }
  return {
    ...getStageStatusMeta(status ?? -1),
    ...(icons[status ?? -1] ?? { icon: 'QuestionFilled', class: 'pending' })
  }
})

watch(
  [
    flowGraphContainer,
    () => analysisPipeline.value?.pipelineType,
    () => pipelineStages.value.map(stage => `${stage.stageId}:${stage.stageType}`).sort().join('|'),
    initPipelineAndStagesFailed
  ],
  ([container, , stageSignature, loadFailed]) => {
    if (!container || !analysisPipeline.value || !stageSignature || loadFailed) {
      flowGraph?.dispose()
      flowGraph = null
      return
    }
    try {
      initPipelineGraph()
    } catch (error) {
      console.error(error)
      refreshError.value = '流程图加载失败，可重新加载或直接查看结果'
    }
  },
  { flush: 'post' }
)

watch(() => props.pipelineId, () => {
  analysisPipeline.value = null
  pipelineStages.value = []
  currentFocusStage.value = null
  refreshError.value = ''
  void loadPipelineAndStages()
}, { immediate: true })

onMounted(() => {
  refreshTimer = setInterval(() => {
    if (!initPipelineAndStagesFailed.value) void refreshPipeline(false)
  }, 3500)
})

onBeforeUnmount(() => {
  disposed = true
  requestSequence++
  requestController?.abort()
  requestController = null
  if (refreshTimer !== null) clearInterval(refreshTimer)
  flowGraph?.dispose()
  flowGraph = null
})


</script>

<template>
  <div class="detail-page">
    <div v-if="pipelineLoading" class="loading-box" v-loading="pipelineLoading" element-loading-text="正在加载..."></div>

    <div class="detail-load-error" v-if="!pipelineLoading && initPipelineAndStagesFailed">
      <el-result icon="error" title="任务详情加载失败" sub-title="暂时无法获取分析流水线信息，请重新尝试">
        <template #extra>
          <div class="detail-load-error-actions">
            <el-button type="primary" :loading="pipelineLoading" @click="loadPipelineAndStages">
              重新尝试
            </el-button>
            <el-button @click="emit('back')">返回上一页</el-button>
          </div>
        </template>
      </el-result>
    </div>

    <template v-else-if="!pipelineLoading && !initPipelineAndStagesFailed && analysisPipeline">
      <div class="detail-header">
        <el-button text class="back" @click="emit('back')">
          <el-icon><ArrowLeft /></el-icon>返回上一页
        </el-button>
        <div class="title-row">
          <div class="title-line">
            <h1>{{ analysisPipeline.analysisPipelineName }}</h1>
          </div>
          <div class="actions">
            <el-button @click="loadPipelineAndStages">
              <el-icon><Refresh /></el-icon>重新加载
            </el-button>
            <el-button type="primary" @click="openResults()">
              <el-icon><DocumentChecked /></el-icon>查看结果
            </el-button>
          </div>
        </div>
        <div class="summary-strip">
          <div>
            <span>分析类型</span><strong>{{ getAnalysisPipelineTypeName(analysisPipeline.pipelineType) }}</strong>
          </div>
          <div>
            <span>创建时间</span><strong>{{ formatDate(analysisPipeline.createTime) }}</strong>
          </div>
        </div>
      </div>

      <el-alert v-if="refreshError" :title="refreshError" type="warning" :closable="false" show-icon />

      <el-tabs v-model="activeTab" class="detail-tabs">
        <el-tab-pane label="分析流水线" name="pipeline">
          <el-empty v-if="pipelineStages.length === 0" description="暂无分析阶段" />
          <div v-else class="pipeline-layout">
            <el-card shadow="never" class="pipeline-card">
              <div class="pipeline-canvas" ref="flowGraphContainer"></div>
            </el-card>

            <el-card v-if="currentFocusStage" shadow="never" class="node-detail">
              <template #header>
                <div class="node-heading">
                  <span :class="['big-status', currentStageStatus.class]">
                    <el-icon><component :is="currentStageStatus.icon" /></el-icon>
                  </span>
                  <div>
                    <strong>{{ currentFocusStage.stageName }}</strong>
                    <small>{{ currentStageStatus.label }}</small>
                  </div>
                </div>
              </template>
              <div class="node-body">
                <div class="detail-pair">
                  <span>执行状态</span><strong>{{ currentStageStatus.label }}</strong>
                </div>
                <div class="detail-pair">
                  <span>开始时间</span><strong>{{ formatDate(currentFocusStage.startTime) }}</strong>
                </div>
                <div class="detail-pair">
                  <span>结束时间</span><strong>{{ formatDate(currentFocusStage.endTime) }}</strong>
                </div>
                <el-divider />
                <p v-if="currentFocusStage.status === analysisPipelineStageStatus.actionRequired">
                  当前阶段需要处理，请进入阶段结果页查看详情。
                </p>
                <p v-else>阶段摘要、结构化结果和输出文件已集中到独立结果页。</p>
                <el-button type="primary" class="full-button" @click="openResults(currentFocusStage.stageId)">
                  查看阶段结果
                </el-button>
              </div>
            </el-card>
          </div>
        </el-tab-pane>
      </el-tabs>
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

}
</style>
