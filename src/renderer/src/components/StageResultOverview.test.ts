import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ElementPlus, { ID_INJECTION_KEY } from 'element-plus'
import ts from 'typescript'
import { createSSRApp, defineComponent, h, ref } from 'vue'
import type { AnalysisPipelineStage } from '../common/analysisPipeline'
import { getStageFiles } from '../common/pipelineResults'

const filename = resolve('src/renderer/src/components/StageResultOverview.vue')
const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
assert.deepEqual(errors, [])
const source = compileScript(descriptor, { id: 'stage-overview-test', inlineTemplate: true }).content
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText
const realRequire = createRequire(filename)
const componentModule = { exports: {} as any }
new Function('require', 'module', 'exports', compiled)(
  (name: string) => {
    if (name.endsWith('/useStageMetrics')) return {
      useStageMetrics: () => ({ metrics: ref(null), loading: ref(false), error: ref(''), reload() {} })
    }
    if (name.endsWith('/useStageReport')) return {
      useStageReport: () => ({
        qcReport: ref(null), textReport: ref(null), loading: ref(false), error: ref(''),
        message: ref(''), reload() {}
      })
    }
    if (name.endsWith('.vue')) {
      const panel = name.split('/').pop()!.replace('.vue', '')
      return { __esModule: true, default: defineComponent({
        inheritAttrs: false,
        props: ['stage', 'refreshVersion', 'pipelineName'],
        setup(props) {
          return () => h('section', {
            'data-panel': panel,
            'data-stage': (props.stage as AnalysisPipelineStage | undefined)?.stageId,
            'data-version': props.refreshVersion,
            'data-name': props.pipelineName
          }, panel === 'ResultFiles'
            ? getStageFiles(props.stage as AnalysisPipelineStage).map(file => h('span', file.label))
            : [])
        }
      }) }
    }
    return realRequire(name)
  }, componentModule, componentModule.exports
)

function stage(type: number, urls: Record<string, unknown> | null = null): AnalysisPipelineStage {
  return {
    stageId: 588, stageName: '软件测试阶段', stageType: type, status: 4,
    startTime: null, endTime: null, output: { urls, inline: null }
  }
}
async function render(pipelineStage: AnalysisPipelineStage) {
  const app = createSSRApp(componentModule.exports.default, {
    pipelineStage,
    pipeline: {
      pipelineId: 1, pipelineType: 100, status: 2,
      analysisPipelineName: '软件测试任务', createTime: new Date(), projectId: 1
    },
    refreshVersion: 7, refreshing: false, confirmationState: null
  })
  app.use(ElementPlus)
  app.provide(ID_INJECTION_KEY, { prefix: 1, current: 0 })
  return renderToString(app)
}

test('overview routes stage 43 to comparison with context and keeps v2 summary downloads', async () => {
  const html = await render(stage(43, {
    schemaVersion: 2, candidateCount: 3, matchedCandidateCount: 2, unmatchedCandidateCount: 1,
    comparisonJsonUrl: 'test/comparison.json', comparisonTsvUrl: 'test/comparison.tsv'
  }))
  assert.match(html, /data-panel="ReferenceComparisonResult" data-stage="588" data-version="7" data-name="软件测试任务"/)
  assert.match(html, /data-panel="ResultFiles"/)
  assert.match(html, /JSON/)
  assert.match(html, /TSV/)
  assert.doesNotMatch(html, /data-panel="ReferenceSelectionResult"|尚未提供独立汇总指标/)
})

test('overview preserves historical comparison downloads and does not invent a selection stage', async () => {
  const html = await render(stage(43, { pafPath: 'test/old.paf', differenceTsv: 'test/old.tsv' }))
  assert.match(html, /data-panel="ReferenceComparisonResult"/)
  assert.match(html, /参考比较 PAF/)
  assert.match(html, /差异报告 TSV/)
  assert.doesNotMatch(html, /data-panel="ReferenceSelectionResult"/)
})

test('overview keeps reads reference selection and other stage branches unchanged', async () => {
  assert.match(await render(stage(44)), /data-panel="ReferenceSelectionResult"/)
  assert.doesNotMatch(await render(stage(44)), /data-panel="ReferenceComparisonResult"/)
  assert.match(await render(stage(30)), /尚未提供序列条数、N50 等汇总指标/)
  const unsupported = await render(stage(43, { schemaVersion: 3, pafPath: 'test/old.paf' }))
  assert.match(unsupported, /data-panel="ReferenceComparisonResult"/)
  assert.doesNotMatch(unsupported, /参考比较 PAF/)
})
