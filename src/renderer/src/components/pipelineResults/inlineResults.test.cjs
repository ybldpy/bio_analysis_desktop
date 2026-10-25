/* eslint-disable vue/one-component-per-file -- SSR fixtures intentionally share this test file. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { createSSRApp, defineComponent, h, inject, provide } = require('vue')
const { renderToString } = require('@vue/server-renderer')

// Test-only compilation: the production app still uses the normal Vite Vue build.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  module._compile(compiled.outputText, filename)
}

function loadSfc(name) {
  const filename = path.join(__dirname, name)
  const parsed = parse(fs.readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(parsed.errors, [])
  const compiled = compileScript(parsed.descriptor, { id: name, inlineTemplate: true })
  const output = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const module = new Module(filename)
  module.filename = filename
  module.paths = Module._nodeModulePaths(__dirname)
  module._compile(output, filename)
  return module.exports.default
}

const InputResult = loadSfc('InputResult.vue')
const ReferenceSelectionResult = loadSfc('ReferenceSelectionResult.vue')
const TaxonomyResult = loadSfc('TaxonomyResult.vue')
const { displayText, displayCode, sortBySegment } = require('./inlineResultPresentation.ts')

// Element Plus intentionally omits table rows during SSR. Slot-aware test components
// make data-row assertions possible without a browser or any backend request.
const passthrough = defineComponent({
  props: { label: String, title: String, description: String },
  setup(props, { slots }) {
    return () =>
      h('section', [
        props.label,
        props.title,
        props.description,
        slots.header?.(),
        slots.default?.()
      ])
  }
})
const table = defineComponent({
  props: { data: Array, emptyText: String },
  setup(props, { slots }) {
    provide('test-result-rows', props.data)
    return () => h('div', props.data?.length ? slots.default?.() : props.emptyText)
  }
})
const column = defineComponent({
  props: { label: String, prop: String },
  setup(props, { slots }) {
    const rows = inject('test-result-rows', [])
    return () =>
      h('section', [
        props.label,
        ...rows.map((row, index) =>
          h(
            'div',
            {
              'data-row-key':
                row.accession ?? row.referenceAccession ?? row.taxid ?? row.taxId ?? index
            },
            slots.default ? slots.default({ row }) : String(row[props.prop] ?? '')
          )
        )
      ])
  }
})

function stage(type, inline = null, urls = null, extra = {}) {
  return {
    stageId: 1,
    stageName: '测试阶段',
    stageType: type,
    status: 4,
    startTime: null,
    output: { inline, urls },
    ...extra
  }
}

async function render(component, data) {
  const app = createSSRApp(component, { stage: data })
  for (const name of [
    'ElCard',
    'ElAlert',
    'ElEmpty',
    'ElDescriptions',
    'ElDescriptionsItem',
    'ElTag',
    'ElCollapse',
    'ElCollapseItem'
  ]) {
    app.component(name, passthrough)
  }
  app.component('ElTable', table)
  app.component('ElTableColumn', column)
  return renderToString(app)
}

test('presentation preserves unknown codes and legitimate zero values', () => {
  assert.equal(displayText(0), '0')
  assert.equal(displayText(null), '未提供')
  assert.equal(displayText({}), '未提供')
  assert.equal(displayCode(9999, {}, '未知平台'), '未知平台（9999）')
  assert.equal(displayCode('__proto__', {}, '未知平台'), '未知平台（__proto__）')
})

test('segment sorting uses numeric ordinals, is stable for unknowns, and does not mutate reports', () => {
  const rows = [
    { segment: '10' },
    { segment: '2', segmentOrdinal: 2 },
    { segment: '1', segmentOrdinal: 1 },
    { segment: '2' }
  ]
  const before = JSON.stringify(rows)
  assert.deepEqual(
    sortBySegment(rows).map((row) => row.segment),
    ['1', '2', '10', '2']
  )
  assert.equal(JSON.stringify(rows), before)
  assert.equal(
    sortBySegment(
      [{ segmentKey: 'later' }, { segmentKey: 'first' }],
      new Map([
        ['later', 10],
        ['first', 1]
      ])
    )[0].segmentKey,
    'first'
  )
})

test('input metadata keeps unknown platform code and derives layout from normalized R1/R2', async () => {
  const html = await render(
    InputResult,
    stage(80, null, {
      readMeta: {
        sequencingPlatform: 9999,
        readLenType: 1,
        qualityEncoding: null,
        sequenceLevel: 0
      },
      r1Url: 'input/r1.fastq.gz',
      r2Url: ' '
    })
  )
  assert.match(html, /未知平台（9999）/)
  assert.match(html, /单端（R1）/)
  assert.match(html, /未提供/)
  assert.doesNotMatch(html, /双端（R1 \+ R2）/)
  assert.doesNotMatch(html, /ONT/)
})

test('input missing and parse-error states remain distinct', async () => {
  assert.match(await render(InputResult, stage(80)), /暂无输入检查结果/)
  const html = await render(
    InputResult,
    stage(80, null, null, {
      output: { inline: null, urls: null, parseErrors: { urls: 'bad JSON' } }
    })
  )
  assert.match(html, /输入结果解析失败/)
  assert.match(html, /bad JSON/)
  assert.doesNotMatch(html, /暂无输入检查结果/)
})

test('inline-only reference rendering joins selected accessions and converts each unit once', async () => {
  const html = await render(
    ReferenceSelectionResult,
    stage(44, {
      selectedReference: {
        organismName: '<script>unsafe</script>',
        taxId: 1,
        complete: false,
        sequences: [
          { accession: 'REF_B', segmentOrdinal: 2 },
          { accession: 'REF_A', segmentOrdinal: 1 }
        ]
      },
      candidateScores: [
        { referenceAccession: 'REF_C', score: null },
        { referenceAccession: 'REF_A', sequenceIdentity: 97.2, referenceCoverage: 0.95, score: 0 }
      ],
      partial: false,
      unmatchedSegmentKeys: [],
      readFallbackMetrics: { status: 'NO_READS' }
    })
  )
  assert.match(html, /97\.20%/)
  assert.match(html, /95\.00%/)
  assert.doesNotMatch(html, /9720/)
  assert.match(html, /data-row-key="REF_A"><section type="success"[^>]*>(?:<!--.*?-->)*已选中/)
  assert.match(html, /data-row-key="REF_C"><span>未选中/)
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>unsafe/)
  assert.match(html, /本次候选分组中没有未匹配项/)
  assert.match(html, /没有 Reads/)
})

test('invalid reference inline does not fall back to a legacy success result', async () => {
  const data = stage(44, null, { selectedReference: { organismName: 'legacy-reference' } })
  data.output.parseErrors = { inline: 'invalid inline' }
  const html = await render(ReferenceSelectionResult, data)
  assert.match(html, /参考选择结果解析失败/)
  assert.doesNotMatch(html, /legacy-reference/)
  assert.match(
    await render(
      ReferenceSelectionResult,
      stage(44, null, { selectedReference: { organismName: 'legacy-reference' } })
    ),
    /legacy-reference/
  )
})

test('taxonomy has no urls fallback and does not invent best from the first candidate', async () => {
  assert.match(
    await render(TaxonomyResult, stage(10, null, { best: { name: 'legacy-best' } })),
    /暂无物种分类结果/
  )
  const html = await render(
    TaxonomyResult,
    stage(10, {
      status: 1,
      best: null,
      candidates: [{ taxid: 562, name: 'Candidate A', rank: 'species', score: 96.5 }],
      evidenceResource: 'FASTANI'
    })
  )
  assert.match(html, /尚未确定/)
  assert.match(html, /分类存在歧义/)
  assert.match(html, /Candidate A/)
  assert.match(html, /562/)
  assert.match(html, /ANI 分值/)
})

test('confirmed taxonomy uses original evidence and preserves unresolved/unclassified bin shares', async () => {
  const html = await render(
    TaxonomyResult,
    stage(10, {
      status: 0,
      evidenceResource: 'USER_CONFIRMED',
      best: { taxid: 2, name: 'Confirmed species', score: 60 },
      candidates: [{ taxid: 2, name: 'Confirmed species', score: 60 }],
      manualConfirmation: {
        speciesTaxId: 2,
        originalEvidenceResource: 'KRAKEN2',
        originalStatus: 1,
        confirmedAt: 1780000000000,
        confirmedBy: 'reviewer',
        reason: '<b>checked</b>'
      },
      binningMetrics: {
        totalContigs: 10,
        totalAssemblyBases: 1000,
        speciesAssignedContigs: 6,
        speciesAssignedBases: 600,
        unresolvedContigs: 3,
        unresolvedBases: 300,
        unclassifiedContigs: 1,
        unclassifiedBases: 100,
        dominantSpeciesName: 'Original dominant bin',
        dominantSpeciesTaxId: 3,
        dominantSpeciesAssemblyFraction: 0.6,
        bins: [
          { taxId: 3, name: 'Original dominant bin', rankCode: 'S', assemblyFraction: 0.6 },
          { taxId: 4, name: 'Unresolved genus', rankCode: 'G', assemblyFraction: 0.3 },
          { taxId: 0, name: 'Unclassified', rankCode: 'U', assemblyFraction: 0.1 }
        ]
      }
    })
  )
  assert.match(html, /组装碱基加权百分比/)
  assert.match(html, /60\.00%/)
  assert.match(html, /width:60%/)
  assert.match(html, /width:30%/)
  assert.match(html, /width:10%/)
  assert.match(html, /层级 G/)
  assert.match(html, /层级 U/)
  assert.match(html, /已分类但未解析到物种/)
  assert.match(html, /Original dominant bin/)
  assert.match(html, /Confirmed species/)
  assert.match(html, /&lt;b&gt;checked&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<b>checked/)
})

test('partial bin lists retain missing fraction instead of normalizing species-only data', async () => {
  const html = await render(
    TaxonomyResult,
    stage(
      10,
      {
        status: 3,
        evidenceResource: 'KRAKEN2',
        best: null,
        binningMetrics: {
          unresolvedContigs: 3,
          unclassifiedContigs: 1,
          bins: [{ taxId: 1, name: 'Species', rankCode: 'S', assemblyFraction: 0.6 }]
        }
      },
      null,
      { status: 6 }
    )
  )
  assert.match(html, /超出当前分类范围/)
  assert.match(html, /width:60%/)
  assert.match(html, /报告未列出的比例部分：40\.00%/)
  assert.doesNotMatch(html, /width:100%/)
})

test('real Element Plus SSR compiles and renders all three components without browser APIs', async () => {
  const ElementPlus = require('element-plus')
  for (const [component, data] of [
    [InputResult, stage(80)],
    [ReferenceSelectionResult, stage(44, { partial: true })],
    [TaxonomyResult, stage(10, { status: 3 })]
  ]) {
    const app = createSSRApp(component, { stage: data }).use(ElementPlus)
    app.provide(ElementPlus.ID_INJECTION_KEY, { prefix: 1, current: 0 })
    const html = await renderToString(app)
    assert.ok(html.length > 0)
  }
})
