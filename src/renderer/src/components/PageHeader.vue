<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' }
})
</script>

<template>
  <div class="page-header">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div class="page-actions"><slot /></div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}

h1 {
  margin: 0;
  color: #172625;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.4px;
}

p {
  margin: 5px 0 0;
  color: #788785;
  font-size: 13px;
}

.page-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
