import type { AnalysisPipeline, AnalysisPipelineStage } from '../common/analysisPipeline'

interface AnalysisPipelineStageDTO {
  stageId: number
  stageName: string
  status: number
  startTime: string | null
  stageType: number
  outputUrl: Record<string, string>
  outputInline: Record<string, unknown>
}

interface AnalysisPipelineDTO {
  pipelineId: number
  pipelineType: number
  status: number
  analysisPipelineName: string
  createTime: string
  projectId: number
}

export type AnalysisPipelineType = 100 | 101 | 200 | 400 | 401
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
  speciesName: string
  sourceDB: string
  taxId: number
  meta: ReferenceGenomeMeta
  accessions: string[]
  isSegment: boolean
}

export interface FetchReferenceGenomeResult {
  referenceGenomes: ReferenceGenome[]
  totalRecords: number
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

const mockAnalysisPipelineStages: AnalysisPipelineStageDTO[] = [
  {
    stageId: 1,
    stageName: '数据预处理',
    status: analysisPipelineStageStatus.completed,
    startTime: '2026-07-25T09:00:00+08:00',
    stageType: 100,
    outputUrl: {
      cleanManifest: '/mock/pipelines/1/preprocess/clean_manifest.json'
    },
    outputInline: {
      inputFileCount: 2,
      paired: true
    }
  },
  {
    stageId: 2,
    stageName: '数据质控',
    status: analysisPipelineStageStatus.completed,
    startTime: '2026-07-25T09:02:18+08:00',
    stageType: 101,
    outputUrl: {
      report: '/mock/pipelines/1/qc/fastp_report.html'
    },
    outputInline: {
      q30: 94.7,
      cleanReads: 6824310
    }
  },
  {
    stageId: 3,
    stageName: '基因组组装',
    status: analysisPipelineStageStatus.completed,
    startTime: '2026-07-25T09:11:00+08:00',
    stageType: 102,
    outputUrl: {
      contigs: '/mock/pipelines/1/assembly/contigs.fasta'
    },
    outputInline: {
      totalLength: 5120000,
      n50: 186420
    }
  },
  {
    stageId: 4,
    stageName: '物种鉴定',
    status: analysisPipelineStageStatus.running,
    startTime: '2026-07-25T09:22:05+08:00',
    stageType: 103,
    outputUrl: {},
    outputInline: {
      progress: 68
    }
  },
  {
    stageId: 5,
    stageName: '耐药基因分析',
    status: analysisPipelineStageStatus.pending,
    startTime: null,
    stageType: 104,
    outputUrl: {},
    outputInline: {}
  },
  {
    stageId: 6,
    stageName: '报告生成',
    status: analysisPipelineStageStatus.pending,
    startTime: null,
    stageType: 105,
    outputUrl: {},
    outputInline: {}
  }
]

const mockPipelineTypeData = [
  analysisPipelineTypeCodes.regularVirus,
  analysisPipelineTypeCodes.regularBacteria,
  analysisPipelineTypeCodes.virusCovid
]

function getMockAnalysisPipelineStages(pipelineId: number): AnalysisPipelineStageDTO[] {
  const mockPipelineType = mockPipelineTypeData[pipelineId % 3]

  const getStageOutputUrls = (
    stageId: number,
    stageType: number
  ): Record<string, string> => {
    const outputBasePath = `stageOutput/${stageId}`

    switch (stageType) {
      case pipelineStageTypeCode.qc:
        return {
          cleanedR1: `${outputBasePath}/cleaned_r1.fastq.gz`,
          cleanedR2: `${outputBasePath}/cleaned_r2.fastq.gz`,
          reportHTML: `${outputBasePath}/cleaned.html`,
          reportJSON: `${outputBasePath}/cleaned.json`
        }
      case pipelineStageTypeCode.mapping:
      case pipelineStageTypeCode.mappingNoRefseq:
        return {
          bamUrl: `${outputBasePath}/result.bam`,
          bamIndexUrl: `${outputBasePath}/result.bam.bai`
        }
      case pipelineStageTypeCode.variantCall:
        return {
          vcfGzUrl: `${outputBasePath}/variants.vcf.gz`,
          vcfTbiUrl: `${outputBasePath}/variants.vcf.gz.tbi`,
          coverageDepth: `${outputBasePath}/coverage_depth.tsv`
        }
      case pipelineStageTypeCode.consensus:
        return {
          consensusUrl: `${outputBasePath}/consensus.fa`
        }
      case pipelineStageTypeCode.amr:
        return {
          amrResult: `${outputBasePath}/amr.tsv`
        }
      case pipelineStageTypeCode.mlst:
        return {
          mlst: `${outputBasePath}/mlst.tsv`
        }
      case pipelineStageTypeCode.serotype:
        return {
          serotypeResultUrl: `${outputBasePath}/serotypeResult.txt`
        }
      case pipelineStageTypeCode.assembly:
        return {
          contigsUrl: `${outputBasePath}/contigs.fasta`,
          scaffoldUrl: `${outputBasePath}/scaffolds.fasta`
        }
      case pipelineStageTypeCode.snpAnnotation:
        return {
          annotatedVCF: `${outputBasePath}/annotated.vcf`
        }
      case pipelineStageTypeCode.referenceComparison:
        return {
          pafPath: `${outputBasePath}/alignment.paf`,
          differenceTsv: `${outputBasePath}/reference_difference.tsv`
        }
      default:
        return {}
    }
  }

  const getStageOutputInline = (
    stageType: number,
    status: number
  ): Record<string, unknown> => {
    if (stageType === pipelineStageTypeCode.taxonomy) {
      return {
        status: taxonomyResultStatusCode.ambiguous,
        best: {
          taxId: 562,
          name: 'Escherichia coli',
          score: 0.987
        },
        candiates: [
          {
            taxId: 573,
            name: 'Klebsiella pneumoniae',
            score: 0.824
          },
          {
            taxId: 28901,
            name: 'Salmonella enterica',
            score: 0.716
          },
          {
            taxId: 620,
            name: 'Shigella',
            score: 0.681
          }
        ]
      }
    }

    return status === analysisPipelineStageStatus.running ? { progress: 68 } : {}
  }

  const createStage = (index: number, stageName: string, stageType: number, status: number) => ({
    stageId: pipelineId * 100 + index,
    stageName,
    status,
    startTime:
      status === analysisPipelineStageStatus.pending
        ? null
        : `2026-07-25T09:${String(index * 3).padStart(2, '0')}:00+08:00`,
    stageType,
    outputUrl:
      status === analysisPipelineStageStatus.completed
        ? getStageOutputUrls(pipelineId * 100 + index, stageType)
        : {},
    outputInline: getStageOutputInline(stageType, status)
  })

  if (mockPipelineType === analysisPipelineTypeCodes.regularVirus) {
    return [
      createStage(
        1,
        '预处理',
        pipelineStageTypeCode.readInspect,
        analysisPipelineStageStatus.completed
      ),
      createStage(2, '质控', pipelineStageTypeCode.qc, analysisPipelineStageStatus.completed),
      createStage(3, '组装', pipelineStageTypeCode.mapping, analysisPipelineStageStatus.completed),
      createStage(
        4,
        '变异调用',
        pipelineStageTypeCode.variantCall,
        analysisPipelineStageStatus.pending
      ),
      createStage(
        6,
        '一致性序列生成',
        pipelineStageTypeCode.consensus,
        analysisPipelineStageStatus.pending
      )
    ]
  }

  if (mockPipelineType === analysisPipelineTypeCodes.regularBacteria) {
    return [
      createStage(
        1,
        '预处理',
        pipelineStageTypeCode.readInspect,
        analysisPipelineStageStatus.completed
      ),
      createStage(2, '质控', pipelineStageTypeCode.qc, analysisPipelineStageStatus.completed),
      createStage(
        3,
        '无参组装',
        pipelineStageTypeCode.assembly,
        analysisPipelineStageStatus.completed
      ),
      createStage(
        4,
        '物种鉴定',
        pipelineStageTypeCode.taxonomy,
        analysisPipelineStageStatus.completed
      ),
      createStage(5, 'AMR', pipelineStageTypeCode.amr, analysisPipelineStageStatus.running),
      createStage(
        6,
        '毒力因子',
        pipelineStageTypeCode.virulence,
        analysisPipelineStageStatus.running
      ),
      createStage(7, 'MLST', pipelineStageTypeCode.mlst, analysisPipelineStageStatus.pending),
      createStage(8, 'cgMLST', pipelineStageTypeCode.cgmlst, analysisPipelineStageStatus.pending),
      createStage(9, '血清型', pipelineStageTypeCode.serotype, analysisPipelineStageStatus.pending)
    ]
  }

  return [
    createStage(
      1,
      '预处理',
      pipelineStageTypeCode.readInspect,
      analysisPipelineStageStatus.completed
    ),
    createStage(2, '质控', pipelineStageTypeCode.qc, analysisPipelineStageStatus.completed),
    createStage(3, '组装', pipelineStageTypeCode.mapping, analysisPipelineStageStatus.completed),
    createStage(
      4,
      '变异调用',
      pipelineStageTypeCode.variantCall,
      analysisPipelineStageStatus.pending
    ),
    createStage(
      6,
      '一致性序列生成',
      pipelineStageTypeCode.consensus,
      analysisPipelineStageStatus.pending
    ),
    createStage(
      7,
      'SNP注释',
      pipelineStageTypeCode.snpAnnotation,
      analysisPipelineStageStatus.pending
    )
  ]
}

async function doRequestPipelineStages(pipelineId: number): Promise<AnalysisPipelineStageDTO[]> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 300 + Math.random() * 500)
  })

  if (!Number.isInteger(pipelineId) || pipelineId <= 0) {
    throw new Error('无效的分析流水线 ID')
  }

  return getMockAnalysisPipelineStages(pipelineId)
}

function convertPipelineStageDTO(dto: AnalysisPipelineStageDTO): AnalysisPipelineStage {
  return {
    stageId: dto.stageId,
    stageName: dto.stageName,
    status: dto.status,
    startTime: dto.startTime ? new Date(dto.startTime) : null,
    stageType: dto.stageType,
    output: {
      urls: { ...dto.outputUrl },
      inline: { ...dto.outputInline }
    }
  }
}

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

async function doRequestPipeline(pipelineId: number): Promise<AnalysisPipelineDTO> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 300 + Math.random() * 500)
  })

  if (false && (!Number.isInteger(pipelineId) || pipelineId <= 0)) {
    throw new Error('无效的分析流水线 ID')
  }

  if (true) {
    return getMockPipeline(pipelineId)
  }

  return {
    pipelineId,
    pipelineType: 200,
    status: 0,
    analysisPipelineName: `mock-${pipelineId}`,
    createTime: '2026-07-25T09:00:00+08:00',
    projectId: 1
  }
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

export async function requestPipelineStages(pipelineId: number): Promise<AnalysisPipelineStage[]> {
  const stageDTOList = await doRequestPipelineStages(pipelineId)

  return stageDTOList.map(convertPipelineStageDTO)
}

export async function requestPipeline(pipelineId: number): Promise<AnalysisPipeline> {
  const pipelineDTO = await doRequestPipeline(pipelineId)
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

const mockReferenceGenomes: ReferenceGenome[] = mockReferenceGenomeSpecies.flatMap(
  (species, speciesIndex) =>
    Array.from({ length: 5 }, (_, strainIndex) => {
      const index = speciesIndex * 5 + strainIndex + 1

      return {
        refId: index,
        speciesName: `${species.name} strain MOCK-${strainIndex + 1}`,
        sourceDB: 'NCBI RefSeq',
        taxId: species.taxId,
        meta: {
          genomeLength: `${(species.genomeLength + strainIndex * 0.03).toFixed(2)} Mb`,
          version: `v${strainIndex + 1}`
        },
        accessions: [`GCF_${String(900000000 + index).padStart(9, '0')}.${strainIndex + 1}`],
        isSegment: false
      }
    })
)

export async function fetchReferenceGenomeList(
  query: string,
  start: number,
  size: number
): Promise<FetchReferenceGenomeResult> {
  await new Promise((resolve) => {
    setTimeout(resolve, 500)
  })

  const normalizedQuery = String(query ?? '')
    .trim()
    .toLowerCase()
  const normalizedStart = Math.max(0, Number(start) || 0)
  const normalizedSize = Math.max(1, Number(size) || 20)

  const filteredReferenceGenomes = normalizedQuery
    ? mockReferenceGenomes.filter((referenceGenome) =>
        [
          referenceGenome.refId,
          referenceGenome.speciesName,
          referenceGenome.taxId,
          referenceGenome.sourceDB,
          ...referenceGenome.accessions
        ].some((field) => String(field).toLowerCase().includes(normalizedQuery))
      )
    : mockReferenceGenomes

  return {
    referenceGenomes: filteredReferenceGenomes.slice(
      normalizedStart,
      normalizedStart + normalizedSize
    ),
    totalRecords: filteredReferenceGenomes.length
  }
}

export async function canUseBatchPrefix(prefix, projectId) {
  // TODO: replace with backend API.
  const forbiddenPrefixesByProject = {
    default: ['teapot', 'test1', 'test2', 'test3', "I'm a test"]
  }
  const forbiddenPrefixes =
    forbiddenPrefixesByProject[projectId] ?? forbiddenPrefixesByProject.default
  const normalizedPrefix = prefix.trim().toLowerCase()

  return !forbiddenPrefixes.some((item) => item.toLowerCase() === normalizedPrefix)
}

// function getRandomMockMode() {
//   const random = Math.random()
//   const { success, businessError, networkError } = analysisTaskMockProbabilities

//   if (random < success) return AnalysisTaskMockMode.SUCCESS
//   if (random < success + businessError) return AnalysisTaskMockMode.BUSINESS_ERROR
//   if (random < success + businessError + networkError) {
//     return AnalysisTaskMockMode.NETWORK_ERROR
//   }

//   return AnalysisTaskMockMode.SERVER_ERROR
// }

// function getEffectiveMockMode() {
//   return currentMockMode === AnalysisTaskMockMode.RANDOM ? getRandomMockMode() : currentMockMode
// }

function createMockError(message, code) {
  return Object.assign(new Error(message), { code })
}

interface AnalysisTaskBuildRequest {
  analysisName: string
  projectId: number
  pipelineType: number
  pipelineStageParameters: {
    taxId: number | null
    extraParameters: null
  }
}

export interface CreatedAnalysisTask {
  name: string
  id: number
}

export type AnalysisTaskBuildResponse =
  | {
      success: true
      code: 'SUCCESS'
      message: string
      nameIdList: CreatedAnalysisTask[]
    }
  | {
      success: false
      code: string
      message: string
      nameIdList: null
    }

async function doAnalysisTaskRequest(
  taskBuildRequestList: AnalysisTaskBuildRequest[]
): Promise<AnalysisTaskBuildResponse> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const mode = getEffectiveMockMode()

      if (mode === AnalysisTaskMockMode.NETWORK_ERROR) {
        reject(createMockError('模拟网络连接失败，请检查网络后重试', 'NETWORK_ERROR'))
        return
      }

      if (mode === AnalysisTaskMockMode.SERVER_ERROR) {
        reject(createMockError('模拟服务器内部错误，请稍后重试', 'SERVER_ERROR'))
        return
      }

      if (mode === AnalysisTaskMockMode.BUSINESS_ERROR) {
        resolve({
          success: false,
          code: 'TASK_NAME_CONFLICT',
          message: '当前项目中存在其他重复的任务名称，不能创建',
          nameIdList: null
        })
        return
      }

      resolve({
        success: true,
        code: 'SUCCESS',
        message: '任务创建成功',
        nameIdList: taskBuildRequestList.map((task) => ({
          name: task.analysisName,
          id: Math.random() * 100000
        }))
      })
    }, 1000)
  })
}

export async function requestBuildAnalysisTasks(
  tasks: Array<{ name: string }>,
  projectId: number,
  pipelineType: number,
  referenceTaxId: number | null
): Promise<AnalysisTaskBuildResponse> {
  const taskBuildRequestList = tasks.map((task) => ({
    analysisName: task.name,
    projectId,
    pipelineType,
    pipelineStageParameters: {
      taxId: referenceTaxId,
      extraParameters: null
    }
  }))

  return doAnalysisTaskRequest(taskBuildRequestList)
}

import { RAW_RESPONSE_STATUS_BUSINESS_FAIL, RAW_RESPONSE_STATUS_OK, RawResponse } from './common'

export type TaskUploadMockMode =
  'success' | 'business-error' | 'network-error' | 'server-error' | 'random'

export type SequenceLevel = 0 | 1

export const SEQUENCE_LEVEL_READ = 0
export const SEQUENCE_LEVEL_ASSEMBLY = 1

const API_SEQUENCE_LEVEL_READ = 0
const API_SEQUENCE_LEVEL_ASSEMBLY = 1

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

function getEffectiveMockMode(): Exclude<TaskUploadMockMode, 'random'> {
  return currentMockMode === 'random' ? getRandomMockMode() : currentMockMode
}

function createUploadError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
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

export async function doComfirmTaxonomy(stageId: number, taxId: number):Promise<RawResponse<void>>{



  await new Promise((res) => {
    setTimeout(res, 600);
  })
  //TODO
  return ({} as RawResponse<void>)


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
  const formData = buildTaskUploadFormData(taskUploadRequest)

  // TODO: replace this mock with the real multipart upload request.

  const response = await doAnalysisUploadFile(formData)
  const mode = getEffectiveMockMode()
  if (mode === 'network-error') {
    throw createUploadError('网络连接失败，请稍后重试', 'NETWORK_ERROR')
  }
  if (mode === 'server-error') {
    throw createUploadError('服务器处理上传失败，请稍后重试', 'SERVER_ERROR')
  }

  if (mode === 'business-error') {
    return {
      status: RAW_RESPONSE_STATUS_BUSINESS_FAIL,
      data: -1,
      failMsg: ''
    }
  }

  return response
}



export async function doRequestPipelineStates(
  pipelineIds: number[] = []
): Promise<RawResponse<PipelineState[]>> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 300 + Math.random() * 400)
  })

  const targetPipelineIds =
    pipelineIds.length > 0
      ? pipelineIds
      : Array.from({ length: 12 }, (_, index) => index + 1)

  const mockProjectNames = [
    '肠道致病菌监测（第三批）',
    '呼吸道病毒哨点监测',
    '院感菌株溯源分析',
    '食品来源沙门氏菌调查'
  ]

  const pipelineStates = await Promise.all(
    targetPipelineIds.map(async (pipelineId) => {
      const pipeline = getMockPipeline(pipelineId)
      const pipelineInputResponse = await doRequestPipelineInput(pipelineId)

      return {
        pipelineId,
        pipelineName: pipeline.analysisPipelineName,
        pipelineType: pipeline.pipelineType,
        projectName:
          mockProjectNames[pipelineId % mockProjectNames.length],
        pipelineInputs: pipelineInputResponse.data,
        pipelineStages: getMockAnalysisPipelineStages(pipelineId).map(
          convertPipelineStageDTO
        )
      }
    })
  )

  return {
    status: RAW_RESPONSE_STATUS_OK,
    data: pipelineStates,
    failMsg: ''
  }
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
