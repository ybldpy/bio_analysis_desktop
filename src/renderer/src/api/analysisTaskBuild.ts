// const AnalysisTaskMockMode = Object.freeze({
//   SUCCESS: 'success',
//   BUSINESS_ERROR: 'business-error',
//   NETWORK_ERROR: 'network-error',
//   SERVER_ERROR: 'server-error',
//   RANDOM: 'random'
// })

// const analysisTaskMockProbabilities = Object.freeze({
//   success: 0.6,
//   businessError: 0.2,
//   networkError: 0.1,
//   serverError: 0.1
// })


// export type AnalysisPipelineType = 100 | 101 | 200 | 400 | 401
// export const analysisPipelineTypeCodes = Object.freeze({
//   regularVirus: 100,
//   virusCovid: 101,
//   regularBacteria: 200,
//   metagenomeAmplicon16: 400,
//   metagenomeShotgun: 401
// })


// export interface ReferenceGenomeMeta {
//   genomeLength: string
//   version: string
// }

// export interface ReferenceGenome {
//   refId: number
//   speciesName: string
//   sourceDB: string
//   taxId: number
//   meta: ReferenceGenomeMeta
//   accessions: string[]
//   isSegment: boolean
// }

// export interface FetchReferenceGenomeResult {
//   referenceGenomes: ReferenceGenome[]
//   totalRecords: number
// }

// interface MockReferenceGenomeSpecies {
//   name: string
//   taxId: number
//   genomeLength: number
// }


// let currentMockMode = AnalysisTaskMockMode.RANDOM

// /**
//  * 切换批量创建任务的模拟结果，便于稳定测试指定状态。
//  */
// export function setAnalysisTaskMockMode(mode) {
//   if (!Object.values(AnalysisTaskMockMode).includes(mode)) {
//     throw new Error(`不支持的任务模拟模式：${mode}`)
//   }

//   currentMockMode = mode
// }

// const mockReferenceGenomeSpecies: MockReferenceGenomeSpecies[] = [
//   { name: 'Escherichia coli', taxId: 562, genomeLength: 4.64 },
//   { name: 'Staphylococcus aureus', taxId: 1280, genomeLength: 2.82 },
//   { name: 'Klebsiella pneumoniae', taxId: 573, genomeLength: 5.39 },
//   { name: 'Pseudomonas aeruginosa', taxId: 287, genomeLength: 6.26 },
//   { name: 'Acinetobacter baumannii', taxId: 470, genomeLength: 3.98 },
//   { name: 'Salmonella enterica', taxId: 28901, genomeLength: 4.82 },
//   { name: 'Listeria monocytogenes', taxId: 1639, genomeLength: 2.94 },
//   { name: 'Bacillus subtilis', taxId: 1423, genomeLength: 4.22 },
//   { name: 'Enterococcus faecium', taxId: 1352, genomeLength: 2.81 },
//   { name: 'Vibrio cholerae', taxId: 666, genomeLength: 4.03 },
//   { name: 'Mycobacterium tuberculosis', taxId: 1773, genomeLength: 4.41 },
//   { name: 'Campylobacter jejuni', taxId: 197, genomeLength: 1.64 }
// ]


// const mockReferenceGenomes: ReferenceGenome[] = mockReferenceGenomeSpecies.flatMap((species, speciesIndex) =>
//   Array.from({ length: 5 }, (_, strainIndex) => {
//     const index = speciesIndex * 5 + strainIndex + 1

//     return {
//       refId: index,
//       speciesName: `${species.name} strain MOCK-${strainIndex + 1}`,
//       sourceDB: 'NCBI RefSeq',
//       taxId: species.taxId,
//       meta: {
//         genomeLength: `${(species.genomeLength + strainIndex * 0.03).toFixed(2)} Mb`,
//         version: `v${strainIndex + 1}`
//       },
//       accessions: [
//         `GCF_${String(900000000 + index).padStart(9, '0')}.${strainIndex + 1}`
//       ],
//       isSegment: false
//     }
//   })
// )

// export async function fetchReferenceGenomeList(
//   query: string,
//   start: number,
//   size: number
// ): Promise<FetchReferenceGenomeResult> {
//   await new Promise((resolve) => {
//     setTimeout(resolve, 500)
//   })

//   const normalizedQuery = String(query ?? '').trim().toLowerCase()
//   const normalizedStart = Math.max(0, Number(start) || 0)
//   const normalizedSize = Math.max(1, Number(size) || 20)

//   const filteredReferenceGenomes = normalizedQuery
//     ? mockReferenceGenomes.filter((referenceGenome) =>
//         [
//           referenceGenome.refId,
//           referenceGenome.speciesName,
//           referenceGenome.taxId,
//           referenceGenome.sourceDB,
//           ...referenceGenome.accessions
//         ].some((field) => String(field).toLowerCase().includes(normalizedQuery))
//       )
//     : mockReferenceGenomes

//   return {
//     referenceGenomes: filteredReferenceGenomes.slice(
//       normalizedStart,
//       normalizedStart + normalizedSize
//     ),
//     totalRecords: filteredReferenceGenomes.length
//   }
// }




// export async function canUseBatchPrefix(prefix, projectId) {
//   // TODO: replace with backend API.
//   const forbiddenPrefixesByProject = {
//     default: ['teapot', 'test1', 'test2', 'test3', "I'm a test"]
//   }
//   const forbiddenPrefixes =
//     forbiddenPrefixesByProject[projectId] ?? forbiddenPrefixesByProject.default
//   const normalizedPrefix = prefix.trim().toLowerCase()

//   return !forbiddenPrefixes.some((item) => item.toLowerCase() === normalizedPrefix)
// }

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

// function createMockError(message, code) {
//   return Object.assign(new Error(message), { code })
// }

// interface AnalysisTaskBuildRequest {
//   analysisName: string,
//   projectId: number,
//   pipelineType: number,
//   pipelineStageParameters: {
//     taxId: number | null,
//     extraParameters: null
//   }
// }

// export interface CreatedAnalysisTask {
//   name: string
//   id: number
// }

// export type AnalysisTaskBuildResponse =
//   | {
//       success: true
//       code: 'SUCCESS'
//       message: string
//       nameIdList: CreatedAnalysisTask[]
//     }
//   | {
//       success: false
//       code: string
//       message: string
//       nameIdList: null
//     }

// async function doAnalysisTaskRequest(
//   taskBuildRequestList: AnalysisTaskBuildRequest[]
// ): Promise<AnalysisTaskBuildResponse> {
//   return new Promise((resolve, reject) => {
//     setTimeout(() => {
//       const mode = getEffectiveMockMode()

//       if (mode === AnalysisTaskMockMode.NETWORK_ERROR) {
//         reject(createMockError('模拟网络连接失败，请检查网络后重试', 'NETWORK_ERROR'))
//         return
//       }

//       if (mode === AnalysisTaskMockMode.SERVER_ERROR) {
//         reject(createMockError('模拟服务器内部错误，请稍后重试', 'SERVER_ERROR'))
//         return
//       }

//       if (mode === AnalysisTaskMockMode.BUSINESS_ERROR) {
//         resolve({
//           success: false,
//           code: 'TASK_NAME_CONFLICT',
//           message: '当前项目中存在其他重复的任务名称，不能创建',
//           nameIdList: null
//         })
//         return
//       }

//       resolve({
//         success: true,
//         code: 'SUCCESS',
//         message: '任务创建成功',
//         nameIdList: taskBuildRequestList.map((task) => ({
//           name: task.analysisName,
//           id: Math.random() * 100000
//         }))
//       })
//     }, 1000)
//   })
// }

// export async function requestBuildAnalysisTasks(
//   tasks: Array<{ name: string }>,
//   projectId: number,
//   pipelineType: number,
//   referenceTaxId: number | null
// ): Promise<AnalysisTaskBuildResponse> {
//   const taskBuildRequestList = tasks.map((task) => ({
//     analysisName: task.name,
//     projectId,
//     pipelineType,
//     pipelineStageParameters: {
//       taxId: referenceTaxId,
//       extraParameters: null
//     }
//   }))

//   return doAnalysisTaskRequest(taskBuildRequestList)
// }
