<script setup>
defineProps({
  status: { type: String, required: true }
})

const typeMap = {
  running: {
    class: 'primary',
    label: '运行中'
  },
  completed: {
    class: 'success',
    label: '已完成'
  },
  failed: {
    class: 'danger',
    label: '失败'
  },
  actionRequired: {
    class: 'warning',
    label: '需要确认'
  },
  pending: {
    class: 'info',
    label: '等待中'
  },
  cancalled: {
    class: 'info',
    label: '已取消'
  }
}
</script>

<template>
  <el-tag :type="typeMap[status]?.class || 'info'" effect="light" round>
    {{ typeMap[status]?.label || status }}
  </el-tag>
</template>
