import type { AnalysisPipelineStage, AnalysisPipelineStageOutput } from './analysisPipeline'

export interface AnalysisPipelineStageDTO {
  stageId: number
  stageName: string
  status: number
  startTime?: string | number | null
  endTime?: string | number | null
  stageType: number
  outputUrl?: string | null
  outputInline?: string | null
}

export interface StageResultFile {
  key: string
  label: string
  fileName: string
  fileKey: string
}

export function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}

function parseDate(value: unknown): Date | null {
  if (value == null || value === '' || (typeof value === 'string' && !value.trim())) return null
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number')
    return null
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export function convertStageResult(dto: AnalysisPipelineStageDTO): AnalysisPipelineStage {
  const output: AnalysisPipelineStageOutput = { urls: null, inline: null }
  for (const [field, raw] of [
    ['urls', dto.outputUrl],
    ['inline', dto.outputInline]
  ] as const) {
    if (raw == null || (typeof raw === 'string' && !raw.trim())) continue
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null && asRecord(parsed) === null) {
        throw new Error('结果必须是 JSON 对象')
      }
      output[field] = asRecord(parsed)
    } catch (error) {
      output.parseErrors ??= {}
      const reason = error instanceof Error ? error.message : '无效的 JSON'
      output.parseErrors[field] = `结果解析失败：${reason}`
    }
  }
  return {
    stageId: dto.stageId,
    stageName: dto.stageName,
    status: dto.status,
    startTime: parseDate(dto.startTime),
    endTime: parseDate(dto.endTime),
    stageType: dto.stageType,
    output
  }
}

const fileFields: Record<number, Array<[key: string, label: string]>> = {
  80: [
    ['r1Url', '规范化 R1 / 单端数据'],
    ['r2Url', '规范化 R2 数据']
  ],
  0: [
    ['cleanedR1', '清洗后 R1 / 单端数据'],
    ['cleanedR2', '清洗后 R2 数据'],
    ['reportJSON', '质量统计 JSON'],
    ['reportHTML', '完整质量报告 HTML']
  ],
  30: [
    ['contigsUrl', 'Contigs FASTA'],
    ['scaffoldUrl', 'Scaffolds FASTA']
  ],
  20: [
    ['bamUrl', '比对文件 BAM'],
    ['bamIndexUrl', 'BAM 索引'],
    ['coverageDepthUrl', '逐位置深度 TSV'],
    ['metricsUrl', '比对指标 JSON']
  ],
  40: [
    ['rawVcfGzUrl', '原始 VCF'],
    ['rawVcfTbiUrl', '原始 VCF 索引'],
    ['vcfGzUrl', '处理后 VCF'],
    ['vcfTbiUrl', '处理后 VCF 索引'],
    ['metricsUrl', '变异统计 JSON']
  ],
  41: [
    ['consensusUrl', '一致性序列 FASTA'],
    ['maskBedUrl', '深度遮罩区域 BED'],
    ['metricsUrl', '遮罩统计 JSON']
  ],
  43: [
    ['pafPath', '参考比较 PAF'],
    ['differenceTsv', '差异报告 TSV']
  ],
  72: [['annotatedVCF', '注释 VCF']],
  10: [
    ['mainBinFastaUrl', '原始主分箱 FASTA'],
    ['contigAssignmentReportUrl', 'Contig 分类分配 TSV']
  ],
  60: [['amrResult', 'AMR 注释报告']],
  61: [['vfTsv', 'VF 注释报告']],
  62: [['mlst', 'MLST 报告']],
  64: [
    ['serotypeResultUrl', '血清分型报告'],
    ['kaptiveKResultUrl', 'K 位点报告'],
    ['kaptiveOResultUrl', 'O 位点报告']
  ]
}

function isFileKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function getStageFiles(stage: AnalysisPipelineStage): StageResultFile[] {
  const source = stage.stageType === 10 ? stage.output.inline : stage.output.urls
  if (!source) return []
  let fields = fileFields[stage.stageType] ?? []
  if (stage.stageType === 43) {
    // Keep summary downloads available independently of report parsing/loading failures.
    fields = source.schemaVersion === 2
      ? [['comparisonJsonUrl', '全部候选比较 JSON'], ['comparisonTsvUrl', '全部候选汇总 TSV']]
      : 'schemaVersion' in source ? [] : fields
  }
  return fields.flatMap(([field, label]) => {
    const key =
      stage.stageType === 61 && field === 'vfTsv' && !isFileKey(source[field]) ? 'amrTsv' : field
    const fileKey: unknown = source[key]
    if (!isFileKey(fileKey)) return []
    return [{ key, label, fileKey, fileName: fileKey.split('/').pop() || key }]
  })
}

export function getReferenceSelection(stage: AnalysisPipelineStage): Record<string, any> | null {
  if (stage.stageType !== 44 || stage.output.parseErrors?.inline) return null
  return stage.output.inline ?? stage.output.urls
}

export function hasStageResult(stage: AnalysisPipelineStage): boolean {
  return [stage.output.inline, stage.output.urls].some(
    (value) => value !== null && Object.keys(value).length > 0
  )
}

export function getStageStatusMeta(status: number): {
  label: string
  type: 'info' | 'warning' | 'success' | 'danger' | 'primary'
} {
  const states: Record<number, ReturnType<typeof getStageStatusMeta>> = {
    0: { label: '待执行', type: 'info' },
    1: { label: '排队中', type: 'info' },
    2: { label: '运行中', type: 'primary' },
    3: { label: '执行失败', type: 'danger' },
    4: { label: '已完成', type: 'success' },
    5: { label: '等待人工处理', type: 'warning' },
    6: { label: '不适用／已跳过', type: 'info' }
  }
  return states[status] ?? { label: `未知状态（${status}）`, type: 'info' }
}

export function sortResultStages(stages: AnalysisPipelineStage[]): AnalysisPipelineStage[] {
  // Display order only; this does not describe execution dependencies.
  const order = [80, 0, 30, 44, 43, 20, 40, 41, 72, 10, 60, 61, 62, 63, 64]
  const rank = (type: number) => {
    const index = order.indexOf(type)
    return index < 0 ? order.length : index
  }
  return [...stages].sort((a, b) => rank(a.stageType) - rank(b.stageType) || a.stageId - b.stageId)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function formatNumber(value: unknown, maximumFractionDigits = 2): string {
  return isFiniteNumber(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits }) : '—'
}

export function formatFraction(value: unknown): string {
  return isFiniteNumber(value) ? `${(value * 100).toFixed(2)}%` : '—'
}

export function formatPercent(value: unknown): string {
  return isFiniteNumber(value) ? `${value.toFixed(2)}%` : '—'
}

export function formatDepth(value: unknown): string {
  return isFiniteNumber(value) ? `${value.toFixed(2)}×` : '—'
}

export function formatDate(value: unknown): string {
  const date = parseDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date)
}
