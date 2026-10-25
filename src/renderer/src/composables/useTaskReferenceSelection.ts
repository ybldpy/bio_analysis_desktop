import {
  computed,
  getCurrentInstance,
  getCurrentScope,
  onBeforeUnmount,
  onScopeDispose,
  ref,
  shallowRef
} from 'vue'
import {
  getReferenceLibraryErrorMessage,
  queryReferenceLibrary,
  type ReferenceLibraryItem,
  type ReferenceLibraryTarget
} from '../api/referenceLibrary'

class CandidateLoadError extends Error {}

const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** A batch-local allowlist. This state never changes global reference enablement. */
export function useTaskReferenceSelection(transport: typeof queryReferenceLibrary = queryReferenceLibrary) {
  const target = shallowRef<ReferenceLibraryTarget | null>(null)
  const candidates = shallowRef<ReferenceLibraryItem[]>([])
  const selectedIds = ref<number[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  let initialized = false
  let active = true
  let requestSequence = 0
  let controller: AbortController | null = null

  const candidateIds = computed(() => new Set(candidates.value.map(item => item.referenceId)))
  const missingSelectedIds = computed(() => selectedIds.value.filter(id => !candidateIds.value.has(id)))
  const selectedCount = computed(() => selectedIds.value.length)
  const validationMessage = computed(() => {
    if (!target.value) return '请选择分析专项'
    if (loading.value) return '正在加载完整参考范围，请稍候'
    if (error.value) return error.value
    if (!loaded.value) return '请先加载本次任务参考范围'
    if (candidates.value.length === 0) return '该目标暂无全局启用的参考，请先维护参考库'
    if (missingSelectedIds.value.length > 0) return '部分已选参考已不在当前候选中，请确认移除不可用项'
    if (selectedIds.value.length === 0) return '请至少选择一条本次任务使用的参考'
    if (!selectedIds.value.every(positiveId) || new Set(selectedIds.value).size !== selectedIds.value.length) {
      return '参考选择无效，请重新选择'
    }
    return ''
  })
  const ready = computed(() => validationMessage.value === '')

  function cancel(): void {
    requestSequence++
    controller?.abort()
    controller = null
  }

  function dispose(): void {
    if (!active) return
    active = false
    cancel()
    loading.value = false
    loaded.value = false
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  if (getCurrentScope()) onScopeDispose(dispose)

  async function setTarget(next: ReferenceLibraryTarget | null): Promise<void> {
    if (!active) return
    const supported = next && (next.pipelineType === 100 || next.pipelineType === 101)
    const nextTarget = supported ? { ...next } : null
    if (target.value?.taxId === nextTarget?.taxId && target.value?.pipelineType === nextTarget?.pipelineType) {
      target.value = nextTarget
      return
    }
    cancel()
    target.value = nextTarget
    candidates.value = []
    selectedIds.value = []
    initialized = false
    loaded.value = false
    loading.value = false
    error.value = ''
    if (nextTarget) await refresh()
  }

  async function refresh(): Promise<void> {
    if (!active || !target.value) return
    cancel()
    controller = new AbortController()
    const { signal } = controller
    const sequence = requestSequence
    const context = { ...target.value }
    loading.value = true
    loaded.value = false
    error.value = ''
    const isCurrent = () => active && sequence === requestSequence && !signal.aborted
    try {
      let total: number | null = null
      const rows: ReferenceLibraryItem[] = []
      const ids = new Set<number>()
      do {
        const start = rows.length
        // Do not copy the management page's orgType/taxId/accession filters here.
        const response = await transport({
          targetTaxId: context.taxId,
          pipelineType: context.pipelineType,
          enabled: true,
          start,
          pageSize: 100
        }, signal)
        if (!isCurrent()) return
        if (response?.status !== 0 || response.data == null) throw response
        const page = response.data
        if (!Number.isSafeInteger(page.total) || page.total < 0 || !Array.isArray(page.items) ||
          page.start !== start || !positiveId(page.pageSize) || page.pageSize > 100 ||
          page.items.length > page.pageSize) {
          throw new CandidateLoadError('参考候选响应格式不正确，请重新刷新')
        }
        if (total !== null && page.total !== total) {
          throw new CandidateLoadError('参考候选总数在加载时发生变化，请重新刷新')
        }
        total = page.total
        if (start + page.items.length > total || (page.items.length === 0 && start < total)) {
          throw new CandidateLoadError('参考候选未完整加载，请重新刷新')
        }
        for (const item of page.items) {
          if (!item || !positiveId(item.referenceId) || item.enabled !== true) {
            throw new CandidateLoadError('参考候选包含无效或未启用记录，请重新刷新')
          }
          if (ids.has(item.referenceId)) {
            throw new CandidateLoadError('参考候选出现重复记录，请重新刷新')
          }
          ids.add(item.referenceId)
          rows.push(item)
        }
      } while (rows.length < total)
      // Commit only a complete response. A failed later page cannot look like a complete list.
      candidates.value = rows
      if (!initialized) selectedIds.value = rows.map(item => item.referenceId)
      initialized = true
      loaded.value = true
    } catch (cause) {
      if (!isCurrent()) return
      error.value = cause instanceof CandidateLoadError ? cause.message :
        getReferenceLibraryErrorMessage(cause, '参考候选加载失败，请重试')
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  const canEdit = () => active && loaded.value && !loading.value && !error.value

  function setSelected(referenceId: number, selected: boolean): void {
    if (!canEdit() || !candidateIds.value.has(referenceId)) return
    if (selected) {
      if (!selectedIds.value.includes(referenceId)) selectedIds.value = [...selectedIds.value, referenceId]
    } else {
      selectedIds.value = selectedIds.value.filter(id => id !== referenceId)
    }
  }

  function selectAll(): void {
    if (!canEdit()) return
    // Missing selections require their own explicit acknowledgement; never silently discard them.
    selectedIds.value = [...new Set([...selectedIds.value, ...candidateIds.value])]
  }

  function clearSelection(): void {
    if (canEdit()) selectedIds.value = []
  }

  function removeUnavailableSelection(): void {
    if (canEdit()) selectedIds.value = selectedIds.value.filter(id => candidateIds.value.has(id))
  }

  return {
    target, candidates, selectedIds, loading, loaded, error, selectedCount, ready,
    validationMessage, missingSelectedIds, setTarget, refresh, setSelected,
    selectAll, clearSelection, removeUnavailableSelection
  }
}

export type TaskReferenceSelection = ReturnType<typeof useTaskReferenceSelection>
