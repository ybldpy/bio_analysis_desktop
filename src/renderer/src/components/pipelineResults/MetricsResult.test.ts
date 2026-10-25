import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { compileScript, compileStyle, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ElementPlus, { ID_INJECTION_KEY } from 'element-plus'
import ts from 'typescript'
import { createSSRApp, type Component } from 'vue'

const filename = resolve('src/renderer/src/components/pipelineResults/MetricsResult.vue')
const parsed = parse(readFileSync(filename, 'utf8'), { filename })
assert.deepEqual(parsed.errors, [])
const script = compileScript(parsed.descriptor, { id: 'metrics-result-test', inlineTemplate: true })
for (const style of parsed.descriptor.styles) {
  assert.deepEqual(
    compileStyle({
      source: style.content,
      filename,
      id: 'metrics-result-test',
      scoped: style.scoped
    }).errors,
    []
  )
}
const compiled = ts.transpileModule(script.content, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true
  }
})
const componentModule = { exports: {} as { default: Component } }
// Compile only this repository's Vue SFC, so the assertions exercise its real template.
new Function('require', 'module', 'exports', compiled.outputText)(
  createRequire(filename),
  componentModule,
  componentModule.exports
)

async function render(stageType: number, metrics: Record<string, unknown>): Promise<string> {
  const app = createSSRApp(componentModule.exports.default, { stageType, metrics })
  app.use(ElementPlus)
  app.provide(ID_INJECTION_KEY, { prefix: 1, current: 0 })
  return renderToString(app)
}

test('mapping component uses reported overall values and separate fraction/depth scales', async () => {
  const html = await render(20, {
    mappingFraction: 0.95,
    coverageFractionAt1x: 0.75,
    meanDepth: 19,
    maxDepth: 200,
    totalReferenceBases: 1000,
    mappedReadSegments: 0,
    references: [
      { referenceName: 'reference-A', coverageFractionAt1x: 0.9, meanDepth: 30 },
      { referenceName: 'reference-B', coverageFractionAt1x: 0, meanDepth: 50 }
    ]
  })
  assert.match(html, /<dt>比对率<\/dt><dd>95\.00%<\/dd>/)
  assert.match(html, /<dt>平均深度<\/dt><dd>19\.00×<\/dd>/)
  assert.match(html, /<dt>参考总长度<\/dt><dd>1,000 bp<\/dd>/)
  assert.match(html, /<dt>已比对 read segments<\/dt><dd>0<\/dd>/)
  assert.match(html, /<dt>未比对 read segments<\/dt><dd>未提供<\/dd>/)
  assert.match(html, /固定比例尺：0–100%/)
  assert.match(html, /深度比例尺：0–50\.00×/)
  assert.match(html, /reference-A/)
  assert.match(html, /reference-B/)
  assert.match(html, /width:60%/)
  assert.doesNotMatch(html, /NaN|Infinity|progressbar/)
})

test('variant component distinguishes zero variants from total VCF records and missing fields', async () => {
  const html = await render(40, {
    variantRecords: 0,
    totalVcfRecords: 5,
    snpCount: 0,
    indelCount: 0,
    otherCount: 0,
    explicitPassCount: 0,
    filteredCount: 0,
    unfilteredCount: 0,
    references: []
  })
  assert.match(html, /<dt>变异记录总数<\/dt><dd>0 条记录<\/dd>/)
  assert.match(html, /<dt>全部 VCF 数据记录数<\/dt><dd>5 条记录<\/dd>/)
  assert.match(html, /变异类型分布/)
  assert.match(html, /过滤状态分布/)
  assert.equal(html.match(/报告中的变异记录总数为 0/g)?.length, 2)
  assert.match(html, /未明确过滤状态（FILTER 为 .）/)
  assert.doesNotMatch(html, /NaN|Infinity|progressbar/)

  const missing = await render(40, { variantRecords: null, references: {} })
  assert.match(missing, /<dt>变异记录总数<\/dt><dd>未提供<\/dd>/)
  assert.match(missing, /未提供完整的统计字段/)
  assert.doesNotMatch(missing, /报告中的变异记录总数为 0/)
})

test('consensus component displays reference-coordinate mask statistics and reported fractions', async () => {
  const html = await render(41, {
    minimumDepth: 10,
    totalBases: 100,
    maskedBases: 20,
    unmaskedBases: 80,
    maskedFraction: 0.2,
    unmaskedFraction: 0.8,
    sequences: [{ sequenceName: 'reference-A', totalBases: 100, maskedBases: 20 }]
  })
  assert.match(html, /<dt>深度遮罩阈值<\/dt><dd>10\.00×<\/dd>/)
  assert.match(html, /<dt>参考坐标总位置数<\/dt><dd>100 bp<\/dd>/)
  assert.match(html, /<dt>低深度遮罩比例<\/dt><dd>20\.00%<\/dd>/)
  assert.match(html, /不代表最终 FASTA/)
  assert.match(html, /width:80%/)
  assert.match(html, /width:20%/)
  assert.doesNotMatch(html, /<dt>(?:最终 FASTA|N 数|基因组完整率)/)
  assert.doesNotMatch(html, /NaN|Infinity|progressbar/)
})

test('component escapes labels and tolerates unknown entries without inventing measurements', async () => {
  const html = await render(20, {
    references: [
      null,
      [],
      'bad',
      { referenceName: '<script>alert(1)</script>', meanDepth: null, coverageFractionAt1x: null }
    ]
  })
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /列表中有 3 个无法识别的条目/)
  assert.match(html, /<dt>比对率<\/dt><dd>未提供<\/dd>/)
  assert.doesNotMatch(html, /<script>|NaN|Infinity/)
  assert.match(await render(999, {}), /此阶段尚未适配指标展示/)
})
