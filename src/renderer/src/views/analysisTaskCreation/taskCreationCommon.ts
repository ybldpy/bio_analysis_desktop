import type { ReferenceGenome } from '../../api/analysisTaskBuild'
import type { BioProject } from '../../api/bioProject'

export type AnalysisTaskDataType = 0 | 1 | 2

export interface AnalysisTaskInputSlot {
  r1: File | null | undefined
  r2: File | null | undefined
  contigs: File | null | undefined
  type: 0| 1 | 2
}


export interface AnalysisTask {
  name: string
  inputSlots: AnalysisTaskInputSlot[]
  type: AnalysisTaskDataType
}

export interface TaskCreation {
  project: BioProject
  referenceGenome: ReferenceGenome | null
  customerReferenceGenome: File | null
  analysisType: number
  tasks: AnalysisTask[]
}

export type TaskUploadRequest = TaskCreation

export interface TaskUploadRequestValidationResult {
  satisfied: boolean
  msg: string
  invalidTaskIndexes: number[]
}
let currentTaskUploadRequest:
  TaskUploadRequest | null = null

export function setTaskUploadRequest(request: TaskUploadRequest){
  currentTaskUploadRequest = request
}

export function takeTaskUploadRequest(): TaskUploadRequest | null {
  const request = currentTaskUploadRequest
  currentTaskUploadRequest = null
  return request
}
