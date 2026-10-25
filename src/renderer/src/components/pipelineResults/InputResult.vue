<script setup lang="ts">
import { computed } from 'vue'
import type { AnalysisPipelineStage } from '../../common/analysisPipeline'
import { asRecord } from '../../common/pipelineResults'
import { displayCode, hasText } from './inlineResultPresentation'

const props = defineProps<{ stage: AnalysisPipelineStage }>()
const output = computed(() => asRecord(props.stage.output.urls))
const meta = computed(() => asRecord(output.value?.readMeta))
const parseError = computed(() => props.stage.output.parseErrors?.urls)

const platform = computed(() =>
  displayCode(
    meta.value?.sequencingPlatform,
    { 0: '未知平台（0）', 1001: 'Illumina', 1002: 'BGI/MGI', 2001: 'ONT', 2002: 'PacBio' },
    '未知平台'
  )
)
const layout = computed(() => {
  const r1 = hasText(output.value?.r1Url)
  const r2 = hasText(output.value?.r2Url)
  if (r1 && r2) return '双端（R1 + R2）'
  if (r1) {
    return meta.value?.sequenceLevel === 1 || meta.value?.sequenceLevel === 2
      ? '单文件（R1）'
      : '单端（R1）'
  }
  if (r2) return '布局不完整（仅 R2）'
  return '未提供'
})
</script>

<template>
  <el-card shadow="never" class="input-result">
    <template #header>输入信息</template>
    <el-alert
      v-if="parseError"
      title="输入结果解析失败"
      :description="parseError"
      type="error"
      :closable="false"
      show-icon
    />
    <el-empty v-else-if="!output" description="暂无输入检查结果" :image-size="64" />
    <template v-else>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="测序平台">{{ platform }}</el-descriptions-item>
        <el-descriptions-item label="读长类型">
          {{ displayCode(meta?.readLenType, { 0: '短读', 1: '长读' }) }}
        </el-descriptions-item>
        <el-descriptions-item label="质量编码">
          {{ displayCode(meta?.qualityEncoding, { 0: 'Phred+33', 1: 'Phred+64' }) }}
        </el-descriptions-item>
        <el-descriptions-item label="序列层级">
          {{
            displayCode(meta?.sequenceLevel, {
              '-1': '未知（-1）',
              0: 'Reads',
              1: 'Assembly',
              2: 'Reference'
            })
          }}
        </el-descriptions-item>
        <el-descriptions-item label="规范化输入布局">{{ layout }}</el-descriptions-item>
      </el-descriptions>
      <p class="result-note">
        布局依据检查结果中的 R1/R2 文件字段。Reads 数量和质量统计请查看 QC 报告。
      </p>
    </template>
  </el-card>
</template>

<style scoped>
.input-result {
  min-width: 0;
}
.result-note {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
</style>
