import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { prepareBatchFileImport } from './batchFileImport'
import type { FastqFileDescriptor } from './fastqPairing'

const file = (name: string, webkitRelativePath = ''): FastqFileDescriptor => ({
  name,
  webkitRelativePath
})

test('directory import pairs only direct children and separates skipped files from unsupported extensions', () => {
  const r1 = file('sample_R1.fastq', 'picked/sample_R1.fastq')
  const r2 = file('sample_R2.fastq', 'picked/sample_R2.fastq')
  const note = file('notes.txt', 'picked/notes.txt')
  const children = [
    file('nested_R1.fastq', 'picked/sub/nested_R1.fastq'),
    file('notes.txt', 'picked/sub/deep/notes.txt')
  ]
  const result = prepareBatchFileImport([r2, ...children, note, r1], true)
  assert.deepEqual(result.groups, [{ r1, r2 }])
  assert.deepEqual(result.ignoredFiles, [note])
  assert.deepEqual(result.ambiguousFiles, [])
  assert.equal(result.skippedSubdirectoryFiles, 2)
})

test('a direct R1 cannot be paired with R2 from a nested directory', () => {
  const r1 = file('sample_R1.fq.gz', 'picked/sample_R1.fq.gz')
  const childR2 = file('sample_R2.fq.gz', 'picked/sub/sample_R2.fq.gz')
  const result = prepareBatchFileImport([r1, childR2], true)
  assert.deepEqual(result.groups, [{ r1, r2: null }])
  assert.equal(result.skippedSubdirectoryFiles, 1)
})

test('a selection containing only nested files creates no tasks, including deep descendants', () => {
  const result = prepareBatchFileImport(
    [file('a.fastq', 'picked/sub/a.fastq'), file('b.fastq', 'picked/sub/deep/b.fastq')],
    true
  )
  assert.deepEqual(result.groups, [])
  assert.deepEqual(result.ignoredFiles, [])
  assert.equal(result.skippedSubdirectoryFiles, 2)
})

test('ordinary multi-select remains unchanged, even for files with relative paths', () => {
  const r1 = file('a_R1.fastq')
  const r2 = file('a_R2.fastq')
  const nested = file('single.fastq', 'picked/sub/single.fastq')
  const result = prepareBatchFileImport([nested, r2, r1], false)
  assert.equal(result.groups.length, 2)
  assert.ok(result.groups.some((group) => group.r1 === r1 && group.r2 === r2))
  assert.ok(result.groups.some((group) => group.r1 === nested && group.r2 === null))
  assert.equal(result.skippedSubdirectoryFiles, 0)
})

test('directory depth accepts backslashes and Unicode names without reading file contents', () => {
  const r1 = Object.freeze(file('样本_R1.fastq', '测试目录\\样本_R1.fastq'))
  const r2 = Object.freeze(file('样本_R2.fastq', '测试目录\\样本_R2.fastq'))
  const child = Object.freeze(file('child.fastq', '测试目录\\子目录\\child.fastq'))
  const result = prepareBatchFileImport(Object.freeze([r1, r2, child]), true)
  assert.deepEqual(result.groups, [{ r1, r2 }])
  assert.equal(result.skippedSubdirectoryFiles, 1)
  assert.deepEqual(prepareBatchFileImport([], true).groups, [])
})

test('existing on-disk filename fixtures follow the new non-recursive import expectations', () => {
  const root = path.resolve(__dirname, '../../../../../test-data/fastq-filename-check')
  function filesIn(directory: string, selectedRoot: string): FastqFileDescriptor[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name)
      return entry.isDirectory()
        ? filesIn(full, selectedRoot)
        : [
            file(
              entry.name,
              `${path.basename(selectedRoot)}/${path.relative(selectedRoot, full).replace(/\\/g, '/')}`
            )
          ]
    })
  }
  // Emulate the browser's FileList, including descendants; the import must discard them.
  const whole = prepareBatchFileImport(filesIn(root, root), true)
  assert.equal(whole.groups.length, 0)
  assert.equal(whole.ignoredFiles.length, 1)
  assert.equal(whole.skippedSubdirectoryFiles, 33)
  const basic = path.join(root, '01-basic-multi-select')
  const result = prepareBatchFileImport(filesIn(basic, basic), true)
  assert.equal(result.groups.filter((group) => group.r2 !== null).length, 4)
  assert.equal(result.groups.filter((group) => group.r2 === null).length, 3)
  assert.equal(result.ignoredFiles.length, 2)
  assert.equal(result.skippedSubdirectoryFiles, 0)
})
