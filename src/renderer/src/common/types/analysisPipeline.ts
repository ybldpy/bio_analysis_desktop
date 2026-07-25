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


