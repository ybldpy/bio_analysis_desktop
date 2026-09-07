import axios from 'axios'

export const API_BASE_URL = 'http://wsl.test:8080'

export const backendService = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Accept: 'application/json'
  }
})

backendService.interceptors.response.use((response)=>{
  return response.data
})

// backendService.interceptors.response.use((response) => {
//   return response
// })

export const backendAPI = {

  getPipelineStates: 'pipeline/getPipelineStates',
  getPipelineStages: 'pipeline/getPipelineStages',
  getPipeline: 'pipeline/getPipeline',
  getAllProjects: 'project/getAll',
  createProject: 'project/create',
  pipelineNamePrefixCheck: 'pipeline/checkPipelineNamePrefixAvailable',
  batchCreatePipelines: 'pipeline/batchCreatePipelines',
  pipelineInputFileUpload: 'pipelineInput/upload',
  startPipeline: 'pipeline/start',
  queryReferenceGenomes: 'referenceGenome/queryReferenceGenomes',
  stageOutputDownload: '/stageOutput/download'
}

