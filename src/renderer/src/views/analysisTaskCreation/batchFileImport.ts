import { pairFastqFiles, type FastqFileDescriptor } from './fastqPairing'

/** Directory pickers include descendants; only import files directly under the selected root. */
export function prepareBatchFileImport<T extends FastqFileDescriptor>(
  files: readonly T[],
  fromDirectory: boolean
) {
  const importableFiles = fromDirectory
    ? files.filter((file) => {
        const parts = (file.webkitRelativePath ?? '').replace(/\\/g, '/').split('/')
        return parts.length === 2 && parts.every((part) => part.length > 0)
      })
    : files

  return {
    ...pairFastqFiles(importableFiles),
    skippedSubdirectoryFiles: files.length - importableFiles.length
  }
}
