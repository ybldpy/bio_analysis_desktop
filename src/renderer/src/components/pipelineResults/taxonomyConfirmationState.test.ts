import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AxiosError } from 'axios'
import {
  createTaxonomyConfirmationState,
  getTaxonomyConfirmationAvailability,
  getTaxonomyConfirmationCandidates,
  markTaxonomyConfirmationRefresh,
  reconcileTaxonomyConfirmation,
  submitTaxonomyConfirmation,
  type TaxonomyConfirmationContext
} from './taxonomyConfirmationState'

function context(): TaxonomyConfirmationContext {
  return {
    pipeline: {
      pipelineId: 12,
      pipelineType: 200,
      status: 1,
      analysisPipelineName: '测试任务',
      projectId: 3,
      createTime: new Date('2026-10-21T00:00:00Z')
    },
    stage: {
      stageId: 91,
      stageType: 10,
      stageName: '分类',
      status: 5,
      startTime: null,
      output: {
        urls: null,
        inline: {
          status: 1,
          best: null,
          candidates: [
            { taxid: 123, name: '候选 A' },
            { taxid: 456, name: '候选 B' }
          ]
        }
      }
    },
    refreshVersion: 1,
    refreshing: false
  }
}

function stateFor(ctx: TaxonomyConfirmationContext) {
  const state = createTaxonomyConfirmationState()
  reconcileTaxonomyConfirmation(state, ctx)
  state.selectedTaxId = 123
  return state
}

function savedResponse(downstreamScheduled: boolean, taxId = 123) {
  return {
    status: downstreamScheduled ? 0 : 2,
    data: {
      stageId: 91,
      taxId,
      version: 2,
      alreadyConfirmed: false,
      downstreamScheduled
    },
    failMsg: downstreamScheduled ? null : '调度失败'
  }
}

function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('first confirmation requires the right stage, pipeline, taxonomy status and existing taxid', async () => {
  const ctx = context()
  const state = stateFor(ctx)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canSubmit, true)
  const blocked = [
    { ...ctx, pipeline: { ...ctx.pipeline, status: 2 } },
    { ...ctx, stage: { ...ctx.stage, status: 4 } },
    { ...ctx, stage: { ...ctx.stage, status: 6 } },
    { ...ctx, stage: { ...ctx.stage, stageType: 44 } },
    { ...ctx, refreshing: true }
  ]
  for (const value of blocked) {
    assert.equal(getTaxonomyConfirmationAvailability(state, value).canSubmit, false)
  }
  for (const status of [0, 3, null, undefined, '1']) {
    ctx.stage.output.inline!.status = status
    assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canSubmit, false)
  }
  ctx.stage.output.inline!.status = 2
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canSubmit, true)
  state.selectedTaxId = 999
  let requests = 0
  assert.equal(
    await submitTaxonomyConfirmation(state, ctx, {
      confirm: async () => {
        requests++
        return savedResponse(true)
      },
      refresh: () => {}
    }),
    false
  )
  assert.equal(requests, 0)
  ctx.stage.output.inline!.candidates = [{ taxId: 123 }, { taxid: '123' }, null, { taxid: -1 }]
  assert.deepEqual(getTaxonomyConfirmationCandidates(ctx.stage), [])
  ctx.stage.output.inline!.candidates = [{ taxid: 123 }, { taxid: 123, name: '重复' }]
  assert.equal(getTaxonomyConfirmationCandidates(ctx.stage).length, 1)
})

test('duplicate submissions are locked, only accepted request fields are sent, DTOs stay unchanged', async () => {
  const ctx = context()
  const before = JSON.stringify(ctx)
  const state = stateFor(ctx)
  state.reason = '已核对测试候选'
  const pending = deferred()
  let requests = 0
  let refreshes = 0
  const dependencies = {
    confirm: async (request) => {
      requests++
      assert.deepEqual(request, { stageId: 91, taxId: 123, reason: '已核对测试候选' })
      return pending.promise
    },
    refresh: () => {
      refreshes++
    }
  }
  const first = submitTaxonomyConfirmation(state, ctx, dependencies)
  assert.equal(state.submitting, true)
  assert.equal(await submitTaxonomyConfirmation(state, ctx, dependencies), false)
  pending.resolve(savedResponse(true))
  await first
  assert.equal(requests, 1)
  assert.equal(refreshes, 1)
  assert.equal(state.submitting, false)
  assert.equal(state.phase, 'scheduled')
  assert.equal(state.confirmedTaxId, 123)
  assert.equal(state.needsRefresh, true)
  assert.equal(state.recoveryRequest, null)
  assert.equal(JSON.stringify(ctx), before)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canEdit, false)
})

test('reason length and missing candidates are validated before any request', async () => {
  const ctx = context()
  const state = stateFor(ctx)
  let calls = 0
  const dependencies = {
    confirm: async () => {
      calls++
      return savedResponse(true)
    },
    refresh: () => {}
  }
  state.reason = '字'.repeat(2001)
  assert.equal(await submitTaxonomyConfirmation(state, ctx, dependencies), false)
  state.reason = '字'.repeat(2000)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canSubmit, true)
  state.selectedTaxId = null
  assert.equal(await submitTaxonomyConfirmation(state, ctx, dependencies), false)
  assert.equal(calls, 0)
})

test('business rejection and network failure never become local success; successful refresh is required', async () => {
  for (const outcome of [{ status: 1, data: null, failMsg: '拒绝确认' }, new Error('网络断开')]) {
    const ctx = context()
    const state = stateFor(ctx)
    await submitTaxonomyConfirmation(state, ctx, {
      confirm: async () => {
        if (outcome instanceof Error) throw outcome
        return outcome
      },
      refresh: () => {
        markTaxonomyConfirmationRefresh(state, ctx)
      }
    })
    assert.equal(state.phase, 'uncertain')
    assert.equal(state.confirmedTaxId, null)
    assert.equal(state.needsRefresh, true)
    assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canEdit, false)
    reconcileTaxonomyConfirmation(state, ctx)
    assert.equal(state.needsRefresh, true, 'a failed refresh does not increment the version')
    ctx.refreshVersion++
    reconcileTaxonomyConfirmation(state, ctx)
    assert.equal(state.needsRefresh, false)
    assert.equal(state.phase, 'idle')
    assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canEdit, true)
  }
})

test('an earlier refresh or remount cannot unlock an uncertain response without a later refresh', async () => {
  const ctx = context()
  const state = stateFor(ctx)
  const pending = deferred()
  const submission = submitTaxonomyConfirmation(state, ctx, {
    confirm: async () => pending.promise,
    refresh: () => {} // The component was unmounted before this response.
  })
  ctx.refreshVersion = 2
  reconcileTaxonomyConfirmation(state, ctx)
  pending.resolve({ status: 1, data: null, failMsg: '未知结果' })
  await submission
  reconcileTaxonomyConfirmation(state, ctx)
  assert.equal(state.needsRefresh, true)
  assert.equal(state.refreshAfterVersion, null)
  assert.equal(markTaxonomyConfirmationRefresh(state, ctx), true)
  reconcileTaxonomyConfirmation(state, ctx)
  assert.equal(state.needsRefresh, true)
  ctx.refreshVersion = 3
  reconcileTaxonomyConfirmation(state, ctx)
  assert.equal(state.needsRefresh, false)
})

test('HTTP scheduling failure preserves the exact original request for recovery on a finished stage', async () => {
  const ctx = context()
  const state = stateFor(ctx)
  state.reason = '原始原因'
  const failure = new AxiosError('HTTP 500')
  failure.response = {
    data: savedResponse(false),
    status: 500,
    statusText: 'Error',
    headers: {},
    config: {} as any
  }
  await submitTaxonomyConfirmation(state, ctx, {
    confirm: async () => {
      throw failure
    },
    refresh: () => {
      markTaxonomyConfirmationRefresh(state, ctx)
    }
  })
  assert.equal(state.phase, 'saved')
  assert.equal(state.confirmedTaxId, 123)
  assert.deepEqual(state.recoveryRequest, { stageId: 91, taxId: 123, reason: '原始原因' })
  assert.match(state.notice, /确认已保存/)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canRecover, false)
  ctx.pipeline.status = 2
  ctx.stage.status = 4
  ctx.stage.output.inline = { status: 0, manualConfirmation: { speciesTaxId: 123 } }
  ctx.refreshVersion++
  reconcileTaxonomyConfirmation(state, ctx)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canRecover, true)
  state.selectedTaxId = 456
  state.reason = '修改后的原因不应发送'
  let requestSeen: unknown
  await submitTaxonomyConfirmation(
    state,
    ctx,
    {
      confirm: async (request) => {
        requestSeen = request
        return savedResponse(true)
      },
      refresh: () => {}
    },
    'recovery'
  )
  assert.deepEqual(requestSeen, { stageId: 91, taxId: 123, reason: '原始原因' })
  assert.equal(state.phase, 'scheduled')
  assert.equal(state.recoveryRequest, null)
  assert.equal(ctx.stage.status, 4)
})

test('saved response received under HTTP 200 also allows only fixed-target recovery', async () => {
  const ctx = context()
  const state = stateFor(ctx)
  await submitTaxonomyConfirmation(state, ctx, {
    confirm: async () => savedResponse(false),
    refresh: () => {
      markTaxonomyConfirmationRefresh(state, ctx)
    }
  })
  ctx.refreshVersion++
  reconcileTaxonomyConfirmation(state, ctx)
  assert.equal(state.confirmedTaxId, 123)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canSubmit, false)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canRecover, true)
  ctx.stage.output.inline!.status = 3
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canRecover, false)
})

test('manual audit resolves uncertainty but does not fabricate evidence of scheduling failure', async () => {
  const ctx = context()
  const state = stateFor(ctx)
  await submitTaxonomyConfirmation(state, ctx, {
    confirm: async () => {
      throw new Error('timeout')
    },
    refresh: () => {
      markTaxonomyConfirmationRefresh(state, ctx)
    }
  })
  ctx.refreshVersion++
  ctx.stage.status = 4
  ctx.stage.output.inline = { status: 0, manualConfirmation: { speciesTaxId: 123 } }
  reconcileTaxonomyConfirmation(state, ctx)
  assert.equal(state.needsRefresh, false)
  assert.equal(state.confirmedTaxId, 123)
  assert.equal(state.recoveryRequest, null)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canRecover, false)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canEdit, false)

  const existing = stateFor(ctx)
  assert.equal(existing.phase, 'saved')
  assert.equal(existing.recoveryRequest, null)
})

test('mismatched response IDs or conflicting saved snapshot never authorize recovery', async () => {
  const ctx = context()
  const state = stateFor(ctx)
  await submitTaxonomyConfirmation(state, ctx, {
    confirm: async () => savedResponse(false, 456),
    refresh: () => {
      markTaxonomyConfirmationRefresh(state, ctx)
    }
  })
  assert.equal(state.phase, 'uncertain')
  assert.equal(state.recoveryRequest, null)
  ctx.stage.output.inline!.manualConfirmation = { speciesTaxId: 456 }
  ctx.refreshVersion++
  reconcileTaxonomyConfirmation(state, ctx)
  assert.equal(state.conflict, true)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canEdit, false)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canRecover, false)
})

test('response updates its old stage state after unmount but never affects a new task state', async () => {
  const ctx = context()
  const state = stateFor(ctx)
  const pending = deferred()
  const request = submitTaxonomyConfirmation(state, ctx, {
    confirm: async () => pending.promise,
    refresh: () => {}
  })
  const newContext = context()
  newContext.pipeline.pipelineId = 999
  const newState = stateFor(newContext)
  pending.resolve(savedResponse(false))
  await request
  assert.equal(state.phase, 'saved')
  assert.equal(state.needsRefresh, true)
  assert.equal(newState.phase, 'idle')
  assert.equal(newState.confirmedTaxId, null)
  assert.equal(markTaxonomyConfirmationRefresh(state, newContext), false)
})

test('invalid audit or unreadable snapshot keeps uncertainty locked after refresh', async () => {
  const ctx = context()
  const state = stateFor(ctx)
  await submitTaxonomyConfirmation(state, ctx, {
    confirm: async () => {
      throw new Error('network')
    },
    refresh: () => {
      markTaxonomyConfirmationRefresh(state, ctx)
    }
  })
  ctx.refreshVersion++
  ctx.stage.output.inline!.manualConfirmation = { speciesTaxId: '123' }
  reconcileTaxonomyConfirmation(state, ctx)
  assert.equal(state.needsRefresh, true)
  assert.equal(getTaxonomyConfirmationAvailability(state, ctx).canEdit, false)
  ctx.stage.output.inline = null
  reconcileTaxonomyConfirmation(state, ctx)
  assert.equal(state.needsRefresh, true)
})
