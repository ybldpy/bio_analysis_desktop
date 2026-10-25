import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { renderToString } from '@vue/server-renderer'
import ElementPlus, { ID_INJECTION_KEY, ZINDEX_INJECTION_KEY } from 'element-plus'
import { createSSRApp, defineComponent, h, inject, provide } from 'vue'
import {
  filterTextReportRows,
  MAX_TEXT_REPORT_CHARACTERS,
  MAX_TEXT_REPORT_COLUMNS,
  MAX_TEXT_REPORT_ROWS,
  paginateTextReportRows,
  parseTextReport,
  type TextReport,
  type TextReportRow
} from './textReport'

const TextReportResult = require('./TextReportResult.vue').default
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../../../../../test-data/report-fixtures', name), 'utf8')
function cell(report: TextReport, row: number, label: string): string | undefined {
  const column = report.columns.find((item) => item.label === label)
  return column ? report.rows[row]?.values[column.key] : undefined
}

test('real AMRFinder fixture retains all 22 named columns and one original record', () => {
  const report = parseTextReport(60, fixture('amr.tsv'))
  assert.equal(report.status, 'ready')
  assert.equal(report.format, 'amrfinder')
  assert.equal(report.columns.length, 22)
  assert.equal(report.rows.length, 1)
  assert.equal(cell(report, 0, 'Protein id'), 'NA')
  assert.equal(cell(report, 0, '% Identity to reference'), '100.00')
})

test('real ABRicate fixture keeps #FILE header, 49 rows, internal and trailing empty cells', () => {
  const report = parseTextReport(61, fixture('vf.tsv'))
  assert.equal(report.status, 'ready')
  assert.equal(report.format, 'abricate')
  assert.equal(report.columns.length, 15)
  assert.equal(report.columns[0].label, '#FILE')
  assert.equal(report.rows.length, 49)
  assert.equal(cell(report, 0, '#FILE'), 'contigs.fasta')
  assert.equal(cell(report, 0, 'RESISTANCE'), '')
  assert.equal(cell(report, 12, 'ACCESSION'), '')
  assert.notEqual(cell(report, 12, 'PRODUCT'), '')
})

test('only verified AMR/VF header-only fixtures become empty annotation reports', () => {
  for (const [stage, file] of [
    [60, 'amr-empty.tsv'],
    [61, 'vf-empty.tsv']
  ] as const) {
    const report = parseTextReport(stage, fixture(file))
    assert.equal(report.status, 'empty')
    assert.equal(report.rows.length, 0)
    assert.match(report.message, /合法表头/)
  }
  for (const stage of [60, 61, 62, 64]) {
    assert.equal(parseTextReport(stage, '\uFEFF\r\n \r\n').status, 'error')
    assert.notEqual(parseTextReport(stage, 'not a header').status, 'empty')
  }
})

test('BOM, CRLF and blank lines do not discard TSV empty fields', () => {
  const source = fixture('vf.tsv')
  const original = parseTextReport(61, source)
  const adapted = parseTextReport(61, '\uFEFF\r\n' + source.replace(/\n/g, '\r\n') + '\r\n')
  assert.deepEqual(adapted.columns, original.columns)
  assert.deepEqual(
    adapted.rows.map((row) => row.values),
    original.rows.map((row) => row.values)
  )
})

test('named TSV columns can be reordered or extended without hard-coded indexes', () => {
  const [header, row] = fixture('amr.tsv').trim().split('\n')
  const labels = header.split('\t').reverse()
  const values = row.split('\t').reverse()
  labels.push('Extra report field')
  values.push('additional text')
  const report = parseTextReport(60, labels.join('\t') + '\n' + values.join('\t'))
  assert.equal(report.status, 'ready')
  assert.equal(cell(report, 0, 'Protein id'), 'NA')
  assert.equal(cell(report, 0, 'Extra report field'), 'additional text')
})

test('paths are reduced to basename, commands hidden, and searches omit hidden/private fields', () => {
  const [header, row] = fixture('vf.tsv').split('\n')
  const fields = row.split('\t')
  fields[0] = 'C:\\private\\user\\contigs.fasta'
  const report = parseTextReport(
    61,
    header +
      '\tcommand\tlocal_path\n' +
      fields.join('\t') +
      '\tprivate-command-token\t/home/private-user/result.tsv'
  )
  assert.equal(report.status, 'ready')
  assert.equal(cell(report, 0, '#FILE'), 'contigs.fasta')
  assert.equal(cell(report, 0, 'local_path'), 'result.tsv')
  assert.equal(report.columns.find((column) => column.label === 'command')?.hidden, true)
  assert.equal(filterTextReportRows(report, 'private-command-token').length, 0)
  assert.equal(filterTextReportRows(report, 'private-user').length, 0)
  assert.equal(filterTextReportRows(report, 'CONTIGS.FASTA').length, 1)
})

test('duplicate, unnamed, missing-signature and ragged TSV columns fail rather than shift data', () => {
  const [header, row] = fixture('amr.tsv').trim().split('\n')
  assert.equal(parseTextReport(60, header + '\tProtein id\n' + row + '\tvalue').status, 'error')
  assert.equal(parseTextReport(60, header + '\t\n' + row + '\tvalue').status, 'error')
  assert.equal(
    parseTextReport(60, header.replace('Element symbol', 'Other') + '\n' + row).status,
    'error'
  )
  const malformed = parseTextReport(60, header + '\n' + row + '\n' + row + '\textra')
  assert.equal(malformed.status, 'error')
  assert.equal(malformed.rows.length, 0)
  assert.match(malformed.message, /第 3 行/)
})

test('real MLST retains its first record and derives locus labels from original fields', () => {
  const report = parseTextReport(62, fixture('mlst.tsv'))
  assert.equal(report.status, 'ready')
  assert.equal(report.rows.length, 1)
  assert.equal(report.columns.length, 10)
  assert.equal(report.rows[0].values.sample, 'contigs.fasta')
  assert.equal(report.rows[0].values.scheme, 'ecoli_achtman_4')
  assert.equal(report.rows[0].values.st, '10')
  assert.equal(cell(report, 0, 'adk'), 'adk(10)')
})

test('real three-column untyped MLST is a record, not an empty or failed report', () => {
  const report = parseTextReport(62, fixture('mlst-untyped.tsv'))
  assert.equal(report.status, 'ready')
  assert.equal(report.rows.length, 1)
  assert.equal(report.columns.length, 3)
  assert.equal(report.rows[0].values.st, '-')
  assert.match(report.notes.join(' '), /未分型/)
})

test('MLST differing row schemes/locus sets are aligned by actual locus names', () => {
  const report = parseTextReport(
    62,
    '/private/a.fa\tscheme_a\t1\tgeneA(10)\tgeneB(~2)\nC:\\private\\b.fa\tscheme_b\t-\tgeneB(-)\tgeneC(4)'
  )
  assert.equal(report.status, 'ready')
  assert.equal(report.rows[0].values.sample, 'a.fa')
  assert.equal(report.rows[1].values.sample, 'b.fa')
  assert.equal(cell(report, 0, 'geneB'), 'geneB(~2)')
  assert.equal(cell(report, 1, 'geneB'), 'geneB(-)')
  assert.equal(cell(report, 0, 'geneC'), undefined)
  assert.equal(parseTextReport(62, 'sample\tscheme\tST').status, 'error')
  assert.equal(parseTextReport(62, 'a.fa\tscheme').status, 'error')
  assert.equal(parseTextReport(62, 'a.fa\tscheme\t1\tbad-locus').status, 'error')
  assert.equal(parseTextReport(62, 'a.fa\tscheme\t1\tgeneA(1)\tgeneA(2)').status, 'error')
})

test('real ECTyper recognizes its signature and exposes only the nine verified primary fields', () => {
  const report = parseTextReport(64, fixture('ectyper.tsv'))
  assert.equal(report.status, 'ready')
  assert.equal(report.format, 'ectyper')
  assert.equal(report.columns.length, 40)
  assert.equal(report.rows.length, 1)
  assert.equal(report.columns.filter((column) => !column.hidden).length, 9)
  assert.equal(cell(report, 0, 'Serotype'), 'O16:H48')
  assert.equal(cell(report, 0, 'QC'), '-')
  assert.equal(report.columns.find((column) => column.label === 'Pathotype')?.hidden, true)
  assert.equal(parseTextReport(64, 'sample\tserotype\nA\tunknown').status, 'unsupported')
  assert.equal(parseTextReport(64, fixture('mlst.tsv')).format, 'unsupported')
})

test('ECTyper header-only report does not claim no hits or untyped', () => {
  const report = parseTextReport(64, fixture('ectyper.tsv').split('\n')[0])
  assert.equal(report.status, 'ready')
  assert.equal(report.rows.length, 0)
  assert.match(report.message, /未提供分型数据记录/)
  assert.equal(parseTextReport(999, 'text').status, 'unsupported')
})

test('size/row/column limits reject the entire report without partial success', () => {
  assert.equal(
    parseTextReport(60, 'x'.repeat(MAX_TEXT_REPORT_CHARACTERS + 1)).status,
    'unsupported'
  )
  const tooManyRows = parseTextReport(
    62,
    Array(MAX_TEXT_REPORT_ROWS + 1)
      .fill('a.fa\t-\t-')
      .join('\n')
  )
  assert.equal(tooManyRows.status, 'unsupported')
  assert.equal(tooManyRows.rows.length, 0)
  const [header] = fixture('amr.tsv').split('\n')
  const tooManyColumns = parseTextReport(
    60,
    header + Array(MAX_TEXT_REPORT_COLUMNS).fill('\textra').join('')
  )
  assert.equal(tooManyColumns.status, 'unsupported')
})

test('search and pagination bound the rendered slice and retain source row order', () => {
  const report = parseTextReport(61, fixture('vf.tsv'))
  const original = report.rows.map((row) => row.id)
  assert.equal(paginateTextReportRows(report.rows, 1, 25).length, 25)
  assert.equal(paginateTextReportRows(report.rows, 2, 25).length, 24)
  assert.equal(paginateTextReportRows(report.rows, 500, 25)[0].id, report.rows[25].id)
  assert.equal(paginateTextReportRows(report.rows, NaN, NaN).length, 25)
  assert.equal(filterTextReportRows(report, 'never-a-match').length, 0)
  assert.deepEqual(
    report.rows.map((row) => row.id),
    original
  )
})

async function render(report: TextReport, slotTables = false) {
  const app = createSSRApp(TextReportResult, { report }).use(ElementPlus)
  app.provide(ID_INJECTION_KEY, { prefix: 1, current: 0 })
  app.provide(ZINDEX_INJECTION_KEY, { current: 0 })
  if (slotTables) {
    // Replace only this test app's table registrations, without muting runtime warnings.
    Reflect.deleteProperty(app._context.components, 'ElTable')
    Reflect.deleteProperty(app._context.components, 'ElTableColumn')
    // Element Plus tables omit rows during SSR; only the table shells are replaced for row assertions.
    app.component(
      'ElTable',
      defineComponent({
        props: { data: Array },
        setup(props, { slots }) {
          provide('report-test-rows', props.data)
          return () =>
            h('div', { 'data-rendered-row-count': props.data?.length }, slots.default?.())
        }
      })
    )
    app.component(
      'ElTableColumn',
      defineComponent({
        props: { label: String },
        setup(props, { slots }) {
          const rows = inject<TextReportRow[]>('report-test-rows', [])
          return () =>
            h('section', [props.label, ...rows.map((row) => h('span', slots.default?.({ row })))])
        }
      })
    )
  }
  return renderToString(app)
}

test('real SFC/Element Plus renders report states and keeps AMR/VF interpretation boundaries', async () => {
  assert.match(await render(parseTextReport(60, fixture('amr.tsv'))), /不将注释命中转换成药敏/)
  assert.match(await render(parseTextReport(61, fixture('vf-empty.tsv'))), /报告仅有合法表头/)
  assert.match(await render(parseTextReport(62, fixture('mlst-untyped.tsv'))), /未分型/)
  assert.match(await render(parseTextReport(64, 'unknown format')), /当前报告暂不支持表格展示/)
  assert.match(await render(parseTextReport(60, 'bad header')), /报告格式读取失败/)
})

test('SFC renders at most one page and escapes text without leaking hidden commands or paths', async () => {
  const report = parseTextReport(61, fixture('vf.tsv'))
  const product = report.columns.find((column) => column.label === 'PRODUCT')!
  report.rows[0].values[product.key] = '<img src=x onerror=alert(1)>'
  report.columns.push({ key: 'command', label: 'command', hidden: true })
  report.rows[0].values.command = 'never-show-this-command'
  const html = await render(report, true)
  assert.match(html, /data-rendered-row-count="25"/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(html, /<img src=x|never-show-this-command/)
  assert.match(html, /共 49 条报告记录/)
})

test('single MLST SFC shows summary and original locus rows; untyped marker stays explicit', async () => {
  const typed = await render(parseTextReport(62, fixture('mlst.tsv')))
  assert.match(typed, /样本／文件名/)
  assert.match(typed, /ecoli_achtman_4/)
  assert.match(typed, /MLST 位点原始记录/)
  assert.doesNotMatch(typed, /搜索当前可见报告字段/)
  const untyped = await render(parseTextReport(62, fixture('mlst-untyped.tsv')))
  assert.match(untyped, /未分型（原值 -）/)
  assert.match(untyped, /报告未提供位点字段/)
  const multiple = await render(parseTextReport(62, 'a.fa\t-\t-\nb.fa\t-\t-'))
  assert.match(multiple, /搜索当前可见报告字段/)
})
