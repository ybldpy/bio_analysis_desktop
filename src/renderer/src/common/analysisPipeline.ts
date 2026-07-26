import { analysisPipelineTypeCodes } from "../api/analysisPipeline"

export interface AnalysisPipelineStageOutput {
    urls: Record<string, string>
    inline: Record<string, unknown>
}

export interface AnalysisPipelineStage {
    stageId: number
    stageName: string
    status: number
    startTime: Date | null
    stageType: number
    output: AnalysisPipelineStageOutput
}
export interface AnalysisPipeline {
    pipelineId: number
    pipelineType: number
    status: number
    analysisPipelineName: string
    createTime: Date
    projectId: number
}



export function getAnalysisPipelineTypeName(analysisTypeCode:number) {
  const codeNameMap = {
    [analysisPipelineTypeCodes.regularVirus]: '常规病毒分析',
    [analysisPipelineTypeCodes.virusCovid]: '新冠病毒分析',
    [analysisPipelineTypeCodes.regularBacteria]: '常规细菌分析',
    [analysisPipelineTypeCodes.metagenomeShotgun]: '宏基因组鸟枪法测序',
    [analysisPipelineTypeCodes.metagenomeAmplicon16]: '16S 扩增子测序'
  }
  return codeNameMap[analysisTypeCode]
}


