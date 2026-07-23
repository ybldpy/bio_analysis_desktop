<script setup>
defineProps({
  status: { type: String, required: true }
})

const typeMap = {
  运行中: 'primary',
  已完成: 'success',
  失败: 'danger',
  需要确认: 'warning',
  等待中: 'info',
  已取消: 'info',
  进行中: 'primary',
  已归档: 'info'
}
</script>

<template>
  <el-tag :type="typeMap[status] || 'info'" effect="light" round>{{ status }}</el-tag>
</template>
