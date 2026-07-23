<script setup>
import StatusTag from '../components/StatusTag.vue'
import { tasks } from '../data/mockData'

defineEmits(['navigate', 'view-task'])

const metrics = [
  {
    label: '项目总数',
    value: 18,
    note: '本月新增 3 个',
    icon: 'FolderOpened',
    color: '#167c6b',
    soft: '#e8f5f2'
  },
  {
    label: '样本总数',
    value: 286,
    note: '本周新增 42 个',
    icon: 'Collection',
    color: '#2563a8',
    soft: '#eaf2fb'
  },
  {
    label: '运行中任务',
    value: 6,
    note: '2 个即将完成',
    icon: 'Loading',
    color: '#b7791f',
    soft: '#fff6df'
  },
  {
    label: '已完成任务',
    value: 241,
    note: '总体成功率 97.6%',
    icon: 'CircleCheck',
    color: '#39885c',
    soft: '#eaf7ef'
  }
]

const activities = [
  { text: '任务 KP-ICU-0719-12 已完成分析', time: '8 分钟前', type: 'success' },
  { text: 'FLU-A-240721-03 等待参考基因组确认', time: '21 分钟前', type: 'warning' },
  { text: '项目“肠道致病菌监测”新增 12 个样本', time: '1 小时前', type: 'primary' },
  { text: '任务 NV-GII-0720-05 在 Reads 比对阶段失败', time: '昨天 18:51', type: 'danger' }
]
</script>

<template>
  <div class="dashboard">
    <div class="welcome">
      <div>
        <p class="eyebrow">2026 年 7 月 21 日 · 星期二</p>
        <h1>下午好，张老师</h1>
        <p class="welcome-copy">系统运行正常，当前有 6 个任务正在分析，其中 1 个需要您确认。</p>
      </div>
      <el-button type="primary" size="large" @click="$emit('navigate', 'new-task')">
        <el-icon><Plus /></el-icon>新建分析任务
      </el-button>
    </div>

    <div class="metric-grid">
      <el-card v-for="item in metrics" :key="item.label" shadow="never" class="metric-card">
        <div class="metric-icon" :style="{ background: item.soft, color: item.color }">
          <el-icon :size="23"><component :is="item.icon" /></el-icon>
        </div>
        <div class="metric-content">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <small>{{ item.note }}</small>
        </div>
      </el-card>
    </div>

    <div class="main-grid">
      <el-card shadow="never" class="tasks-card">
        <template #header>
          <div class="card-header">
            <div>
              <strong>最近分析任务</strong>
              <span>实时查看任务执行状态</span>
            </div>
            <el-button link type="primary" @click="$emit('navigate', 'tasks')"
              >查看全部 <el-icon><ArrowRight /></el-icon
            ></el-button>
          </div>
        </template>
        <el-table
          :data="tasks.slice(0, 5)"
          class="task-table"
          @row-click="(row) => $emit('view-task', row)"
        >
          <el-table-column label="任务 / 样本" min-width="190">
            <template #default="{ row }">
              <div class="task-name">{{ row.name }}</div>
              <div class="task-id">{{ row.id }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="type" label="分析类型" min-width="130" />
          <el-table-column label="状态" width="100"
            ><template #default="{ row }"><StatusTag :status="row.status" /></template
          ></el-table-column>
          <el-table-column label="进度" min-width="155">
            <template #default="{ row }">
              <div class="progress-cell">
                <el-progress :percentage="row.progress" :show-text="false" :stroke-width="6" /><span
                  >{{ row.progress }}%</span
                >
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="创建时间" width="110" />
        </el-table>
      </el-card>

      <el-card shadow="never" class="activity-card">
        <template #header
          ><div class="card-header">
            <div><strong>系统动态</strong><span>任务与项目通知</span></div>
            <el-button text circle
              ><el-icon><More /></el-icon
            ></el-button></div
        ></template>
        <div class="activity-list">
          <div v-for="item in activities" :key="item.text" class="activity-item">
            <span class="activity-dot" :class="item.type"></span>
            <div>
              <p>{{ item.text }}</p>
              <small>{{ item.time }}</small>
            </div>
          </div>
        </div>
        <div class="capacity">
          <div class="capacity-title"><span>计算资源</span><small>4 / 12 核心使用中</small></div>
          <el-progress :percentage="34" :show-text="false" :stroke-width="7" color="#167c6b" />
          <div class="capacity-row"><span>存储空间</span><small>1.28 TB / 4 TB</small></div>
          <el-progress :percentage="32" :show-text="false" :stroke-width="7" color="#5586b7" />
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 108px;
  padding: 10px 4px 26px;
}
.eyebrow {
  margin: 0 0 7px;
  color: #167c6b;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.4px;
}
h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 750;
  color: #152625;
}
.welcome-copy {
  margin: 7px 0 0;
  color: #748380;
  font-size: 14px;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}
.metric-card :deep(.el-card__body) {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px;
}
.metric-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  flex: none;
}
.metric-content {
  display: grid;
  min-width: 0;
}
.metric-content span {
  color: #71807e;
  font-size: 12px;
}
.metric-content strong {
  color: #1d2d2c;
  font-size: 27px;
  line-height: 1.25;
  font-weight: 700;
}
.metric-content small {
  color: #8b9997;
  font-size: 11px;
  white-space: nowrap;
}
.main-grid {
  display: grid;
  grid-template-columns: minmax(650px, 1fr) 310px;
  gap: 18px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-header > div {
  display: grid;
  gap: 2px;
}
.card-header strong {
  font-weight: 650;
  color: #223230;
}
.card-header span {
  color: #8a9896;
  font-size: 11px;
}
.tasks-card :deep(.el-card__body) {
  padding: 0 18px 12px;
}
.task-table {
  cursor: pointer;
}
.task-name {
  font-weight: 600;
  color: #263735;
}
.task-id {
  color: #95a19f;
  font-size: 11px;
}
.progress-cell {
  display: grid;
  grid-template-columns: 1fr 34px;
  align-items: center;
  gap: 8px;
  color: #82908e;
  font-size: 11px;
}
.activity-card :deep(.el-card__body) {
  padding: 8px 20px 19px;
}
.activity-list {
  display: grid;
}
.activity-item {
  position: relative;
  display: grid;
  grid-template-columns: 15px 1fr;
  gap: 9px;
  padding: 13px 0;
  border-bottom: 1px solid #edf1f1;
}
.activity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  background: #7190a8;
}
.activity-dot.success {
  background: #49a36d;
}
.activity-dot.warning {
  background: #d69832;
}
.activity-dot.danger {
  background: #d76363;
}
.activity-dot.primary {
  background: #378e80;
}
.activity-item p {
  margin: 0;
  color: #354442;
  font-size: 12px;
  line-height: 1.45;
}
.activity-item small {
  color: #98a4a2;
  font-size: 10px;
}
.capacity {
  margin-top: 16px;
  padding: 14px;
  border-radius: 9px;
  background: #f5f8f8;
}
.capacity-title,
.capacity-row {
  display: flex;
  justify-content: space-between;
  margin: 0 0 7px;
  color: #52615f;
  font-size: 11px;
}
.capacity-row {
  margin-top: 14px;
}
.capacity small {
  color: #8c9997;
}
@media (max-width: 1200px) {
  .main-grid {
    grid-template-columns: 1fr;
  }
  .activity-card {
    display: none;
  }
  .metric-grid {
    gap: 10px;
  }
  .metric-card :deep(.el-card__body) {
    padding: 16px 13px;
  }
}
</style>
