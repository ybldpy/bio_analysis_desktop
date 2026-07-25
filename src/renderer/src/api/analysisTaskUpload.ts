// import { RAW_RESPONSE_STATUS_BUSINESS_FAIL, RAW_RESPONSE_STATUS_OK, RawResponse } from "./common"

// export type TaskUploadMockMode =
//   | 'success'
//   | 'business-error'
//   | 'network-error'
//   | 'server-error'
//   | 'random'


// export type SequenceLevel = 0 | 1

// export const SEQUENCE_LEVEL_READ= 0
// export const SEQUENCE_LEVEL_ASSEMBLY = 1



// const API_SEQUENCE_LEVEL_READ = 0
// const API_SEQUENCE_LEVEL_ASSEMBLY = 1

// export interface AnalysisTaskUploadFileRequest {
//   file: File
//   taskId: number
//   key: string
//   sequenceLevel: SequenceLevel
// }



// export interface AnalysisTaskUploadResponse {
//   success: boolean
//   code: string
//   message: string
// }


// const mockProbabilities = {
//   success: 0.75,
//   businessError: 0.15,
//   networkError: 0.05,
//   serverError: 0.05
// }

// let currentMockMode: TaskUploadMockMode = 'random'

// export function setTaskUploadMockMode(mode: TaskUploadMockMode): void {
//   currentMockMode = mode
// }

// function getRandomMockMode(): Exclude<TaskUploadMockMode, 'random'> {
//   const random = Math.random()

//   if (random < mockProbabilities.success) {
//     return 'success'
//   }

//   if (
//     random <
//     mockProbabilities.success + mockProbabilities.businessError
//   ) {
//     return 'business-error'
//   }

//   if (
//     random <
//     mockProbabilities.success +
//       mockProbabilities.businessError +
//       mockProbabilities.networkError
//   ) {
//     return 'network-error'
//   }

//   return 'server-error'
// }

// function getEffectiveMockMode(): Exclude<TaskUploadMockMode, 'random'> {
//   return currentMockMode === 'random'
//     ? getRandomMockMode()
//     : currentMockMode
// }

// function createUploadError(message: string, code: string): Error {
//   return Object.assign(new Error(message), { code })
// }

// function buildTaskUploadFormData(
//   taskUploadRequest: AnalysisTaskUploadFileRequest
// ): FormData {

//   const formData = new FormData()
//   formData.append('pipelineId', String(taskUploadRequest.taskId))
//   formData.append('inputKey', taskUploadRequest.key)
//   formData.append('fileName', taskUploadRequest.file.name)
//   formData.append('fileType', String(taskUploadRequest.sequenceLevel === SEQUENCE_LEVEL_READ ? API_SEQUENCE_LEVEL_READ:API_SEQUENCE_LEVEL_ASSEMBLY))
//   formData.append('inputFile', taskUploadRequest.file)
//   return formData
// }


// async function doAnalysisUploadFile(formData):Promise<RawResponse<number>> {

//   await new Promise<void>(resolve => {
//     setTimeout(resolve, 700 + Math.random() * 800)
//   })

//   return {
//     status: 0,
//     data: 123,
//     failMsg: ''
//   }  
// }


// export const uploadAnalysisTaskInputResonseCode = {
//   inputExist: 100,
//   badKey: 120,
//   invalidKey: 110,

//   pipelineNotExist: 200,
//   pipelineAleardyStart: 201
// }
// export async function doUploadAnalysisTaskInput(
//   taskUploadRequest: AnalysisTaskUploadFileRequest
// ): Promise<RawResponse<number>> {
//   const formData = buildTaskUploadFormData(taskUploadRequest)

//   // TODO: replace this mock with the real multipart upload request.
  
//   const response = await doAnalysisUploadFile(formData)
//   const mode = getEffectiveMockMode()
//   if (mode === 'network-error') {
//     throw createUploadError('网络连接失败，请稍后重试', 'NETWORK_ERROR')
//   }
//   if (mode === 'server-error') {
//     throw createUploadError('服务器处理上传失败，请稍后重试', 'SERVER_ERROR')
//   }

//   if (mode === 'business-error') {
//     return {
//       status: RAW_RESPONSE_STATUS_BUSINESS_FAIL, 
//       data: -1,
//       failMsg: ''
//     }
//   }


//   return response
// }
