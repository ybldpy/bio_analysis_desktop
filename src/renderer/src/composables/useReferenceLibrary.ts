import {
  getCurrentInstance,
  getCurrentScope,
  onBeforeUnmount,
  onScopeDispose,
  reactive,
  ref,
  shallowRef
} from 'vue'
import {
  getReferenceLibraryErrorMessage,
  getReferenceLibraryItem,
  queryReferenceLibrary,
  setReferenceLibraryEnabled,
  type ReferenceLibraryItem,
  type ReferenceLibraryPage,
  type ReferenceLibraryQuery,
  type ReferenceLibraryTarget
} from '../api/referenceLibrary'

export interface ReferenceLibraryFilters {
  taxId: string
  enabled: '' | 'enabled' | 'disabled'
  accession: string
}

export interface ReferenceLibraryTransport {
  query: typeof queryReferenceLibrary
  getItem: typeof getReferenceLibraryItem
  setEnabled: typeof setReferenceLibraryEnabled
}

class LibraryStateError extends Error {}

const emptyFilters = (): ReferenceLibraryFilters => ({
  taxId: '',
  enabled: '',
  accession: ''
})
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const validPageSize = (value: unknown): value is number => positiveInteger(value) && value <= 100

function validItem(value: unknown, expectedId?: number): value is ReferenceLibraryItem {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<ReferenceLibraryItem>
  return (
    positiveInteger(item.referenceId) &&
    typeof item.enabled === 'boolean' &&
    (expectedId === undefined || item.referenceId === expectedId)
  )
}

function validPage(value: unknown): value is ReferenceLibraryPage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const page = value as Partial<ReferenceLibraryPage>
  return (
    typeof page.total === 'number' &&
    Number.isSafeInteger(page.total) &&
    page.total >= 0 &&
    Array.isArray(page.items) &&
    page.items.every((item) => validItem(item)) &&
    (page.total !== 0 || page.items.length === 0)
  )
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof LibraryStateError
    ? cause.message
    : getReferenceLibraryErrorMessage(cause, fallback)
}

/** Data state only. The page explicitly calls refresh() on mount; no mutations are retried. */
export function useReferenceLibrary(
  transport: ReferenceLibraryTransport = {
    query: queryReferenceLibrary,
    getItem: getReferenceLibraryItem,
    setEnabled: setReferenceLibraryEnabled
  }
) {
  const filters = reactive<ReferenceLibraryFilters>(emptyFilters())
  const selectedTarget = shallowRef<ReferenceLibraryTarget | null>(null)
  // Verification is deliberately global; selectedTarget still belongs to the upload form.
  const isGlobalLookup = ref(false)
  // These are submitted conditions; editing the form must not change pagination or refresh.
  let appliedFilters: ReferenceLibraryQuery = { orgType: 0 }
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const items = shallowRef<ReferenceLibraryItem[]>([])
  const loading = ref(false)
  const hasLoaded = ref(false)
  const listError = ref('')
  const filterError = ref('')
  const pendingIds = reactive(new Set<number>())
  const operationError = ref('')
  const operationMessage = ref('')
  const detailVisible = ref(false)
  const detailLoading = ref(false)
  const detailError = ref('')
  const detailItem = shallowRef<ReferenceLibraryItem | null>(null)
  const detailId = ref<number | null>(null)
  let active = true
  let scopeSequence = 0
  let listSequence = 0
  let detailSequence = 0
  let listController: AbortController | null = null
  let detailController: AbortController | null = null

  function dispose(): void {
    if (!active) return
    active = false
    listSequence++
    detailSequence++
    listController?.abort()
    detailController?.abort()
    // A submitted mutation may already be committed. Do not cancel or retry it on unmount.
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  if (getCurrentScope()) onScopeDispose(dispose)

  function validatePagination(nextPage: number, nextSize: number): boolean {
    if (!validPageSize(nextSize)) {
      filterError.value = '每页数量必须是 1–100 的整数'
      return false
    }
    if (!positiveInteger(nextPage) || !Number.isSafeInteger((nextPage - 1) * nextSize)) {
      filterError.value = '页码必须是有效的正整数'
      return false
    }
    return true
  }

  function collectFilters(): ReferenceLibraryQuery | null {
    const taxId = filters.taxId.trim()
    const accession = filters.accession.trim()
    if (taxId && (!/^\d+$/.test(taxId) || !positiveInteger(Number(taxId)))) {
      filterError.value = 'Tax ID 必须是正整数'
      return null
    }
    if (!['', 'enabled', 'disabled'].includes(filters.enabled)) {
      filterError.value = '请选择有效的启用状态筛选'
      return null
    }
    if (accession.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(accession)) {
      filterError.value = 'accession 最长 64 个字符，且不能包含控制字符'
      return null
    }
    const query: ReferenceLibraryQuery = {}
    if (taxId) query.taxId = Number(taxId)
    if (filters.enabled !== '') query.enabled = filters.enabled === 'enabled'
    if (accession) query.accession = accession
    return query
  }

  function managementScope(): ReferenceLibraryQuery {
    const target = selectedTarget.value
    return target
      ? { orgType: 0, targetTaxId: target.taxId, pipelineType: target.pipelineType }
      : { orgType: 0 }
  }

  function clearScopeState(): void {
    scopeSequence++
    listSequence++
    listController?.abort()
    listController = null
    page.value = 1
    total.value = 0
    items.value = []
    loading.value = false
    hasLoaded.value = false
    listError.value = ''
    filterError.value = ''
    operationError.value = ''
    operationMessage.value = ''
    closeDetail()
    // Keep submitted global mutations locked by ID until they finish, even across scopes.
  }

  async function selectTarget(target: ReferenceLibraryTarget | null): Promise<boolean> {
    if (!active) return false
    clearScopeState()
    selectedTarget.value = target ? { ...target } : null
    isGlobalLookup.value = false
    Object.assign(filters, emptyFilters())
    appliedFilters = managementScope()
    return refresh()
  }

  async function returnToManagement(): Promise<boolean> {
    return selectTarget(selectedTarget.value)
  }

  async function refresh(): Promise<boolean> {
    if (!active || !validatePagination(page.value, pageSize.value)) return false
    listController?.abort()
    listController = new AbortController()
    const { signal } = listController
    const requestId = ++listSequence
    const requestedSize = pageSize.value
    const conditions = { ...appliedFilters }
    let requestedPage = page.value
    let corrections = 0
    loading.value = true
    listError.value = ''
    try {
      while (true) {
        const response = await transport.query(
          {
            ...conditions,
            start: (requestedPage - 1) * requestedSize,
            pageSize: requestedSize
          },
          signal
        )
        if (!active || requestId !== listSequence || signal.aborted) return false
        if (response?.status !== 0 || response.data === null) throw response
        if (!validPage(response.data))
          throw new LibraryStateError('参考库列表响应格式不正确，请重试')
        const next = response.data
        const lastPage = Math.max(1, Math.ceil(next.total / requestedSize))
        if (next.total > 0 && requestedPage > lastPage) {
          if (corrections >= 2)
            throw new LibraryStateError('参考库总数持续变化，分页校正已停止，请重新刷新')
          corrections++
          requestedPage = lastPage
          page.value = lastPage
          continue
        }
        page.value = next.total === 0 ? 1 : requestedPage
        items.value = next.items
        total.value = next.total
        hasLoaded.value = true
        return true
      }
    } catch (cause) {
      if (!active || requestId !== listSequence || signal.aborted) return false
      listError.value = errorMessage(cause, '参考库列表读取失败，请重试；已加载的数据予以保留')
      return false
    } finally {
      if (active && requestId === listSequence) loading.value = false
    }
  }

  async function search(): Promise<boolean> {
    if (!active) return false
    const next = collectFilters()
    if (!next || !validatePagination(1, pageSize.value)) return false
    // Form search/reset returns to the selected target's management scope.
    if (isGlobalLookup.value) clearScopeState()
    isGlobalLookup.value = false
    appliedFilters = { ...managementScope(), ...next }
    filterError.value = ''
    page.value = 1
    return refresh()
  }

  async function resetFilters(): Promise<boolean> {
    if (!active) return false
    Object.assign(filters, emptyFilters())
    return search()
  }

  async function lookupAccession(accession: string): Promise<boolean> {
    if (!active) return false
    Object.assign(filters, emptyFilters(), { accession })
    const next = collectFilters()
    if (!next || !validatePagination(1, pageSize.value)) return false
    clearScopeState()
    isGlobalLookup.value = true
    appliedFilters = next
    return refresh()
  }

  async function changePage(nextPage: number): Promise<boolean> {
    if (!active || !validatePagination(nextPage, pageSize.value)) return false
    filterError.value = ''
    page.value = nextPage
    return refresh()
  }

  async function changePageSize(nextSize: number): Promise<boolean> {
    if (!active || !validatePagination(1, nextSize)) return false
    filterError.value = ''
    pageSize.value = nextSize
    page.value = 1
    return refresh()
  }

  function invalidateDetail(): void {
    detailSequence++
    detailController?.abort()
  }

  async function refreshDetail(): Promise<boolean> {
    if (!active || !detailVisible.value || !positiveInteger(detailId.value)) return false
    invalidateDetail()
    detailController = new AbortController()
    const { signal } = detailController
    const requestId = detailSequence
    const id = detailId.value
    detailLoading.value = true
    detailError.value = ''
    try {
      const response = await transport.getItem(id, signal)
      if (!active || requestId !== detailSequence || signal.aborted) return false
      if (response?.status !== 0 || response.data === null) throw response
      if (!validItem(response.data, id))
        throw new LibraryStateError('参考记录详情响应格式不正确，请重试')
      detailItem.value = response.data
      return true
    } catch (cause) {
      if (!active || requestId !== detailSequence || signal.aborted) return false
      detailError.value = errorMessage(cause, '参考记录详情读取失败，请重试')
      return false
    } finally {
      if (active && requestId === detailSequence) detailLoading.value = false
    }
  }

  async function openDetail(id: number): Promise<boolean> {
    if (!active) return false
    invalidateDetail()
    detailVisible.value = true
    detailLoading.value = false
    detailError.value = ''
    if (detailId.value !== id) detailItem.value = null
    if (!positiveInteger(id)) {
      detailId.value = null
      detailItem.value = null
      detailError.value = '参考记录 ID 必须是正整数'
      return false
    }
    detailId.value = id
    return refreshDetail()
  }

  function closeDetail(): void {
    if (!active) return
    invalidateDetail()
    detailVisible.value = false
    detailLoading.value = false
    detailError.value = ''
    detailItem.value = null
    detailId.value = null
  }

  async function toggleEnabled(item: ReferenceLibraryItem, target: boolean): Promise<boolean> {
    if (!active) return false
    const id = item.referenceId
    if (!positiveInteger(id) || typeof target !== 'boolean') {
      operationError.value = '参考记录 ID 或启用状态无效'
      return false
    }
    if (pendingIds.has(id)) return false
    if (pendingIds.size === 0) {
      operationError.value = ''
      operationMessage.value = ''
    }
    pendingIds.add(id)
    const requestedScope = scopeSequence
    let succeeded = false
    try {
      const response = await transport.setEnabled(id, target)
      if (!active || requestedScope !== scopeSequence) return false
      if (response?.status !== 0 || response.data === null) throw response
      if (!validItem(response.data, id))
        throw new LibraryStateError('启停响应未包含该记录的有效状态，正在重新核实')
      const updated = response.data
      items.value = items.value.map((row) => (row.referenceId === id ? updated : row))
      if (detailVisible.value && detailId.value === id) {
        invalidateDetail()
        detailLoading.value = false
        detailError.value = ''
        detailItem.value = updated
      }
      operationMessage.value = `记录 #${id} 已按服务端响应更新为${updated.enabled ? '启用' : '禁用'}。`
      succeeded = true
    } catch (cause) {
      if (!active || requestedScope !== scopeSequence) return false
      const message = `记录 #${id}：${errorMessage(cause, '启停未获得明确成功结果，正在重新查询核实')}`
      operationError.value = operationError.value ? `${operationError.value}\n${message}` : message
    } finally {
      if (active) {
        try {
          const verifyDetail = (!succeeded || requestedScope !== scopeSequence) &&
            detailVisible.value && detailId.value === id
          // Enabled is global. A new scope may have read this same record before the
          // mutation committed, so re-read the CURRENT scope without applying old rows/messages.
          await Promise.all([refresh(), verifyDetail ? refreshDetail() : Promise.resolve(false)])
        } finally {
          if (active) pendingIds.delete(id)
        }
      }
    }
    return active && requestedScope === scopeSequence && succeeded
  }

  return {
    filters,
    selectedTarget,
    selectTarget,
    isGlobalLookup,
    returnToManagement,
    page,
    pageSize,
    total,
    items,
    loading,
    hasLoaded,
    listError,
    filterError,
    search,
    resetFilters,
    changePage,
    changePageSize,
    refresh,
    lookupAccession,
    pendingIds,
    operationError,
    operationMessage,
    toggleEnabled,
    detailVisible,
    detailLoading,
    detailError,
    detailItem,
    detailId,
    openDetail,
    refreshDetail,
    closeDetail
  }
}
