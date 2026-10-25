// Generates tiny artificial files for filename matching, not biological analysis.
const fs = require('node:fs')
const path = require('node:path')
const { gzipSync } = require('node:zlib')

const root = path.resolve(__dirname, '../test-data/fastq-filename-check')
const groups = {
  '01-basic-multi-select': [
    'sampleA_R1.fastq.gz', 'sampleA_R2.fastq.gz',
    'sampleB_1.fq.gz', 'sampleB_2.fq.gz',
    'sampleC_R1_001.fastq.gz', 'sampleC_R2_001.fastq.gz',
    'sampleD.R1.fastq', 'sampleD.R2.fastq',
    'single_reads.fastq.gz', 'orphanA_R1.fastq.gz', 'orphanB_R2.fastq.gz'
  ],
  '02-directory': [
    'run_a/shared_R1.fq.gz', 'run_a/shared_R2.fq.gz',
    'run_b/shared_R1.fq.gz', 'run_b/shared_R2.fq.gz',
    'split_a/split_R1.fq.gz', 'split_b/split_R2.fq.gz'
  ],
  '03-edge-cases': [
    'lanes/sample_S1_L001_R1_001.fastq.gz', 'lanes/sample_S1_L001_R2_001.fastq.gz',
    'lanes/sample_S1_L002_R1_001.fastq.gz', 'lanes/sample_S1_L002_R2_001.fastq.gz',
    'chunks/chunk_R1_001.fastq.gz', 'chunks/chunk_R2_002.fastq.gz',
    'ambiguous/duplicate_R1.fastq.gz', 'ambiguous/duplicate_R1.fq.gz', 'ambiguous/duplicate_R2.fastq.gz',
    'uppercase/upper_R1.FASTQ.GZ', 'uppercase/upper_R2.FQ.GZ',
    'mixed-marker/mixed_R1.fastq', 'mixed-marker/mixed_2.fastq'
  ]
}
const sequence = 'ACGT'.repeat(8)
const content = [1, 2].map(i => `@ui_filename_fixture_${i}\n${sequence}\n+\n${'I'.repeat(sequence.length)}\n`).join('')
const files = Object.entries(groups).flatMap(([folder, names]) => names.map(name => ({
  relative: `${folder}/${name}`,
  data: /\.gz$/i.test(name) ? gzipSync(Buffer.from(content)) : Buffer.from(content)
})))
files.push(
  { relative: '01-basic-multi-select/ignore.txt', data: Buffer.from('Not a FASTQ file. Expected to be ignored.\n') },
  { relative: '01-basic-multi-select/ignore.fastq.bak', data: Buffer.from('Backup extension. Expected to be ignored.\n') },
  { relative: '03-edge-cases/ignore.fasta', data: Buffer.from('>artificial_ui_fixture\nACGTACGT\n') }
)

// Refuse overwrites; all generated paths are fixed and remain under this fixture directory.
for (const file of files) {
  const target = path.resolve(root, file.relative)
  if (!target.startsWith(root + path.sep)) throw new Error('Fixture path leaves its directory')
  if (fs.existsSync(target)) throw new Error(`Already exists; nothing overwritten: ${target}`)
}
for (const file of files) {
  const target = path.resolve(root, file.relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, file.data, { flag: 'wx' })
}
console.log(JSON.stringify({ directory: root, fastqFiles: 30, intentionallyIgnoredFiles: 3, generatedFiles: files.length }, null, 2))
