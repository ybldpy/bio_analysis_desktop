import type { AnalysisPipeline, AnalysisPipelineStage } from '../common/analysisPipeline'
import {backendService, backendAPI} from './backendService'
import { convertStageResult, type AnalysisPipelineStageDTO } from '../common/pipelineResults'
import { confirmTaxonomy, type TaxonomyConfirmationData } from './pipelineResults'

interface AnalysisPipelineDTO {
  pipelineId: number
  pipelineType: number
  status: number
  analysisPipelineName: string
  createTime: string
  projectId: number
}

export type AnalysisPipelineType = 100 | 101 | 200 | 400 | 401
export type SequencingPlatform = 0 | 1001 | 1002 | 2001 | 2002

export interface VirusTarget {
  label: string
  taxId: number
  pipelineType: 100 | 101
}

export const taxonomyResultStatusCode = {
  confident: 0,
  ambiguous: 1,
  lowConfidence: 2,
  outPanel: 3,
  userManul: 4
}


export const pipelineInputConstants = {
  pipelineInputFileRoleRead: 10,
  pipelineInputFileRoleAssembly: 11
}
export interface PipelineInput {
  inputFileId: number
  pipelineId: number
  fileRole: number
  fileName: string
  status: number
  inputKey: string
}


export interface ReferenceGenomeMeta {
  genomeLength: string
  version: string
}

export interface ReferenceGenome {
  refId: number
  refseqName: string
  sourceDB: string
  taxId: number
  meta: Record<string,string> | any
  accessions: string[] | string
  isSegment: boolean
}


export interface FetchReferenceGenomeResult {
  referenceGenomes: ReferenceGenome[]
  total: number
}

export interface PipelineState {
  pipelineId: number
  pipelineName: string
  pipelineType: number
  projectName: string
  pipelineInputs: PipelineInput[]
  pipelineStages: AnalysisPipelineStage[]
}

interface MockReferenceGenomeSpecies {
  name: string
  taxId: number
  genomeLength: number
}

const AnalysisTaskMockMode = Object.freeze({
  SUCCESS: 'success',
  BUSINESS_ERROR: 'business-error',
  NETWORK_ERROR: 'network-error',
  SERVER_ERROR: 'server-error',
  RANDOM: 'random'
})

const analysisTaskMockProbabilities = Object.freeze({
  success: 0.6,
  businessError: 0.2,
  networkError: 0.1,
  serverError: 0.1
})

export const analysisPipelineStageStatus = {
  pending: 0,
  queuing: 1,
  running: 2,
  failed: 3,
  completed: 4,
  actionRequired: 5,
  notApplicable: 6
} as const

export const pipelineTypeCode = {
  regularVirus: 100,
  covid19: 101,
  bacteria: 200
} as const

export const pipelineStatusCode = {
  waittingUploading: 3,
  running: 1,
  complete: 2
} as const

export const pipelineStageTypeCode = {
  qc: 0,
  taxonomy: 10,
  mapping: 20,
  mappingNoRefseq: 21,
  assembly: 30,
  assemblyPolish: 31,
  variantCall: 40,
  consensus: 41,
  depthCoverage: 42,
  referenceComparison: 43,
  referenceSelection: 44,
  amr: 60,
  virulence: 61,
  mlst: 62,
  cgmlst: 63,
  serotype: 64,
  snpSingle: 70,
  snpCore: 71,
  snpAnnotation: 72,
  snpMergeResult: 73,
  readInspect: 80,
  metagenomicsAmplicon16S: 90,
  metagenomicsShotgun: 91
} as const

export const analysisPipelineTypeCodes = Object.freeze({
  regularVirus: 100,
  virusCovid: 101,
  regularBacteria: 200,
  metagenomeAmplicon16: 400,
  metagenomeShotgun: 401
})

const mockPipelineTypeData = [
  analysisPipelineTypeCodes.regularVirus,
  analysisPipelineTypeCodes.regularBacteria,
  analysisPipelineTypeCodes.virusCovid
]

function getMockPipeline(pipelineId: number): AnalysisPipelineDTO {
  return {
    pipelineId: pipelineId,
    pipelineType: mockPipelineTypeData[pipelineId % 3],
    analysisPipelineName: `mock - ${pipelineId}`,
    createTime: '2026-07-25T09:00:00+08:00',
    projectId: 1,
    status: pipelineStatusCode.running
  }
}

async function doRequestPipeline(pipelineId: number, signal?: AbortSignal): Promise<AnalysisPipelineDTO> {

  const response = await backendService.get(backendAPI.getPipeline, {
    signal,
    timeout: 30000,
    params: {
      pipelineId: pipelineId
    }
  }) as RawResponse<AnalysisPipelineDTO>

  if(response.status !== RAW_RESPONSE_STATUS_OK){
    throw new Error(response.failMsg)
  }

  return response.data

}

function convertPipelineDTO(dto: AnalysisPipelineDTO): AnalysisPipeline {
  return {
    pipelineId: dto.pipelineId,
    pipelineType: dto.pipelineType,
    status: dto.status,
    analysisPipelineName: dto.analysisPipelineName,
    createTime: new Date(dto.createTime),
    projectId: dto.projectId
  }
}

export async function requestPipelineStages(pipelineId: number, signal?: AbortSignal): Promise<AnalysisPipelineStage[]> {
  const response = await backendService.get(backendAPI.getPipelineStages, {
    signal,
    timeout: 30000,
    params:{
      pipelineId: pipelineId
    }
  }) as RawResponse<AnalysisPipelineStageDTO[]>

  if(response.status !== RAW_RESPONSE_STATUS_OK){
    throw new Error(response.failMsg)
  }

  return (response.data as AnalysisPipelineStageDTO[]).map(convertStageResult)

}

export async function requestPipeline(pipelineId: number, signal?: AbortSignal): Promise<AnalysisPipeline> {
  const pipelineDTO = await doRequestPipeline(pipelineId, signal)
  return convertPipelineDTO(pipelineDTO)
}

let currentMockMode: TaskUploadMockMode = 'random'

/**
 * 切换批量创建任务的模拟结果，便于稳定测试指定状态。
 */
export function setAnalysisTaskMockMode(mode) {
  if (!Object.values(AnalysisTaskMockMode).includes(mode)) {
    throw new Error(`不支持的任务模拟模式：${mode}`)
  }

  currentMockMode = mode
}

const mockReferenceGenomeSpecies: MockReferenceGenomeSpecies[] = [
  { name: 'Escherichia coli', taxId: 562, genomeLength: 4.64 },
  { name: 'Staphylococcus aureus', taxId: 1280, genomeLength: 2.82 },
  { name: 'Klebsiella pneumoniae', taxId: 573, genomeLength: 5.39 },
  { name: 'Pseudomonas aeruginosa', taxId: 287, genomeLength: 6.26 },
  { name: 'Acinetobacter baumannii', taxId: 470, genomeLength: 3.98 },
  { name: 'Salmonella enterica', taxId: 28901, genomeLength: 4.82 },
  { name: 'Listeria monocytogenes', taxId: 1639, genomeLength: 2.94 },
  { name: 'Bacillus subtilis', taxId: 1423, genomeLength: 4.22 },
  { name: 'Enterococcus faecium', taxId: 1352, genomeLength: 2.81 },
  { name: 'Vibrio cholerae', taxId: 666, genomeLength: 4.03 },
  { name: 'Mycobacterium tuberculosis', taxId: 1773, genomeLength: 4.41 },
  { name: 'Campylobacter jejuni', taxId: 197, genomeLength: 1.64 }
]

export async function fetchReferenceGenomeList(
  query: string,
  start: number,
  size: number
): Promise<RawResponse<FetchReferenceGenomeResult>> {
  

  const response = await backendService.post(backendAPI.queryReferenceGenomes, {
    query: query,
    start: start,
    pageSize: size
  }) as RawResponse<FetchReferenceGenomeResult>



  if(response.status === RAW_RESPONSE_STATUS_OK){
    response.data.referenceGenomes.forEach((referenceGenome) => {
      if(referenceGenome.accessions){
        referenceGenome.accessions = (JSON.parse(referenceGenome.accessions as string) as string[])
      }
    })
  }


  
  return response



}

export async function fetchVirusTargets(): Promise<RawResponse<VirusTarget[]>> {
  return await backendService.get<RawResponse<VirusTarget[]>, RawResponse<VirusTarget[]>>(
    backendAPI.virusTargets
  )
}

export async function canUseBatchPrefix(prefix, projectId) {
  // TODO: replace with backend API.
  const response = await backendService.post(backendAPI.pipelineNamePrefixCheck, {
    projectId: projectId,
    namePrefix: prefix
  }) as RawResponse<boolean>

  return response
}

function createMockError(message, code) {
  return Object.assign(new Error(message), { code })
}

interface AnalysisTaskBuildRequest {
  analysisName: string
  projectId: number
  pipelineType: number
  pipelineStageParameters: {
    taxId: number | null
    sequencingPlatform: SequencingPlatform
    extraParams: Record<string, unknown>
  }
}

export interface CreatedAnalysisTask {
  name: string
  id: number
}

export function validateEnabledReferenceIds(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('本次任务至少需要选择一条参考序列，请返回创建页面确认参考范围')
  }
  for (const id of value) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('参考序列 ID 必须是正整数，请返回创建页面重新确认')
    }
  }
  if (new Set(value).size !== value.length) {
    throw new Error('参考序列 ID 不能重复，请返回创建页面重新确认')
  }
}

export async function requestBuildAnalysisTasks(
  tasks: Array<{ name: string; sequencingPlatform?: SequencingPlatform | null }>,
  projectId: number,
  pipelineType: number,
  parameters: {
    referenceId?: number | null
    taxId?: number | null
    enabledReferenceIds?: number[] | null
  }
): Promise<RawResponse<number[]>> {
  if (tasks.length === 0) {
    throw new Error('至少需要创建一个分析任务')
  }

  const isVirus =
    pipelineType === analysisPipelineTypeCodes.regularVirus ||
    pipelineType === analysisPipelineTypeCodes.virusCovid

  if (
    isVirus &&
    (parameters.taxId == null || !Number.isInteger(parameters.taxId) || parameters.taxId <= 0)
  ) {
    throw new Error('请选择有效的病毒分析目标')
  }

  if (isVirus && parameters.enabledReferenceIds != null) {
    validateEnabledReferenceIds(parameters.enabledReferenceIds)
  }

  const requestBody = {
    projectId: projectId,
    pipelineType: pipelineType,
    pipelines: []
  }

  const pipelines = tasks.map((task) => {

    return {
      pipelineName: task.name,
      pipelineParameters: isVirus
        ? {
            taxId: parameters.taxId,
            ...(parameters.enabledReferenceIds === undefined
              ? {}
              : { enabledReferenceIds: parameters.enabledReferenceIds === null
                  ? null
                  : [...parameters.enabledReferenceIds] }),
            sequencingPlatform: task.sequencingPlatform ?? 0,
            extraParams: {}
          }
        : {
            referenceId: parameters.referenceId ?? null,
            sequencingPlatform: task.sequencingPlatform ?? 0
          }
    }
  })
  requestBody.pipelines = pipelines


  await new Promise((res) => setTimeout(res, 1000))

  // if(true){
  //   return {
  //     status: RAW_RESPONSE_STATUS_OK,
  //     failMsg: null,
  //     data: tasks.map((task, index) => {
  //       return index
  //     })
  //   }
  // }

  return await backendService.post(backendAPI.batchCreatePipelines, requestBody)
}

import { RAW_RESPONSE_STATUS_BUSINESS_FAIL, RAW_RESPONSE_STATUS_OK, RawResponse } from './common'

export type TaskUploadMockMode =
  'success' | 'business-error' | 'network-error' | 'server-error' | 'random'

export type SequenceLevel = 0 | 1

export const SEQUENCE_LEVEL_READ = 0
export const SEQUENCE_LEVEL_ASSEMBLY = 1

const API_SEQUENCE_LEVEL_READ = 10
const API_SEQUENCE_LEVEL_ASSEMBLY = 11

export interface AnalysisTaskUploadFileRequest {
  file: File
  taskId: number
  key: string
  sequenceLevel: SequenceLevel
}

export interface AnalysisTaskUploadResponse {
  success: boolean
  code: string
  message: string
}

const mockProbabilities = {
  success: 0.75,
  businessError: 0.15,
  networkError: 0.05,
  serverError: 0.05
}

export function setTaskUploadMockMode(mode: TaskUploadMockMode): void {
  currentMockMode = mode
}

function getRandomMockMode(): Exclude<TaskUploadMockMode, 'random'> {
  const random = Math.random()

  if (random < mockProbabilities.success) {
    return 'success'
  }

  if (random < mockProbabilities.success + mockProbabilities.businessError) {
    return 'business-error'
  }

  if (
    random <
    mockProbabilities.success + mockProbabilities.businessError + mockProbabilities.networkError
  ) {
    return 'network-error'
  }

  return 'server-error'
}

function buildTaskUploadFormData(taskUploadRequest: AnalysisTaskUploadFileRequest): FormData {
  const formData = new FormData()
  formData.append('pipelineId', String(taskUploadRequest.taskId))
  formData.append('inputKey', taskUploadRequest.key)
  formData.append('fileName', taskUploadRequest.file.name)
  formData.append(
    'fileType',
    String(
      taskUploadRequest.sequenceLevel === SEQUENCE_LEVEL_READ
        ? API_SEQUENCE_LEVEL_READ
        : API_SEQUENCE_LEVEL_ASSEMBLY
    )
  )
  formData.append('inputFile', taskUploadRequest.file)
  return formData
}

async function doAnalysisUploadFile(formData): Promise<RawResponse<number>> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 700 + Math.random() * 800)
  })

  return {
    status: 0,
    data: 123,
    failMsg: ''
  }
}

export async function doComfirmTaxonomy(
  stageId: number,
  taxId: number
): Promise<RawResponse<TaxonomyConfirmationData | null>> {
  return confirmTaxonomy({ stageId, taxId })
}



export async function requestStartPipeline(pipelineId: number):Promise<RawResponse<boolean>>{





  return await backendService.get(backendAPI.startPipeline, {
    params: {
      pipelineId: pipelineId
    }
  });
}

export const uploadAnalysisTaskInputResonseCode = {
  inputExist: 100,
  badKey: 120,
  invalidKey: 110,

  pipelineNotExist: 200,
  pipelineAleardyStart: 201
}
export async function doUploadAnalysisTaskInput(
  taskUploadRequest: AnalysisTaskUploadFileRequest
): Promise<RawResponse<number>> {


  await new Promise((res) => {setTimeout(res, 1200)})
  const formData = buildTaskUploadFormData(taskUploadRequest)

  // if(true) {
  //   return {
  //     status: RAW_RESPONSE_STATUS_OK,
  //     data: 1,
  //     failMsg: null
  //   }
  // }
  return await backendService.post(backendAPI.pipelineInputFileUpload, formData, {
    headers:{
      'Content-Type': 'multipart/form-data'
    }
  })
}


export async function doRequestPipelineStates(
  pipelineIds: number[] = []
): Promise<RawResponse<PipelineState[]>> {
  const response = await backendService.post(backendAPI.getPipelineStates, pipelineIds) as RawResponse<PipelineState[]>
  return response
}

export async function doRequestPipelineInput(pipelineId: number):Promise<RawResponse<PipelineInput[]>>{

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 300 + Math.random() * 400)
  })

  const inputType = Math.floor(Math.random() * 3)
  let pipelineInputs: PipelineInput[]

  if (inputType === 0) {
    pipelineInputs = [
      {
        inputFileId: pipelineId * 10 + 1,
        pipelineId,
        fileRole: pipelineInputConstants.pipelineInputFileRoleRead,
        fileName: `pipeline_${pipelineId}_R1.fastq.gz`,
        status: 0,
        inputKey: 'r1'
      },
      {
        inputFileId: pipelineId * 10 + 2,
        pipelineId,
        fileRole: pipelineInputConstants.pipelineInputFileRoleRead,
        fileName: `pipeline_${pipelineId}_R2.fastq.gz`,
        status: 0,
        inputKey: 'r2'
      }
    ]
  } else if (inputType === 1) {
    pipelineInputs = [
      {
        inputFileId: pipelineId * 10 + 1,
        pipelineId,
        fileRole: pipelineInputConstants.pipelineInputFileRoleRead,
        fileName: `pipeline_${pipelineId}.fastq.gz`,
        status: 0,
        inputKey: 'r1'
      }
    ]
  } else {
    pipelineInputs = [
      {
        inputFileId: pipelineId * 10 + 1,
        pipelineId,
        fileRole: pipelineInputConstants.pipelineInputFileRoleAssembly,
        fileName: `pipeline_${pipelineId}_contigs.fasta`,
        status: 0,
        inputKey: 'assembly'
      }
    ]
  }

  return {
    status: RAW_RESPONSE_STATUS_OK,
    data: pipelineInputs,
    failMsg: ''
  }
}
