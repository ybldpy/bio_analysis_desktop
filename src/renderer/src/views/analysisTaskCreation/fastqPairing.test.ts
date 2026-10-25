import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pairFastqFiles, type FastqFileDescriptor } from './fastqPairing'

function file(name: string, directory = ''): FastqFileDescriptor {
  return { name, webkitRelativePath: directory ? `${directory}/${name}` : '' }
}

test('pairs common read markers and Illumina names while preserving file references', () => {
  const names = [
    ['sample_R1.fastq.gz', 'sample_R2.fastq.gz'],
    ['sample.R1.fq', 'sample.R2.fq'],
    ['sample-R1.fastq', 'sample-R2.fastq'],
    ['sample_1.fq.gz', 'sample_2.fq.gz'],
    ['sample.1.fastq', 'sample.2.fastq'],
    ['sample-1.fastq', 'sample-2.fastq'],
    ['sample_S1_L001_R1_001.fastq.gz', 'sample_S1_L001_R2_001.fastq.gz'],
    ['sample_r1.fastq', 'sample_r2.fastq'],
    ['sample_R1.FASTQ.GZ', 'sample_R2.fq']
  ]

  for (const [r1Name, r2Name] of names) {
    const r1 = file(r1Name)
    const r2 = file(r2Name)
    const result = pairFastqFiles([r2, r1])
    assert.equal(result.groups.length, 1, r1Name)
    assert.equal(result.groups[0].r1, r1)
    assert.equal(result.groups[0].r2, r2)
    assert.deepEqual(result.ignoredFiles, [])
    assert.deepEqual(result.ambiguousFiles, [])
  }
})

test('orders groups naturally and consistently regardless of selection order', () => {
  const files = [
    file('sample10_R2.fastq'),
    file('sample2_R1.fastq'),
    file('sample1.fastq'),
    file('sample10_R1.fastq'),
    file('sample2_R2.fastq')
  ]
  const expected = [
    { r1: files[2], r2: null },
    { r1: files[1], r2: files[4] },
    { r1: files[3], r2: files[0] }
  ]
  assert.deepEqual(pairFastqFiles(files).groups, expected)
  assert.deepEqual(pairFastqFiles([...files].reverse()).groups, expected)
})

test('supports empty input and single-end files, including orphan R2', () => {
  assert.deepEqual(pairFastqFiles([]), {
    groups: [],
    ignoredFiles: [],
    ambiguousFiles: []
  })

  for (const name of ['sample.fastq', 'sample_R1.fq.gz', 'sample_R2.fastq.gz']) {
    const selectedFile = file(name)
    assert.deepEqual(pairFastqFiles([selectedFile]).groups, [
      { r1: selectedFile, r2: null }
    ])
  }
})

test('keeps identical sample names in different directories separate', () => {
  const aR1 = file('sample_R1.fastq', 'run/a')
  const bR2 = file('sample_R2.fastq', 'run/b')
  assert.deepEqual(pairFastqFiles([bR2, aR1]).groups, [
    { r1: aR1, r2: null },
    { r1: bR2, r2: null }
  ])

  const aR2 = file('sample_R2.fastq', 'run/a')
  const bR1 = file('sample_R1.fastq', 'run/b')
  assert.deepEqual(pairFastqFiles([bR2, aR2, bR1, aR1]).groups, [
    { r1: aR1, r2: aR2 },
    { r1: bR1, r2: bR2 }
  ])
})

test('never merges different lanes or chunks', () => {
  const lane1R1 = file('sample_S1_L001_R1_001.fastq.gz')
  const lane1R2 = file('sample_S1_L001_R2_001.fastq.gz')
  const lane2R1 = file('sample_S1_L002_R1_001.fastq.gz')
  const lane2R2 = file('sample_S1_L002_R2_001.fastq.gz')
  const nextChunk = file('sample_S1_L001_R2_002.fastq.gz')
  const result = pairFastqFiles([lane2R2, nextChunk, lane1R1, lane2R1, lane1R2])

  assert.deepEqual(result.groups, [
    { r1: lane1R1, r2: lane1R2 },
    { r1: nextChunk, r2: null },
    { r1: lane2R1, r2: lane2R2 }
  ])
})

test('keeps every ambiguous candidate as single-end instead of choosing a mate', () => {
  const r1 = file('sample_R1.fastq')
  const duplicateR1 = file('sample_R1.fastq')
  const r2 = file('sample_R2.fastq')
  const result = pairFastqFiles([r2, r1, duplicateR1])

  assert.deepEqual(result.groups, [
    { r1, r2: null },
    { r1: duplicateR1, r2: null },
    { r1: r2, r2: null }
  ])
  assert.deepEqual(result.ambiguousFiles, [r1, duplicateR1, r2])
})

test('ignores non-FASTQ files but accepts case-insensitive FASTQ extensions', () => {
  const accepted = [file('reads.FQ'), file('reads2.FASTQ.GZ')]
  const ignored = [
    file('assembly.fasta'),
    file('notes.txt'),
    file('reads.fastq.bak'),
    file('reads.gz'),
    file('reads.fastq.zip')
  ]
  const result = pairFastqFiles([...ignored, ...accepted])
  assert.equal(result.groups.length, 2)
  assert.ok(result.groups.every(({ r1, r2 }) => accepted.includes(r1) && r2 === null))
  assert.equal(result.ignoredFiles.length, ignored.length)
  assert.ok(result.ignoredFiles.every((entry) => ignored.includes(entry)))
})

test('does not confuse sample numbers, sample case or different naming conventions', () => {
  const pairsThatMustStaySingle = [
    ['sample1.fastq', 'sample2.fastq'],
    ['sample_11.fastq', 'sample_12.fastq'],
    ['sample_R11.fastq', 'sample_R12.fastq'],
    ['Sample_R1.fastq', 'sample_R2.fastq'],
    ['sample_R1.fastq', 'sample_r2.fastq'],
    ['sample_R1.fastq', 'sample_2.fastq'],
    ['sample_R1.fastq', 'sample.R2.fastq'],
    ['sample_S1_L001.fastq', 'sample_S1_L002.fastq']
  ]
  for (const names of pairsThatMustStaySingle) {
    const result = pairFastqFiles(names.map((name) => file(name)))
    assert.equal(result.groups.length, 2, names.join(', '))
    assert.ok(result.groups.every((group) => group.r2 === null))
  }
})

test('preserves every accepted input occurrence exactly once without mutating inputs', () => {
  const duplicate = Object.freeze(file('duplicate_R1.fastq'))
  const files = Object.freeze([
    Object.freeze(file('sample_R2.fastq')),
    Object.freeze(file('sample_R1.fastq')),
    Object.freeze(file('orphan_R2.fq.gz')),
    Object.freeze(file('single.fastq')),
    duplicate,
    duplicate,
    Object.freeze(file('duplicate_R2.fastq')),
    Object.freeze(file('notes.txt'))
  ])
  const result = pairFastqFiles(files)
  const output = result.groups.flatMap(({ r1, r2 }) => (r2 ? [r1, r2] : [r1]))
  const accepted = files.filter((entry) => entry.name !== 'notes.txt')
  assert.equal(output.length, accepted.length)
  for (const entry of new Set(accepted)) {
    assert.equal(
      output.filter((item) => item === entry).length,
      accepted.filter((item) => item === entry).length
    )
  }
})
