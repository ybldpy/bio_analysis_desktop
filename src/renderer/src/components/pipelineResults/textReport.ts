export type TextReportFormat = 'amrfinder' | 'abricate' | 'mlst' | 'ectyper' | 'unsupported'
export interface TextReportColumn {
  key: string
  label: string
  hidden: boolean
}
export interface TextReportRow {
  id: number
  values: Record<string, string>
}
export interface TextReport {
  stageType: number
  format: TextReportFormat
  title: string
  status: 'ready' | 'empty' | 'unsupported' | 'error'
  message: string
  notes: string[]
  columns: TextReportColumn[]
  rows: TextReportRow[]
}

export const MAX_TEXT_REPORT_ROWS = 10_000
export const MAX_TEXT_REPORT_COLUMNS = 256
export const MAX_TEXT_REPORT_CHARACTERS = 5 * 1024 * 1024

const ectyperFields = [
  'Name',
  'Species',
  'O-type',
  'H-type',
  'Serotype',
  'QC',
  'Evidence',
  'Warnings',
  'DatabaseVer'
]
const formats: Record<
  number,
  { format: TextReportFormat; title: string; signature: string[]; notes: string[] }
> = {
  60: {
    format: 'amrfinder',
    title: 'AMR 注释／命中报告',
    signature: [
      'Protein id',
      'Contig id',
      'Start',
      'Stop',
      'Element symbol',
      'Element name',
      'Method'
    ],
    notes: ['仅展示 AMRFinder 报告原字段，不将注释命中转换成药敏或临床耐药结论。']
  },
  61: {
    format: 'abricate',
    title: 'VF 注释／命中报告',
    signature: [
      '#FILE',
      'SEQUENCE',
      'START',
      'END',
      'GENE',
      '%COVERAGE',
      '%IDENTITY',
      'DATABASE',
      'ACCESSION',
      'PRODUCT'
    ],
    notes: ['仅展示 ABRicate 报告原字段；注释命中不等同于致病性结论。']
  },
  62: {
    format: 'mlst',
    title: 'MLST 报告',
    signature: [],
    notes: ['按无表头格式读取样本、scheme、ST 和原始位点字段；不以 scheme 替代物种分类。']
  },
  64: {
    format: 'ectyper',
    title: '血清分型报告',
    signature: ectyperFields,
    notes: [
      '仅展示已核实的 ECTyper 主要原报告字段；QC、Evidence 和 Warnings 保留工具原文，不生成全流程质量结论。'
    ]
  }
}

function result(stageType: number): TextReport {
  const config = formats[stageType]
  return {
    stageType,
    format: config?.format ?? 'unsupported',
    title: config?.title ?? '文本报告',
    status: 'ready',
    message: '',
    columns: [],
    rows: [],
    notes: [
      ...(config?.notes ?? []),
      '文件路径仅显示文件名，命令字段不在表格中展示；完整原文请下载报告。'
    ]
  }
}

function reject(report: TextReport, status: 'error' | 'unsupported', message: string): TextReport {
  return { ...report, status, message, rows: [] }
}

function basename(value: string): string {
  return (
    value
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  )
}

function isCommandColumn(label: string): boolean {
  return /command|^cmd(?:line)?$/i.test(label)
}

function displayValue(label: string, value: string): string {
  const pathColumn =
    /^(?:#?file|filename|sample|name)$/i.test(label) ||
    /(?:^|[\s_-])(?:path|file|filename|filepath)(?:$|[\s_-])/i.test(label)
  const absolutePath = /^(?:[A-Za-z]:[\\/]|\/|\\\\|file:\/\/)/.test(value)
  return pathColumn || absolutePath ? basename(value) : value
}

function parseMlst(report: TextReport, lines: { text: string; number: number }[]): TextReport {
  report.columns = [
    { key: 'sample', label: '样本／文件名', hidden: false },
    { key: 'scheme', label: 'Scheme（原报告）', hidden: false },
    { key: 'st', label: 'ST（原报告）', hidden: false }
  ]
  const loci = new Map<string, string>()
  for (const line of lines) {
    const fields = line.text.split('\t')
    if (fields.length < 3 || fields.slice(0, 3).some((field) => !field.trim())) {
      return reject(
        report,
        'error',
        `第 ${line.number} 行缺少 MLST 必需的样本、scheme 或 ST 字段。`
      )
    }
    if (fields.length > MAX_TEXT_REPORT_COLUMNS) {
      return reject(
        report,
        'unsupported',
        `报告超过 ${MAX_TEXT_REPORT_COLUMNS} 列的展示上限，请下载原文件查看。`
      )
    }
    if (
      /^(?:sample|file|filename|#file)$/i.test(fields[0]) &&
      /^scheme$/i.test(fields[1]) &&
      /^st$/i.test(fields[2])
    ) {
      return reject(report, 'error', '此 MLST 适配器要求无表头报告，当前内容不符合已核实格式。')
    }
    if (!/^(?:\d+|-)$/u.test(fields[2])) {
      return reject(
        report,
        'error',
        `第 ${line.number} 行的 ST 不符合已核实的 MLST 格式，请下载原文件核对。`
      )
    }
    const values: Record<string, string> = {
      sample: basename(fields[0]),
      scheme: fields[1],
      st: fields[2]
    }
    const rowLoci = new Set<string>()
    for (const [index, field] of fields.slice(3).entries()) {
      const match = /^([^()\s]+)\(([^()]*)\)$/u.exec(field)
      if (field && !match) {
        return reject(
          report,
          'error',
          `第 ${line.number} 行含无法识别的 MLST 位点字段，请下载原报告核对。`
        )
      }
      const locus = match?.[1] ?? `未提供名称的位点字段 ${index + 1}`
      if (rowLoci.has(locus))
        return reject(report, 'error', `第 ${line.number} 行含重复 MLST 位点名，无法安全对齐展示。`)
      rowLoci.add(locus)
      let key = loci.get(locus)
      if (!key) {
        if (report.columns.length >= MAX_TEXT_REPORT_COLUMNS) {
          return reject(
            report,
            'unsupported',
            `报告位点列超过 ${MAX_TEXT_REPORT_COLUMNS} 列的展示上限，请下载原文件查看。`
          )
        }
        key = `locus${loci.size}`
        loci.set(locus, key)
        report.columns.push({ key, label: locus, hidden: false })
      }
      values[key] = field
    }
    report.rows.push({ id: line.number, values })
  }
  if (report.rows.some((row) => row.values.st === '-')) {
    report.notes.push(
      'ST 为 - 的记录按报告标记显示为未分型，不代表阶段执行失败；未提供的位点不补零。'
    )
  }
  return report
}

/** Parse only verified report layouts; never truncate a report into an apparently complete result. */
export function parseTextReport(stageType: number, text: string): TextReport {
  const report = result(stageType)
  const config = formats[stageType]
  if (!config) return reject(report, 'unsupported', '此阶段尚未适配文本报告，请下载原文件查看。')
  if (typeof text !== 'string') return reject(report, 'error', '报告内容不是文本。')
  if (text.length > MAX_TEXT_REPORT_CHARACTERS) {
    return reject(report, 'unsupported', '报告超过前端文本展示大小上限，请下载原文件查看。')
  }
  // Do not trim TSV lines: trailing tabs encode empty fields, including ABRicate RESISTANCE.
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\n|\r/)
    .map((line, index) => ({ text: line, number: index + 1 }))
    .filter((line) => line.text.trim().length > 0)
  if (!lines.length)
    return reject(report, 'error', '报告为空，无法核实表头或格式；不能解释为无匹配记录。')
  const dataRows = lines.length - (stageType === 62 ? 0 : 1)
  if (dataRows > MAX_TEXT_REPORT_ROWS) {
    return reject(
      report,
      'unsupported',
      `报告超过 ${MAX_TEXT_REPORT_ROWS.toLocaleString('zh-CN')} 行的展示上限，请下载原文件查看。`
    )
  }
  if (stageType === 62) return parseMlst(report, lines)

  const header = lines[0].text.split('\t')
  if (header.length > MAX_TEXT_REPORT_COLUMNS) {
    return reject(
      report,
      'unsupported',
      `报告超过 ${MAX_TEXT_REPORT_COLUMNS} 列的展示上限，请下载原文件查看。`
    )
  }
  if (!config.signature.every((label) => header.includes(label))) {
    if (stageType === 64) report.format = 'unsupported'
    return reject(
      report,
      stageType === 64 ? 'unsupported' : 'error',
      stageType === 64
        ? '尚未识别为已核实的 ECTyper 表头；其他血清分型工具暂不解析，请下载原报告。'
        : '报告缺少已核实格式所需的表头字段；不能将此内容解释为无匹配记录。'
    )
  }
  if (header.some((label) => !label.trim()) || new Set(header).size !== header.length) {
    return reject(report, 'error', '报告表头含空列名或重复列名，无法安全对齐展示。')
  }
  if (stageType === 64) report.title = 'ECTyper 血清分型报告'
  report.columns = header.map((label, index) => ({
    key: `column${index}`,
    label,
    hidden: isCommandColumn(label) || (stageType === 64 && !ectyperFields.includes(label))
  }))
  for (const line of lines.slice(1)) {
    const fields = line.text.split('\t')
    if (fields.length !== header.length) {
      return reject(
        report,
        'error',
        `第 ${line.number} 行字段数与表头不一致，未展示不完整结果；请下载原文件核对。`
      )
    }
    const values: Record<string, string> = {}
    report.columns.forEach((column, index) => {
      values[column.key] = displayValue(column.label, fields[index])
    })
    report.rows.push({ id: line.number, values })
  }
  if (!report.rows.length) {
    if (stageType === 60 || stageType === 61) {
      report.status = 'empty'
      report.message = '报告仅有合法表头，未列出注释匹配记录。'
    } else {
      report.message = '报告仅有已识别表头，未提供分型数据记录；不推断为未检出或未分型。'
    }
  }
  return report
}

export function filterTextReportRows(report: TextReport, search: string): TextReportRow[] {
  const query = search.trim().toLocaleLowerCase()
  if (!query) return report.rows
  const columns = report.columns.filter((column) => !column.hidden)
  return report.rows.filter((row) =>
    columns.some((column) => (row.values[column.key] ?? '').toLocaleLowerCase().includes(query))
  )
}

export function paginateTextReportRows(
  rows: TextReportRow[],
  page: number,
  pageSize: number
): TextReportRow[] {
  const size = Number.isFinite(pageSize) ? Math.min(100, Math.max(1, Math.floor(pageSize))) : 25
  const requestedPage = Number.isFinite(page) ? Math.floor(page) : 1
  const safePage = Math.min(Math.max(1, requestedPage), Math.max(1, Math.ceil(rows.length / size)))
  return rows.slice((safePage - 1) * size, safePage * size)
}
