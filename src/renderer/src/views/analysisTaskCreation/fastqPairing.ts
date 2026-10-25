export interface FastqFileDescriptor {
  name: string
  webkitRelativePath?: string
}

interface FileEntry<T> {
  file: T
  index: number
  path: string
  pairKey: string | null
  read: '1' | '2' | null
}

const fileNameCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'variant'
})

/** Groups selected FASTQ files by filename; unmatched files remain single-end. */
export function pairFastqFiles<T extends FastqFileDescriptor>(files: readonly T[]): {
  groups: Array<{ r1: T; r2: T | null }>
  ignoredFiles: T[]
  ambiguousFiles: T[]
} {
  const entries = files
    .map((file, index) => ({
      file,
      index,
      path: (file.webkitRelativePath || file.name).replace(/\\/g, '/')
    }))
    .sort((left, right) => {
      const naturalOrder = fileNameCollator.compare(left.path, right.path)
      if (naturalOrder !== 0) return naturalOrder
      if (left.path !== right.path) return left.path < right.path ? -1 : 1
      return left.index - right.index
    })

  const acceptedEntries: Array<FileEntry<T>> = []
  const ignoredFiles: T[] = []
  const candidates = new Map<
    string,
    { read1: Array<FileEntry<T>>; read2: Array<FileEntry<T>> }
  >()

  for (const entry of entries) {
    const extension = entry.file.name.match(/\.(?:fastq|fq)(?:\.gz)?$/i)
    if (!extension) {
      ignoredFiles.push(entry.file)
      continue
    }

    const stem = entry.file.name.slice(0, -extension[0].length)
    const directory = entry.path.slice(0, entry.path.lastIndexOf('/') + 1)
    // Keep lane/chunk fields in the key. Only the read number is removed.
    const namedRead = stem.match(/^(.+)([._-])([Rr])([12])((?:[._-]\d+)*)$/)
    const numberedRead = namedRead ? null : stem.match(/^(.+)([._-])([12])$/)
    const match = namedRead || numberedRead
    const read = match ? ((namedRead ? match[4] : match[3]) as '1' | '2') : null
    const pairKey = match
      ? JSON.stringify([
          directory,
          match[1],
          match[2],
          namedRead ? match[3] : '',
          namedRead ? match[5] : ''
        ])
      : null

    const acceptedEntry: FileEntry<T> = { ...entry, pairKey, read }
    acceptedEntries.push(acceptedEntry)

    if (pairKey !== null) {
      let candidate = candidates.get(pairKey)
      if (!candidate) {
        candidate = { read1: [], read2: [] }
        candidates.set(pairKey, candidate)
      }
      if (read === '1') candidate.read1.push(acceptedEntry)
      else candidate.read2.push(acceptedEntry)
    }
  }

  const groups: Array<{ r1: T; r2: T | null }> = []
  const ambiguousFiles: T[] = []
  const pairedKeys = new Set<string>()

  for (const entry of acceptedEntries) {
    if (entry.pairKey === null) {
      groups.push({ r1: entry.file, r2: null })
      continue
    }

    const candidate = candidates.get(entry.pairKey)!
    if (candidate.read1.length > 1 || candidate.read2.length > 1) {
      ambiguousFiles.push(entry.file)
      groups.push({ r1: entry.file, r2: null })
    } else if (candidate.read1.length === 1 && candidate.read2.length === 1) {
      if (!pairedKeys.has(entry.pairKey)) {
        groups.push({ r1: candidate.read1[0].file, r2: candidate.read2[0].file })
        pairedKeys.add(entry.pairKey)
      }
    } else {
      // A lone R2 still contains usable reads and becomes a single-end task.
      groups.push({ r1: entry.file, r2: null })
    }
  }

  return { groups, ignoredFiles, ambiguousFiles }
}
