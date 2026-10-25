<script setup lang="ts">
import { computed, onBeforeUnmount, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import type { AnalysisPipelineStage } from '../../common/analysisPipeline'
import { getStageFiles, type StageResultFile } from '../../common/pipelineResults'
import { downloadStageFile } from '../../api/pipelineResults'

const props = defineProps<{ stage: AnalysisPipelineStage; pipelineName: string }>()
const files = computed(() => getStageFiles(props.stage))
const downloading = reactive(new Set<string>())
const errors = reactive(new Map<string, string>())
const controllers = new Map<string, AbortController>()
onBeforeUnmount(() => {
  controllers.forEach((controller) => controller.abort())
})

async function download(file: StageResultFile) {
  if (downloading.has(file.fileKey)) return
  downloading.add(file.fileKey)
  errors.delete(file.fileKey)
  const controller = new AbortController()
  controllers.set(file.fileKey, controller)
  try {
    await downloadStageFile(
      file.fileKey,
      `${props.pipelineName}_${file.fileName}`,
      controller.signal
    )
    if (controller.signal.aborted) return
    // 浏览器保存动作由 Electron/操作系统接管，不把交给保存窗口误报为落盘完成。
    ElMessage.success('文件已获取，请在保存窗口中完成保存')
  } catch (cause) {
    if (!controller.signal.aborted)
      errors.set(file.fileKey, cause instanceof Error ? cause.message : '文件获取失败，请重试')
  } finally {
    controllers.delete(file.fileKey)
    downloading.delete(file.fileKey)
  }
}
</script>

<template>
  <section class="result-files">
    <h3>结果文件</h3>
    <p v-if="files.length" class="file-hint">
      按需获取文件；离开当前阶段会取消尚未完成的下载请求。
    </p>
    <el-table v-if="files.length" :data="files" row-key="key" style="width: 100%">
      <el-table-column prop="label" label="结果" min-width="160" />
      <el-table-column prop="fileName" label="文件名" min-width="180" show-overflow-tooltip />
      <el-table-column label="操作" min-width="160">
        <template #default="{ row }">
          <el-button
            type="primary"
            link
            :loading="downloading.has(row.fileKey)"
            @click="download(row)"
          >
            {{ errors.has(row.fileKey) ? '重试下载' : '下载' }}
          </el-button>
          <el-button
            v-if="downloading.has(row.fileKey)"
            link
            @click="controllers.get(row.fileKey)?.abort()"
            >取消</el-button
          >
          <p v-if="errors.has(row.fileKey)" class="file-error" role="alert">
            {{ errors.get(row.fileKey) }}
          </p>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-else description="当前阶段暂无可下载文件" :image-size="64" />
  </section>
</template>

<style scoped>
.result-files {
  margin-top: 24px;
}
h3 {
  font-size: 15px;
  color: #324b45;
}
.file-error {
  color: #c45656;
  font-size: 12px;
  margin: 4px 0;
  overflow-wrap: anywhere;
}
.file-hint {
  color: #7a8a83;
  font-size: 12px;
}
</style>
