import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import type { TaskUploadRequest } from './taskCreationCommon'

const filename = resolve('src/renderer/src/views/analysisTaskCreation/index.vue')
const parsed = parse(readFileSync(filename, 'utf8'), { filename })
assert.deepEqual(parsed.errors, [])
const compiled = ts.transpileModule(
  compileScript(parsed.descriptor, { id: 'task-list-editing-test' }).content,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }
).outputText

function setup(t: TestContext) {
  const events: unknown[][] = []
  const warnings: string[] = []
  const uploadRequests: TaskUploadRequest[] = []
  let nextFileId = 1
  const realRequire = createRequire(filename)
  const componentModule = { exports: {} as any }
  new Function('require', 'module', 'exports', compiled)(
    (name: string) => {
      // Setup-only tests never mount the page or fetch project/target lists.
      if (name === 'vue') return { ...vue, onBeforeMount() {} }
      if (name === 'element-plus') return {
        ElMessage: { warning: (message: string) => warnings.push(message) },
        genFileId: () => nextFileId++
      }
      if (name === './taskCreationCommon') return {
        setTaskUploadRequest: (request: TaskUploadRequest) => uploadRequests.push(request)
      }
      return realRequire(name)
    },
    componentModule,
    componentModule.exports
  )
  const scope = vue.effectScope()
  const state = scope.run(() => componentModule.exports.default.setup({}, {
    expose() {},
    emit: (...args: unknown[]) => events.push(args)
  }))
  t.after(() => scope.stop())
  return { state, events, warnings, uploadRequests }
}

function file(name: string, relativePath = ''): File {
  // Pairing is filename-only. This fixture deliberately contains no sequence data.
  const selectedFile = new File(['filename fixture only'], name, { type: 'text/plain' })
  Object.defineProperty(selectedFile, 'webkitRelativePath', { value: relativePath })
  return selectedFile
}

function importFiles(state: any, files: File[], fromDirectory = false) {
  const input = {
    files,
    value: 'selected-files',
    hasAttribute: (name: string) => fromDirectory && name === 'webkitdirectory'
  }
  state.importBatchFiles({ target: input } as unknown as Event)
  assert.equal(input.value, '', 'the picker must reset so selecting the same files works again')
}

async function configureBatch(state: any) {
  state.batchNamePrefix.value = 'demo'
  state.analysisTasksBuildJob.projectId = 7
  state.analysisTasksBuildJob.sequencingPlatform = 1002
  state.projectList.value = [{ pid: 7, projectName: '测试项目', description: '' }]
  state.pipelineTypeSelection.typeId = 'bacteria'
  await vue.nextTick()
}

test('the initial page still has one empty task selected at index zero', t => {
  const { state, events, uploadRequests } = setup(t)
  const tasks = state.analysisTasksBuildJob.tasks
  assert.equal(tasks.length, 1)
  assert.equal(state.activeTaskIndex.value, 0)
  assert.equal(state.activeTask.value, tasks[0])
  assert.equal(tasks[0].inputSlots[0].type, 0)
  assert.deepEqual(tasks[0].inputSlots[0].r1, [])
  assert.deepEqual(tasks[0].inputSlots[0].r2, [])
  assert.deepEqual(tasks[0].inputSlots[0].assembly, [])
  assert.deepEqual(events, [])
  assert.deepEqual(uploadRequests, [])
})

test('the last task can be deleted for paired, single-end and assembly input types', t => {
  for (const type of [0, 1, 2]) {
    const { state, warnings } = setup(t)
    state.activeTask.value.inputSlots[0].type = type
    state.removeTask(0)
    assert.equal(state.analysisTasksBuildJob.tasks.length, 0)
    assert.equal(state.activeTaskIndex.value, 0)
    assert.equal(state.activeTask.value, null)
    assert.deepEqual(warnings, [])
  }
})

test('clearing removes tasks and import summary while keeping batch configuration', async t => {
  const { state } = setup(t)
  await configureBatch(state)
  state.addTask()
  state.addTask()
  state.batchImportSummary.value = {
    paired: 1, single: 2, ignored: 0, ambiguous: 0, skippedSubdirectoryFiles: 0
  }
  assert.equal(state.activeTaskIndex.value, 2)
  state.clearTasks()
  assert.equal(state.analysisTasksBuildJob.tasks.length, 0)
  assert.equal(state.activeTaskIndex.value, 0)
  assert.equal(state.activeTask.value, null)
  assert.equal(state.batchImportSummary.value, null)
  assert.equal(state.batchNamePrefix.value, 'demo')
  assert.equal(state.analysisTasksBuildJob.sequencingPlatform, 1002)
  assert.equal(state.analysisTasksBuildJob.projectId, 7)
  assert.equal(state.pipelineTypeSelection.typeId, 'bacteria')
  assert.equal(state.selectedProject.value.pid, 7)
})

test('empty tasks are rejected before prefix validation and cannot advance or submit', async t => {
  const { state, events, uploadRequests, warnings } = setup(t)
  state.clearTasks()
  const emptyCheck = state.doCheckForBuildJobBeforeConfirmation()
  assert.equal(emptyCheck.satisfied, false)
  assert.match(emptyCheck.msg, /至少.*(?:一|1).*任务/)
  await configureBatch(state)
  state.activeSectionId.value = state.sectionMap.taskCreate
  const previousStack = [...state.activeSectionStack]
  state.next()
  assert.equal(state.activeSectionId.value, state.sectionMap.taskCreate)
  assert.deepEqual(state.activeSectionStack, previousStack)
  state.submit()
  assert.equal(warnings.length, 2)
  assert.ok(warnings.every(message => /至少.*(?:一|1).*任务/.test(message)))
  assert.deepEqual(uploadRequests, [])
  assert.deepEqual(events, [])
})

test('adding after clear starts at task 0001 with fresh empty file slots', async t => {
  const { state } = setup(t)
  await configureBatch(state)
  const previousTask = state.activeTask.value
  previousTask.inputSlots[0].r1.push({ name: 'old.fastq', raw: file('old.fastq') })
  state.clearTasks()
  state.addTask()
  assert.equal(state.analysisTasksBuildJob.tasks.length, 1)
  assert.equal(state.activeTaskIndex.value, 0)
  assert.equal(state.activeTask.value.name, 'demo-0001')
  assert.notEqual(state.activeTask.value, previousTask)
  assert.deepEqual(state.activeTask.value.inputSlots[0].r1, [])
  assert.deepEqual(state.activeTask.value.inputSlots[0].r2, [])
  assert.deepEqual(state.activeTask.value.inputSlots[0].assembly, [])
})

test('multi-file import rebuilds a cleared list without adding a placeholder task', async t => {
  const { state } = setup(t)
  await configureBatch(state)
  state.clearTasks()
  const r1 = file('sample_R1.fastq')
  const r2 = file('sample_R2.fastq')
  const single = file('single.fastq')
  importFiles(state, [single, r2, r1])
  const tasks = state.analysisTasksBuildJob.tasks
  assert.equal(tasks.length, 2)
  assert.deepEqual(tasks.map(task => task.name), ['demo-0001', 'demo-0002'])
  assert.equal(state.activeTaskIndex.value, 0)
  assert.equal(state.activeTask.value, tasks[0])
  assert.equal(tasks[0].inputSlots[0].type, 0)
  assert.equal(tasks[0].inputSlots[0].r1[0].raw, r1)
  assert.equal(tasks[0].inputSlots[0].r2[0].raw, r2)
  assert.equal(tasks[1].inputSlots[0].type, 1)
  assert.equal(tasks[1].inputSlots[0].r1[0].raw, single)
  assert.equal(state.batchImportSummary.value.paired, 1)
  assert.equal(state.batchImportSummary.value.single, 1)
  assert.equal(state.batchImportSummary.value.skippedSubdirectoryFiles, 0)
})

test('directory import after clear only rebuilds tasks from direct files, never descendants', async t => {
  const { state } = setup(t)
  await configureBatch(state)
  state.clearTasks()
  const r1 = file('direct_R1.fastq', 'picked/direct_R1.fastq')
  const r2 = file('direct_R2.fastq', 'picked/direct_R2.fastq')
  importFiles(state, [
    r2,
    file('nested_R1.fastq', 'picked/sub/nested_R1.fastq'),
    file('nested_R2.fastq', 'picked/sub/nested_R2.fastq'),
    file('notes.txt', 'picked/notes.txt'),
    r1
  ], true)
  assert.equal(state.analysisTasksBuildJob.tasks.length, 1)
  assert.equal(state.activeTaskIndex.value, 0)
  assert.equal(state.activeTask.value.name, 'demo-0001')
  assert.equal(state.activeTask.value.inputSlots[0].r1[0].raw, r1)
  assert.equal(state.activeTask.value.inputSlots[0].r2[0].raw, r2)
  assert.deepEqual(state.batchImportSummary.value, {
    paired: 1, single: 0, ignored: 1, ambiguous: 0, skippedSubdirectoryFiles: 2
  })
})

test('importing only subdirectory files keeps the cleared list empty', async t => {
  const { state, warnings } = setup(t)
  await configureBatch(state)
  state.clearTasks()
  importFiles(state, [
    file('sample_R1.fastq', 'picked/sub/sample_R1.fastq'),
    file('sample_R2.fastq', 'picked/sub/sample_R2.fastq')
  ], true)
  assert.equal(state.analysisTasksBuildJob.tasks.length, 0)
  assert.equal(state.activeTask.value, null)
  assert.equal(state.activeTaskIndex.value, 0)
  assert.equal(state.batchImportSummary.value.skippedSubdirectoryFiles, 2)
  assert.match(warnings.at(-1)!, /当前目录没有可导入/)
  assert.equal(state.batchNamePrefix.value, 'demo')
})

test('deleting a task before the selection preserves the selected task object', async t => {
  const { state } = setup(t)
  await configureBatch(state)
  state.addTask()
  state.addTask()
  state.activeTaskIndex.value = 1
  const selectedTask = state.activeTask.value
  state.removeTask(0)
  assert.equal(state.analysisTasksBuildJob.tasks.length, 2)
  assert.equal(state.activeTaskIndex.value, 0)
  assert.equal(state.activeTask.value, selectedTask)
  assert.equal(selectedTask.name, 'demo-0001')
  state.removeTask(1)
  assert.equal(state.activeTask.value, selectedTask)
  assert.equal(state.activeTaskIndex.value, 0)
})

test('submit revalidates remaining files and can submit a rebuilt valid single task', async t => {
  const { state, uploadRequests, events, warnings } = setup(t)
  await configureBatch(state)
  state.clearTasks()
  state.addTask()
  state.submit()
  assert.equal(uploadRequests.length, 0)
  assert.deepEqual(events, [])
  assert.match(warnings.at(-1)!, /缺少文件/)

  const raw = file('single.fastq')
  state.activeTask.value.inputSlots[0].type = 1
  state.activeTask.value.inputSlots[0].r1.push({ name: raw.name, raw })
  state.submit()
  assert.equal(uploadRequests.length, 1)
  assert.equal(uploadRequests[0].tasks.length, 1)
  assert.equal(uploadRequests[0].tasks[0].name, 'demo-0001')
  assert.equal(uploadRequests[0].tasks[0].sequencingPlatform, 1002)
  assert.equal(uploadRequests[0].tasks[0].inputSlots[0].r1, raw)
  assert.equal(uploadRequests[0].tasks[0].type, 1)
  assert.deepEqual(events, [['upload']])
})
