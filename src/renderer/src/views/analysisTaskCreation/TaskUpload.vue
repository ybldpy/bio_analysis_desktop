<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
    analysisPipelineTypeCodes,
    requestBuildAnalysisTasks,
    requestStartPipeline,
    validateEnabledReferenceIds,
    type CreatedAnalysisTask
} from '../../api/analysisPipeline'
import {
    AnalysisTaskUploadFileRequest,
    SEQUENCE_LEVEL_ASSEMBLY,
    SEQUENCE_LEVEL_READ,
    doUploadAnalysisTaskInput,
    uploadAnalysisTaskInputResonseCode
} from '../../api/analysisPipeline'
import {
    takeTaskUploadRequest,
    type AnalysisTask,
    type AnalysisTaskDataType
} from './taskCreationCommon'

import { getAnalysisPipelineTypeName } from '../../common/analysisPipeline'

import { RAW_RESPONSE_STATUS_BUSINESS_FAIL, RAW_RESPONSE_STATUS_DUPLICATE_OPERATION, RAW_RESPONSE_STATUS_INTERNAL_FAIL, RAW_RESPONSE_STATUS_OK, RawResponse } from '../../api/common'

type UploadPhase =
    | 'missing'
    | 'ready'
    | 'creating'
    | 'creation-failed'
    | 'uploading'
    | 'completed'

type TaskUploadStatus =
    | 'waiting'
    | 'uploading'
    | 'success'
    | 'failed'
    | 'starting'
    | 'startFailed'


interface UploadFile {
    file: File | null,
    uploaded: boolean
}

interface UploadFileSlot {
    r1: UploadFile
    r2: UploadFile
    assembly: UploadFile
    type: AnalysisTaskDataType

}

interface TaskUploadItem {
    taskName: string,
    taskInputType: number
    inputSlots: UploadFileSlot[]
    taskAssingedId: number | null
    status: TaskUploadStatus
    retryable: boolean
    errorMessage: string
}



const emit = defineEmits<{
    cancel: []
    submitted: []
}>()


const taskCreateCompleted = ref(false)

const taskUploadRequest = takeTaskUploadRequest()
const enabledReferenceIds = Array.isArray(taskUploadRequest?.enabledReferenceIds)
    ? [...taskUploadRequest.enabledReferenceIds]
    : taskUploadRequest?.enabledReferenceIds
const phase = ref<UploadPhase>(
    taskUploadRequest ? 'ready' : 'missing'
)
const creationErrorMessage = ref('')

const tasks = reactive<TaskUploadItem[]>(
    taskUploadRequest?.tasks.map((task) => ({
        taskName: task.name,
        retryable: true,
        inputSlots: task.inputSlots.map((inputSlot) => {
            return {
                r1: {
                    file: inputSlot.r1,
                    uploaded: false
                },
                r2: {
                    file: inputSlot.r2,
                    uploaded: false
                },
                assembly: {
                    file: inputSlot.contigs,
                    uploaded: false
                },
                type: inputSlot.type
            }
        }),
        taskInputType: task.type,
        taskAssingedId: null,
        status: 'waiting',
        errorMessage: ''
    })) ?? []
)

const project = taskUploadRequest?.project ?? null
const referenceGenome =
    taskUploadRequest?.referenceGenome ?? null
const virusTarget = taskUploadRequest?.virusTarget ?? null
const isVirusAnalysis =
    taskUploadRequest?.analysisType === analysisPipelineTypeCodes.regularVirus ||
    taskUploadRequest?.analysisType === analysisPipelineTypeCodes.virusCovid
const pipelineType = isVirusAnalysis
    ? virusTarget?.pipelineType
    : taskUploadRequest?.analysisType

const isWorking = computed(
    () =>
        phase.value === 'creating' ||
        tasks.some((task)=>{return task.status === 'starting' || task.status === 'uploading'})
)

const completedTaskCount = computed(
    () =>
        tasks.filter((task) => task.status === 'success')
            .length
)

const failedTaskCount = computed(
    () =>
        tasks.filter((task) => task.status === 'failed' || task.status === 'startFailed')
            .length
)

const stepActive = computed(() => {
    if (
        phase.value === 'ready' ||
        phase.value === 'creating' ||
        phase.value === 'creation-failed'
    ) {
        return 0
    }

    if (phase.value === 'uploading') {
        return 1
    }

    return 2
})



function getDataTypeLabel(type: AnalysisTaskDataType): string {
    const labels: Record<AnalysisTaskDataType, string> = {
        0: '双端 FASTQ',
        1: '单端 FASTQ',
        2: 'Contigs FASTA'
    }

    return labels[type]
}

function getStatusLabel(status: TaskUploadStatus): string {
    const labels: Record<TaskUploadStatus, string> = {
        waiting: '等待上传',
        uploading: '正在上传',
        starting: '正在启动',
        success: '上传成功',
        failed: '上传失败',
        startFailed: '启动失败'
    }

    return labels[status]
}

function getStatusType(
    status: TaskUploadStatus
): 'info' | 'warning' | 'success' | 'danger' {
    const types: Record<
        TaskUploadStatus,
        'info' | 'warning' | 'success' | 'danger'
    > = {
        waiting: 'info',
        uploading: 'warning',
        success: 'success',
        failed: 'danger',
        startFailed: 'danger',
        starting: 'warning'
    }

    return types[status]
}

function getFileSummary(task: TaskUploadItem): string {
    const fileNames = [
        task.inputSlots[0].r1?.file?.name,
        task.inputSlots[0].r2?.file?.name,
        task.inputSlots[0].assembly?.file?.name,
    ].filter((name): name is string => Boolean(name))

    return fileNames.join('、') || '--'
}

function getTaskRowKey(item: TaskUploadItem): string {
    return item.taskName
}

function getErrorMessage(error: unknown): string {
    const failMsg = (error as { response?: { data?: { failMsg?: unknown } } })
        ?.response?.data?.failMsg
    if (typeof failMsg === 'string' && failMsg.trim()) {
        return failMsg.trim()
    }
    if (error instanceof Error) {
        return error.message
    }

    return '发生未知错误，请稍后重试'
}

function bindCreatedTaskIds(
    taskIds: number[]
): void {
    tasks.forEach((task, index) => {
        debugger
        task.taskAssingedId = taskIds[index]
    })
}

async function createTasks(): Promise<boolean> {
    if (!taskUploadRequest) {
        phase.value = 'missing'
        return false
    }

    phase.value = 'creating'
    creationErrorMessage.value = ''

    try {
        if (isVirusAnalysis && !virusTarget) {
            throw new Error('缺少分析目标，请返回创建页面重新选择')
        }
        let parameters: { referenceId?: number | null; taxId?: number; enabledReferenceIds?: number[] } = {
            referenceId: referenceGenome?.refId ?? null
        }
        if (isVirusAnalysis) {
            validateEnabledReferenceIds(enabledReferenceIds)
            parameters = { taxId: virusTarget.taxId, enabledReferenceIds: [...enabledReferenceIds] }
        }
        const response = await requestBuildAnalysisTasks(
            taskUploadRequest.tasks,
            taskUploadRequest.project.pid,
            pipelineType,
            parameters
        )

        if (response.status !== RAW_RESPONSE_STATUS_OK) {
            phase.value = 'creation-failed'
            creationErrorMessage.value = response.failMsg
            ElMessage.error(response.failMsg)
            return false
        }



        bindCreatedTaskIds(response.data)

        phase.value = 'uploading'
        return true
    } catch (error) {
        console.error(error)
        phase.value = 'creation-failed'
        creationErrorMessage.value = getErrorMessage(error)
        return false
    }
}

// function getTaskUploadFiles(
//     task: AnalysisTask
// ): AnalysisTaskUploadFiles {
//     return {
//         r1: task.r1,
//         r2: task.r2,
//         contigs: task.contigs,
//         customerReferenceGenome:
//             task.customerReferenceGenome
//     }
// }


function getFileUploadKey(slotIndex, location) {
    return `sample/${slotIndex}/${location}`
}

async function uploadTaskInput(
    task: TaskUploadItem
): Promise<void> {

    task.status = 'uploading'
    task.errorMessage = ''
    try {

        const slot = task.inputSlots[0]

        const uploadRequests: AnalysisTaskUploadFileRequest[] = []
        const uploadFileList: UploadFile[] = []
        if (slot.type === 0 || slot.type === 1) {
            if (!slot.r1.uploaded) {
                uploadRequests.push(
                    {
                        file: slot.r1.file,
                        key: getFileUploadKey(0, 0),
                        sequenceLevel: SEQUENCE_LEVEL_READ,
                        taskId: task.taskAssingedId
                    }
                )

                uploadFileList.push(slot.r1)
            }
            if (slot.type === 0 && !slot.r2.uploaded) {
                uploadRequests.push({
                    file: slot.r2.file,
                    key: getFileUploadKey(0, 1),
                    sequenceLevel: SEQUENCE_LEVEL_READ,
                    taskId: task.taskAssingedId
                })
                uploadFileList.push(slot.r2)
            }
        } else {
            uploadRequests.push({
                file: slot.assembly.file,
                key: getFileUploadKey(0, 0),
                sequenceLevel: SEQUENCE_LEVEL_ASSEMBLY,
                taskId: task.taskAssingedId
            })
            uploadFileList.push(slot.assembly)
        }
        const requestPromiseList = uploadRequests.map((request) => {
            return doUploadAnalysisTaskInput(request)
        })

        const results = await Promise.allSettled(requestPromiseList)

        let allSuccess = true
        let forceAllsucess = false
        let pipelineNotExist = false
        let retryable = true
        results.forEach((result, index) => {
            if (forceAllsucess || pipelineNotExist) {
                return
            }
            if (result.status === 'rejected') {
                allSuccess = false
            } else {
                const response = result.value
                if (response.status === RAW_RESPONSE_STATUS_INTERNAL_FAIL || response.status === RAW_RESPONSE_STATUS_BUSINESS_FAIL) {
                    allSuccess = false
                    ElMessage.error(response.failMsg)
                } else if (response.status === uploadAnalysisTaskInputResonseCode.pipelineAleardyStart) {
                    forceAllsucess = true
                    allSuccess = true
                }
                else if (response.status === uploadAnalysisTaskInputResonseCode.pipelineNotExist) {
                    pipelineNotExist = true
                    allSuccess = false
                }
                else if (response.status === uploadAnalysisTaskInputResonseCode.invalidKey || response.status === uploadAnalysisTaskInputResonseCode.badKey) {
                    ElMessage.error(response.failMsg)
                    allSuccess = false
                    retryable = false
                } else {
                    uploadFileList[index].uploaded = true
                }
            }
        })
        task.status = allSuccess ? 'starting' : 'failed'
        if (pipelineNotExist) {
            task.errorMessage = '分析任务不存在'
            task.retryable = false
        } else if (!allSuccess) {
            task.retryable = retryable
            if (!task.retryable) {
                task.errorMessage = '上传失败'
            }
            task.errorMessage = '上传失败，请重试'
        }
        if (task.status === 'starting') {
            await startPipeline(task)
            tryUpdatePhaseValueToCompleted()
        }
    } catch (error) {
        console.error(error)
        task.status = 'failed'
        task.errorMessage = getErrorMessage(error)
    }
}

function tryUpdatePhaseValueToCompleted() {

    if (phase.value !== 'uploading' || !tasks.every((task) => { return task.status === 'success' })) { return; }

    phase.value = 'completed'

}

async function uploadTasks(
    targetTasks: TaskUploadItem[]
): Promise<void> {
    phase.value = 'uploading'


    const uploadTaskList = []
    const concurrentSize = 10
    for (const item of targetTasks) {
        item.status = 'uploading'
        uploadTaskList.push(item)
    }


    let index = 0
    let addedToBatchCount = 0

    const uploadingList: Promise<void>[] = []
    let inBatchTaskList: TaskUploadItem[] = []

    const taskPromiseMap =
        new WeakMap<TaskUploadItem, Promise<void>>()

    while (index < uploadTaskList.length) {
        // 填满当前并发批次
        for (
            ;
            index < uploadTaskList.length &&
            addedToBatchCount < concurrentSize;
            index++, addedToBatchCount++
        ) {
            const task = uploadTaskList[index]
            const promise = uploadTaskInput(task)

            uploadingList.push(promise)
            inBatchTaskList.push(task)
            taskPromiseMap.set(task, promise)
        }

        // 等待其中任意一个任务完成
        await Promise.race(uploadingList)

        const uploadingFinishedTasks =
            inBatchTaskList.filter(
                task => task.status !== 'uploading'
            )

        const finishedPromiseSet = new Set<Promise<void>>()

        uploadingFinishedTasks.forEach(task => {
            const promise = taskPromiseMap.get(task)

            if (promise) {
                finishedPromiseSet.add(promise)
            }
        })

        // 从 Promise 列表中删除已经结束的 Promise
        for (let i = uploadingList.length - 1; i >= 0; i--) {
            if (finishedPromiseSet.has(uploadingList[i])) {
                uploadingList.splice(i, 1)
            }
        }

        // 当前批次只留下仍在上传的任务
        inBatchTaskList = inBatchTaskList.filter(
            task => task.status === 'uploading'
        )

        addedToBatchCount = inBatchTaskList.length
    }

    // 等待最后一批仍在上传的任务结束
    await Promise.allSettled(uploadingList)
    tryUpdatePhaseValueToCompleted()
}

async function startUploadWorkflow(): Promise<void> {
    if (phase.value === 'ready' || phase.value === 'creation-failed') {
        const created = await createTasks()
        if (!created) {
            return
        }
    }

    await uploadTasks(tasks)
}

async function startPipeline(pipeline: TaskUploadItem) {

    try {
        const response = await requestStartPipeline(pipeline.taskAssingedId);
        if (response.status === RAW_RESPONSE_STATUS_OK || response.status === 200) {
            pipeline.status = 'success'
            return
        }

        if (response.status === RAW_RESPONSE_STATUS_DUPLICATE_OPERATION) {
            return
        }

        let retryable = true
        let status: TaskUploadStatus = 'startFailed'

        if (response.status === 404) {
            retryable = false
            ElMessage.error(`分析流水线 ${pipeline.taskName} 不存在`);
            pipeline.errorMessage = response.failMsg;
        }

        if (response.status === RAW_RESPONSE_STATUS_BUSINESS_FAIL) {
            retryable = false
            ElMessage.error(response.failMsg);
            pipeline.errorMessage = response.failMsg
        }
        if (response.status === RAW_RESPONSE_STATUS_INTERNAL_FAIL) {
            ElMessage.error(response.failMsg)
            pipeline.errorMessage = response.failMsg
        }
        pipeline.retryable = retryable
        pipeline.status = status
    } catch (error) {
        ElMessage.error(`分析流水线 ${pipeline.taskName} 启动失败`)
        pipeline.status = 'startFailed'
        pipeline.errorMessage = '启动失败，请稍后重试'

    }
}

async function retryCreation(): Promise<void> {
    tasks.forEach((item) => {
        item.status = 'waiting'
        item.errorMessage = ''
    })
    startUploadWorkflow()
}

async function retryTask(
    item: TaskUploadItem
): Promise<void> {
    phase.value = 'uploading'

    if (item.status === 'failed') {
        await uploadTaskInput(item)
    } else {
        item.status = 'starting'
        await startPipeline(item)
    }
    tryUpdatePhaseValueToCompleted()


}

async function retryFailedTasks(): Promise<void> {
    const failedTasks = tasks.filter(
        (item) =>
            (item.status === 'failed' || item.status === 'startFailed') && item.retryable
    )

    await uploadTasks(failedTasks)
}

onMounted(() => {
    if (taskUploadRequest) {
        startUploadWorkflow()
    }
})


const taskListView = computed(() => {

    const viewTaskList = tasks.filter((task) => {
        return task.status === 'failed' || task.status === 'startFailed'
    })

    const normalTaskList = tasks.filter((task) => { return task.status !== 'failed' && task.status!=='startFailed' })
    viewTaskList.push(...normalTaskList)
    return viewTaskList

})

</script>

<template>
    <div class="task-upload-page">
        <div v-if="phase === 'missing'" class="empty-state">
            <el-result icon="warning" title="没有待上传任务" sub-title="创建任务上下文已经丢失，请重新进入任务创建流程">
                <template #extra>
                    <el-button type="primary" @click="emit('cancel')">
                        返回
                    </el-button>
                </template>
            </el-result>
        </div>

        <template v-else>
            <header class="page-heading">
                <div>
                    <!-- <span class="eyebrow">TASK UPLOAD</span> -->
                    <h1>任务创建并上传测序数据</h1>
                    <!-- <p>
                        系统将先批量创建 {{ tasks.length }} 个任务，再依次上传每个任务的数据文件。
                    </p> -->
                </div>

                <el-tag v-if="isWorking" type="warning" effect="light" round>
                    <el-icon class="is-loading">
                        <Loading />
                    </el-icon>
                    正在处理
                </el-tag>
                <el-tag v-else-if="phase === 'completed' && failedTaskCount === 0" type="success" effect="light" round>
                    全部完成
                </el-tag>
                <el-tag v-else-if="phase === 'completed'" type="danger" effect="light" round>
                    部分失败
                </el-tag>
            </header>

            <el-card shadow="never" class="workflow-card">
                <el-steps :active="stepActive" align-center finish-status="success">
                    <el-step title="批量创建任务" />
                    <el-step title="上传任务数据" />
                    <el-step title="完成" />
                </el-steps>
            </el-card>

            <el-card shadow="never" class="context-card">
                <el-descriptions :column="3">
                    <el-descriptions-item label="所属项目">
                        {{ project?.projectName ?? '--' }}
                    </el-descriptions-item>
                    <el-descriptions-item label="分析类型">
                        {{ getAnalysisPipelineTypeName(pipelineType) }}
                    </el-descriptions-item>
                    <el-descriptions-item :label="isVirusAnalysis ? '分析目标' : '参考基因组'">
                        <template v-if="isVirusAnalysis">
                            {{ virusTarget ? `${virusTarget.label} · Tax ID ${virusTarget.taxId}` : '--' }}
                        </template>
                        <template v-else>{{
                            referenceGenome
                                ? `${referenceGenome.refseqName} · Tax ID ${referenceGenome.taxId}`
                                : '--'
                        }}</template>
                    </el-descriptions-item>
                    <el-descriptions-item v-if="isVirusAnalysis" label="本次参考范围">
                        已选择 {{ enabledReferenceIds?.length ?? 0 }} 条参考序列
                    </el-descriptions-item>
                </el-descriptions>
            </el-card>

            <el-alert v-if="phase === 'creation-failed'" class="creation-alert" type="error" title="批量创建任务失败"
                :description="creationErrorMessage" :closable="false" show-icon />

            <el-card shadow="never" class="task-list-card">
                <template #header>
                    <div class="task-list-heading">
                        <div>
                            <strong>任务处理状态</strong>
                            <span>成功 {{ completedTaskCount }} / {{ tasks.length }}</span>
                        </div>

                        <el-progress :percentage="tasks.length
                            ? Math.round(
                                ((completedTaskCount + failedTaskCount) /
                                    tasks.length) *
                                100
                            )
                            : 0
                            " :stroke-width="8" :show-text="false" />
                    </div>
                </template>

                <el-table :data="taskListView" :row-key="getTaskRowKey">
                    <el-table-column type="index" label="#" width="56" align="center" />
                    <el-table-column label="任务名称" min-width="170">
                        <template #default="{ row }">
                            {{ row.taskName }}
                        </template>
                    </el-table-column>
                    <el-table-column label="数据类型" width="130">
                        <template #default="{ row }">
                            {{ getDataTypeLabel(row.inputSlots[0].type) }}
                        </template>
                    </el-table-column>
                    <el-table-column label="文件" min-width="260">
                        <template #default="{ row }">
                            <span class="file-summary">
                                {{ getFileSummary(row) }}
                            </span>
                        </template>
                    </el-table-column>
                    <el-table-column label="状态" width="120">
                        <template #default="{ row }">
                            <el-tag :type="getStatusType(row.status)" effect="light" round>
                                <el-icon v-if="row.status === 'uploading'" class="is-loading">
                                    <Loading />
                                </el-icon>
                                {{ getStatusLabel(row.status) }}
                            </el-tag>
                        </template>
                    </el-table-column>
                    <el-table-column label="错误信息" min-width="180">
                        <template #default="{ row }">
                            <span :class="[
                                'error-message',
                                { visible: row.errorMessage }
                            ]">
                                {{ row.errorMessage || '--' }}
                            </span>
                        </template>
                    </el-table-column>
                    <el-table-column label="操作" width="90" fixed="right">
                        <template #default="{ row }">
                            <el-button v-if="
                                (row.status === 'failed' || row.status === 'startFailed') && row.retryable
                            " link type="primary" @click="retryTask(row)">
                                重试
                            </el-button>
                            <span v-else>--</span>
                        </template>
                    </el-table-column>
                </el-table>
            </el-card>

            <footer class="page-actions">
                <div>
                    <el-button v-if="phase === 'creation-failed'" type="primary" :loading="isWorking"
                        @click="retryCreation">
                        重试创建
                    </el-button>

                    <el-button v-if="
                        phase === 'completed' &&
                        failedTaskCount > 0
                    " type="primary" @click="retryFailedTasks">
                        重试全部失败任务
                    </el-button>
                </div>

                <el-button v-if="
                    phase === 'completed' ||
                    phase === 'creation-failed'
                " :type="phase === 'completed'
                    ? 'primary'
                    : 'default'
                    " @click="emit('submitted')">
                    返回任务列表
                </el-button>
            </footer>
        </template>
    </div>
</template>

<style scoped>
.task-upload-page {
    width: min(1180px, 100%);
    margin: 0 auto;
    padding: 8px 0 30px;
}

.page-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
}

.page-heading h1 {
    margin: 5px 0 8px;
    color: #243936;
    font-size: 25px;
}

.page-heading p {
    margin: 0;
    color: #788683;
    font-size: 14px;
}

.eyebrow {
    color: #4c9b8e;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
}

.workflow-card,
.context-card,
.task-list-card,
.creation-alert {
    margin-bottom: 16px;
}

.workflow-card {
    padding: 8px 0;
}

.task-list-heading {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) minmax(220px, 340px);
    align-items: center;
    gap: 30px;
}

.task-list-heading div {
    display: flex;
    align-items: baseline;
    gap: 12px;
}

.task-list-heading strong {
    color: #2f4541;
}

.task-list-heading span {
    color: #899592;
    font-size: 12px;
}

.file-summary {
    display: block;
    overflow: hidden;
    color: #5d6e6b;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.error-message {
    color: #98a29f;
    font-size: 12px;
}

.error-message.visible {
    color: #d65656;
}

.page-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 42px;
}

.empty-state {
    display: grid;
    min-height: 520px;
    place-items: center;
}

@media (max-width: 760px) {

    .page-heading,
    .page-actions {
        align-items: stretch;
        flex-direction: column;
    }

    .task-list-heading {
        grid-template-columns: 1fr;
        gap: 12px;
    }
}
</style>
