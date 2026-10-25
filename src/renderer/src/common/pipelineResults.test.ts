import assert from 'node:assert/strict'
import test from 'node:test'
import {
  asRecord,
  convertStageResult,
  formatDate,
  formatDepth,
  formatFraction,
  formatNumber,
  formatPercent,
  getReferenceSelection,
  getStageFiles,
  getStageStatusMeta,
  hasStageResult,
  sortResultStages,
  type AnalysisPipelineStageDTO
} from './pipelineResults'

const dto = (overrides: Partial<AnalysisPipelineStageDTO> = {}): AnalysisPipelineStageDTO => ({
  stageId: 1,
  stageType: 20,
  stageName: '示例阶段',
  status: 4,
  startTime: null,
  outputUrl: null,
  outputInline: null,
  ...overrides
})

test('parses each stage output independently and does not discard sibling fields or stages', () => {
  const stages = [
    dto({ outputUrl: '{broken', outputInline: '{"status":0,"best":null}' }),
    dto({
      stageId: 2,
      outputUrl: '{"metricsUrl":"stageOutput/2/metrics.json"}',
      outputInline: '[]'
    })
  ].map(convertStageResult)
  assert.equal(stages.length, 2)
  assert.equal(stages[0].output.urls, null)
  assert.deepEqual(stages[0].output.inline, { status: 0, best: null })
  assert.match(stages[0].output.parseErrors?.urls ?? '', /解析失败/)
  assert.equal(stages[0].output.parseErrors?.inline, undefined)
  assert.equal(stages[1].output.urls?.metricsUrl, 'stageOutput/2/metrics.json')
  assert.match(stages[1].output.parseErrors?.inline ?? '', /JSON 对象/)
})

test('missing output and dates stay missing; valid epoch milliseconds and zero remain valid', () => {
  for (const output of [undefined, null, '', '  ', 'null']) {
    const stage = convertStageResult(
      dto({ outputUrl: output, outputInline: output, startTime: null, endTime: '' })
    )
    assert.deepEqual(stage.output, { urls: null, inline: null })
    assert.equal(stage.startTime, null)
    assert.equal(stage.endTime, null)
  }
  const stage = convertStageResult(dto({ startTime: 0, endTime: '2026-10-21T10:00:00+08:00' }))
  assert.equal(stage.startTime?.getTime(), 0)
  assert.equal(stage.endTime?.getTime(), Date.parse('2026-10-21T02:00:00Z'))
  assert.equal(convertStageResult(dto({ startTime: 'invalid' })).startTime, null)
})

test('explicit file contracts include optional reports and retain opaque storage keys', () => {
  const fixtures: Array<[number, Record<string, unknown>, string[]]> = [
    [
      80,
      { readMeta: { sequencingPlatform: 1001 }, r1Url: '目录/R1 & 原始.fastq.gz', r2Url: null },
      ['r1Url']
    ],
    [
      0,
      { cleanedR1: 'r1.gz', cleanedR2: '', reportJSON: 'qc.json', reportHTML: 'qc.html' },
      ['cleanedR1', 'reportJSON', 'reportHTML']
    ],
    [30, { contigsUrl: 'assembly.fa', scaffoldUrl: null }, ['contigsUrl']],
    [
      20,
      {
        bamUrl: 'a.bam',
        bamIndexUrl: 'a.bai',
        coverageDepthUrl: 'depth.tsv',
        metricsUrl: 'mapping.json'
      },
      ['bamUrl', 'bamIndexUrl', 'coverageDepthUrl', 'metricsUrl']
    ],
    [
      40,
      {
        rawVcfGzUrl: null,
        rawVcfTbiUrl: null,
        vcfGzUrl: 'variants.vcf.gz',
        vcfTbiUrl: 'variants.vcf.gz.tbi',
        metricsUrl: 'variant.json'
      },
      ['vcfGzUrl', 'vcfTbiUrl', 'metricsUrl']
    ],
    [
      41,
      { consensusUrl: 'consensus.fa', maskBedUrl: 'mask.bed', metricsUrl: 'mask.json' },
      ['consensusUrl', 'maskBedUrl', 'metricsUrl']
    ],
    [
      43,
      { pafPath: 'comparison.paf', differenceTsv: 'differences.tsv' },
      ['pafPath', 'differenceTsv']
    ],
    [72, { annotatedVCF: 'annotated.vcf' }, ['annotatedVCF']],
    [60, { amrResult: 'amr.tsv' }, ['amrResult']],
    [62, { mlst: 'mlst.tsv' }, ['mlst']],
    [
      64,
      { serotypeResultUrl: 'typing.txt', kaptiveKResultUrl: '', kaptiveOResultUrl: 'O.tsv' },
      ['serotypeResultUrl', 'kaptiveOResultUrl']
    ]
  ]
  for (const [stageType, output, fields] of fixtures) {
    const stage = convertStageResult(dto({ stageType, outputUrl: JSON.stringify(output) }))
    const files = getStageFiles(stage)
    assert.deepEqual(
      files.map((file) => file.key),
      fields
    )
    for (const file of files) {
      assert.equal(file.fileKey, output[file.key])
      assert.equal(file.fileName, String(output[file.key]).split('/').pop())
      assert.ok(file.label.length > 0)
    }
  }
})

test('taxonomy file keys only come from inline and VF legacy key is limited to VF', () => {
  const inline = {
    mainBinFastaUrl: 'bin.fa',
    contigAssignmentReportUrl: 'assignment.tsv',
    evidenceResource: 'FASTANI'
  }
  const taxonomy = convertStageResult(
    dto({
      stageType: 10,
      outputInline: JSON.stringify(inline),
      outputUrl: '{"mainBinFastaUrl":"wrong.fa"}'
    })
  )
  assert.deepEqual(
    getStageFiles(taxonomy).map((file) => file.fileKey),
    ['bin.fa', 'assignment.tsv']
  )
  taxonomy.output.inline = null
  assert.deepEqual(getStageFiles(taxonomy), [])
  const vf = convertStageResult(dto({ stageType: 61, outputUrl: '{"amrTsv":"old-vf.tsv"}' }))
  assert.equal(getStageFiles(vf)[0].label, 'VF 注释报告')
  assert.equal(getStageFiles(vf)[0].fileKey, 'old-vf.tsv')
  vf.output.urls!.vfTsv = 'current-vf.tsv'
  assert.deepEqual(
    getStageFiles(vf).map((file) => file.fileKey),
    ['current-vf.tsv']
  )
  assert.deepEqual(getStageFiles({ ...vf, stageType: 60 }), [])
})

test('reference comparison schema-v2 provides summary JSON/TSV downloads, not legacy files', () => {
  const source = {
    schemaVersion: 2,
    candidateCount: 3, matchedCandidateCount: 2, unmatchedCandidateCount: 1,
    comparisonJsonUrl: 'stageOutput/目录 & 空格/reference_comparison.json',
    comparisonTsvUrl: 'stageOutput/test/reference_comparison.tsv',
    pafPath: 'must-not-use-old.paf', differenceTsv: 'must-not-use-old.tsv'
  }
  const stage = convertStageResult(dto({ stageType: 43, outputUrl: JSON.stringify(source) }))
  assert.deepEqual(getStageFiles(stage).map(file => file.key), ['comparisonJsonUrl', 'comparisonTsvUrl'])
  assert.deepEqual(getStageFiles(stage).map(file => file.fileKey), [source.comparisonJsonUrl, source.comparisonTsvUrl])
  assert.deepEqual(getStageFiles(stage).map(file => file.fileName), ['reference_comparison.json', 'reference_comparison.tsv'])
  // File links do not depend on successful detail parsing or valid summary metrics.
  delete stage.output.urls!.candidateCount
  stage.output.inline = { error: 'report unavailable' }
  assert.equal(getStageFiles(stage).length, 2)
  stage.output.urls!.comparisonJsonUrl = ''
  assert.deepEqual(getStageFiles(stage).map(file => file.key), ['comparisonTsvUrl'])
})

test('reference comparison downloads never treat unknown explicit versions as historical output', () => {
  for (const schemaVersion of [1, 3, '2', null, undefined]) {
    const stage = convertStageResult(dto({ stageType: 43 }))
    stage.output.urls = {
      schemaVersion, pafPath: 'legacy.paf', differenceTsv: 'legacy.tsv',
      comparisonJsonUrl: 'future.json', comparisonTsvUrl: 'future.tsv'
    }
    assert.deepEqual(getStageFiles(stage), [])
  }
  const legacy = convertStageResult(dto({ stageType: 43, outputUrl: JSON.stringify({
    pafPath: 'legacy.paf', differenceTsv: 'legacy.tsv', comparisonJsonUrl: 'unversioned.json'
  }) }))
  assert.deepEqual(getStageFiles(legacy).map(file => file.fileKey), ['legacy.paf', 'legacy.tsv'])
})

test('reference selection prefers inline and only falls back when it is missing', () => {
  const stage = convertStageResult(
    dto({ stageType: 44, outputInline: '{"partial":false}', outputUrl: '{"partial":true}' })
  )
  assert.deepEqual(getReferenceSelection(stage), { partial: false })
  assert.deepEqual(getStageFiles(stage), [])
  stage.output.inline = null
  assert.deepEqual(getReferenceSelection(stage), { partial: true })
  stage.output.parseErrors = { inline: 'bad JSON' }
  assert.equal(getReferenceSelection(stage), null)
  stage.output.parseErrors = undefined
  stage.output.inline = {}
  assert.deepEqual(getReferenceSelection(stage), {})
  assert.equal(getReferenceSelection({ ...stage, stageType: 10 }), null)
})

test('unknown/non-file values do not become downloadable links', () => {
  const stage = convertStageResult(
    dto({
      stageType: 20,
      outputUrl: '{"bamUrl":{},"bamIndexUrl":42,"metricsUrl":"   ","extraUrl":"ignored"}'
    })
  )
  assert.deepEqual(getStageFiles(stage), [])
  assert.deepEqual(getStageFiles({ ...stage, stageType: 999 }), [])
  assert.equal(asRecord(null), null)
  assert.equal(asRecord([]), null)
  assert.equal(asRecord('object'), null)
  assert.deepEqual(asRecord({ zero: 0 }), { zero: 0 })
})

test('display sorting is deterministic without mutating input or using stageIndex', () => {
  const stages = [40, 44, 0, 80, 30, 20, 999].map((stageType, index) =>
    convertStageResult(dto({ stageId: index + 1, stageType }))
  )
  const originalOrder = stages.map((stage) => stage.stageType)
  assert.deepEqual(
    sortResultStages(stages).map((stage) => stage.stageType),
    [80, 0, 30, 44, 20, 40, 999]
  )
  assert.deepEqual(
    stages.map((stage) => stage.stageType),
    originalOrder
  )
  assert.equal(hasStageResult(stages[0]), false)
  stages[0].output.inline = { count: 0 }
  assert.equal(hasStageResult(stages[0]), true)
  assert.equal(getStageStatusMeta(3).type, 'danger')
  assert.equal(getStageStatusMeta(5).label, '等待人工处理')
  assert.equal(getStageStatusMeta(6).label, '不适用／已跳过')
  assert.match(getStageStatusMeta(999).label, /999/)
})

test('formatters distinguish fractions, percentages, units, zero and missing data', () => {
  assert.equal(formatFraction(0.95), '95.00%')
  assert.equal(formatPercent(97.2), '97.20%')
  assert.equal(formatDepth(82.6), '82.60×')
  assert.equal(formatFraction(0), '0.00%')
  assert.equal(formatNumber(0), '0')
  assert.equal(formatNumber(1234), '1,234')
  for (const missing of [null, undefined, '', '0', NaN, Infinity]) {
    assert.equal(formatFraction(missing), '—')
    assert.equal(formatPercent(missing), '—')
    assert.equal(formatDepth(missing), '—')
    assert.equal(formatNumber(missing), '—')
  }
  assert.equal(formatDate(null), '—')
  assert.equal(formatDate(''), '—')
  assert.equal(formatDate('invalid date'), '—')
  const millis = Date.parse('2026-10-21T03:00:00Z')
  assert.equal(formatDate(millis), formatDate('2026-10-21T11:00:00+08:00'))
  assert.notEqual(formatDate(0), '—')
})
