<script setup>
import { computed, ref } from 'vue'
import StatusTag from '../components/StatusTag.vue'
import { pipelineNodes, resultFiles } from '../data/mockData'

defineProps({ task: { type: Object, required: true } })
const emit = defineEmits(['back'])
const activeTab = ref('pipeline')
const selectedNodeId = ref('species')
const logVisible = ref(false)
const selectedNode = computed(() => pipelineNodes.find((item) => item.id === selectedNodeId.value))

const statusMeta = {
  completed: { label: '已完成', icon: 'Check', class: 'completed' },
  running: { label: '运行中', icon: 'Loading', class: 'running' },
  pending: { label: '等待中', icon: 'Clock', class: 'pending' },
  failed: { label: '失败', icon: 'Close', class: 'failed' },
  confirm: { label: '需要确认', icon: 'Warning', class: 'confirm' }
}

const node = (id) => pipelineNodes.find((item) => item.id === id)
</script>

<template>
  <div class="detail-page">
    <div class="detail-header">
      <el-button text class="back" @click="emit('back')"
        ><el-icon><ArrowLeft /></el-icon>返回任务列表</el-button
      >
      <div class="title-row">
        <div>
          <div class="title-line">
            <h1>{{ task.name }}</h1>
            <StatusTag :status="task.status" />
          </div>
          <p>{{ task.id }} · {{ task.project }}</p>
        </div>
        <div class="actions">
          <el-button @click="logVisible = true"
            ><el-icon><Document /></el-icon>运行日志</el-button
          ><el-button
            ><el-icon><Download /></el-icon>下载结果</el-button
          ><el-button type="primary"
            ><el-icon><DocumentChecked /></el-icon>查看报告</el-button
          >
        </div>
      </div>
      <div class="summary-strip">
        <div>
          <span>分析类型</span><strong>{{ task.type }}</strong>
        </div>
        <div>
          <span>样本编号</span><strong>{{ task.sample }}</strong>
        </div>
        <div>
          <span>输入数据</span><strong>{{ task.input }}</strong>
        </div>
        <div>
          <span>创建时间</span><strong>{{ task.createdAt }}</strong>
        </div>
        <div>
          <span>运行时长</span><strong>{{ task.duration }}</strong>
        </div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="detail-tabs">
      <el-tab-pane label="分析流水线" name="pipeline">
        <div class="pipeline-layout">
          <el-card shadow="never" class="pipeline-card">
            <template #header
              ><div class="panel-header">
                <div>
                  <strong>细菌全基因组分析流程</strong
                  ><small>节点状态实时更新 · 当前总体进度 {{ task.progress }}%</small>
                </div>
                <div class="legend">
                  <span><i class="done"></i>已完成</span><span><i class="run"></i>运行中</span
                  ><span><i></i>等待中</span>
                </div>
              </div></template
            >
            <div class="pipeline-canvas">
              <div class="flow-row main-flow">
                <button
                  v-for="id in ['preprocess', 'qc', 'assembly', 'species']"
                  :key="id"
                  :class="[
                    'node',
                    statusMeta[node(id).status].class,
                    { selected: selectedNodeId === id }
                  ]"
                  @click="selectedNodeId = id"
                >
                  <span class="node-icon"
                    ><el-icon><component :is="statusMeta[node(id).status].icon" /></el-icon></span
                  ><span class="node-text"
                    ><strong>{{ node(id).name }}</strong
                    ><small>{{ statusMeta[node(id).status].label }}</small></span
                  >
                </button>
              </div>
              <div class="branch-line one"></div>
              <div class="flow-row branch-flow first">
                <button
                  v-for="id in ['amr', 'virulence', 'mlst']"
                  :key="id"
                  :class="[
                    'node',
                    statusMeta[node(id).status].class,
                    { selected: selectedNodeId === id }
                  ]"
                  @click="selectedNodeId = id"
                >
                  <span class="node-icon"
                    ><el-icon><component :is="statusMeta[node(id).status].icon" /></el-icon></span
                  ><span class="node-text"
                    ><strong>{{ node(id).name }}</strong
                    ><small>{{ statusMeta[node(id).status].label }}</small></span
                  >
                </button>
              </div>
              <div class="branch-line two"></div>
              <div class="flow-row branch-flow second">
                <button
                  v-for="id in ['cgmlst', 'serotype']"
                  :key="id"
                  :class="[
                    'node',
                    statusMeta[node(id).status].class,
                    { selected: selectedNodeId === id }
                  ]"
                  @click="selectedNodeId = id"
                >
                  <span class="node-icon"
                    ><el-icon><component :is="statusMeta[node(id).status].icon" /></el-icon></span
                  ><span class="node-text"
                    ><strong>{{ node(id).name }}</strong
                    ><small>{{ statusMeta[node(id).status].label }}</small></span
                  >
                </button>
                <button
                  :class="[
                    'node',
                    statusMeta[node('report').status].class,
                    { selected: selectedNodeId === 'report' }
                  ]"
                  @click="selectedNodeId = 'report'"
                >
                  <span class="node-icon"
                    ><el-icon><Document /></el-icon></span
                  ><span class="node-text"><strong>报告生成</strong><small>等待中</small></span>
                </button>
              </div>
            </div>
          </el-card>

          <el-card shadow="never" class="node-detail">
            <template #header
              ><div class="node-heading">
                <span :class="['big-status', statusMeta[selectedNode.status].class]"
                  ><el-icon><component :is="statusMeta[selectedNode.status].icon" /></el-icon
                ></span>
                <div>
                  <strong>{{ selectedNode.name }}</strong
                  ><small>{{ statusMeta[selectedNode.status].label }}</small>
                </div>
              </div></template
            >
            <div class="node-body">
              <div class="detail-pair">
                <span>执行状态</span><strong>{{ statusMeta[selectedNode.status].label }}</strong>
              </div>
              <div class="detail-pair">
                <span>运行耗时</span><strong>{{ selectedNode.duration }}</strong>
              </div>
              <el-divider />
              <h3>阶段摘要</h3>
              <p>{{ selectedNode.summary }}</p>
              <h3>输出文件</h3>
              <div class="output-file">
                <el-icon><Document /></el-icon><span>{{ selectedNode.output }}</span
                ><el-button v-if="selectedNode.output !== '--'" link type="primary"
                  ><el-icon><Download /></el-icon
                ></el-button>
              </div>
              <el-button class="full-button" @click="logVisible = true"
                ><el-icon><Document /></el-icon>查看阶段日志</el-button
              >
            </div>
          </el-card>
        </div>
        <el-card shadow="never" class="run-info"
          ><div class="run-status">
            <span class="pulse"></span>
            <div>
              <strong>正在执行：物种鉴定</strong
              ><small>正在使用 Kraken2 进行分类初筛，完成后将进入 ANI 物种确认。</small>
            </div>
          </div>
          <div class="run-progress">
            <span>预计剩余 4 分钟</span><el-progress :percentage="68" :stroke-width="7" /></div
        ></el-card>
      </el-tab-pane>

      <el-tab-pane label="样本信息" name="sample"
        ><el-card shadow="never"
          ><el-descriptions :column="3" border
            ><el-descriptions-item label="样本编号">{{ task.sample }}</el-descriptions-item
            ><el-descriptions-item label="任务编号">{{ task.id }}</el-descriptions-item
            ><el-descriptions-item label="所属项目">{{ task.project }}</el-descriptions-item
            ><el-descriptions-item label="数据类型">{{ task.input }}</el-descriptions-item
            ><el-descriptions-item label="分析流程">{{ task.type }}</el-descriptions-item
            ><el-descriptions-item label="创建人">张老师</el-descriptions-item></el-descriptions
          ></el-card
        ></el-tab-pane
      >
      <el-tab-pane label="结果文件" name="files"
        ><el-card shadow="never"
          ><el-table :data="resultFiles"
            ><el-table-column prop="name" label="文件名" min-width="240" /><el-table-column
              prop="stage"
              label="分析阶段"
            /><el-table-column prop="type" label="格式" /><el-table-column
              prop="size"
              label="大小"
            /><el-table-column prop="updatedAt" label="生成时间" /><el-table-column label="操作"
              ><template #default
                ><el-button link type="primary">下载</el-button></template
              ></el-table-column
            ></el-table
          ></el-card
        ></el-tab-pane
      >
      <el-tab-pane label="确认记录" name="records"
        ><el-empty description="暂无用户确认记录"
      /></el-tab-pane>
    </el-tabs>

    <el-drawer v-model="logVisible" title="运行日志" size="560px"
      ><div class="log-toolbar">
        <el-tag type="success">实时更新</el-tag
        ><el-button text
          ><el-icon><Download /></el-icon>下载完整日志</el-button
        >
      </div>
      <pre class="log-output">
[14:32:06] INFO  Task TASK-0721-008 started
[14:32:08] INFO  Input pair validation passed
[14:34:24] INFO  Preprocess completed successfully
[14:43:06] INFO  Quality control completed · Q30=94.7%
[14:54:11] INFO  Assembly completed · N50=186420
[14:54:18] INFO  Starting Kraken2 classification
[14:55:42] INFO  Loading database taxonomy...
[14:56:03] INFO  Processing contigs.fasta
_</pre>
    </el-drawer>
  </div>
</template>

<style scoped>
.detail-page {
  max-width: 1280px;
  margin: 0 auto;
}
.detail-header {
  margin-bottom: 7px;
}
.back {
  margin: -8px 0 9px -12px;
  color: #71817e;
}
.title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 11px;
}
.title-line h1 {
  margin: 0;
  color: #1f302e;
  font-size: 23px;
  font-weight: 700;
}
.title-row p {
  margin: 4px 0 0;
  color: #899693;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 8px;
}
.summary-strip {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1fr 1fr;
  margin-top: 19px;
  padding: 14px 18px;
  border: 1px solid #e3eae9;
  border-radius: 10px;
  background: #fff;
}
.summary-strip > div {
  display: grid;
  gap: 3px;
  padding: 0 16px;
  border-right: 1px solid #e8edec;
}
.summary-strip > div:first-child {
  padding-left: 0;
}
.summary-strip > div:last-child {
  border: 0;
}
.summary-strip span {
  color: #8b9895;
  font-size: 10px;
}
.summary-strip strong {
  color: #394947;
  font-size: 12px;
  font-weight: 600;
}
.detail-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}
.pipeline-layout {
  display: grid;
  grid-template-columns: minmax(680px, 1fr) 270px;
  gap: 16px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-header > div:first-child {
  display: grid;
}
.panel-header strong {
  font-weight: 650;
}
.panel-header small {
  color: #8c9896;
  font-size: 10px;
}
.legend {
  display: flex;
  gap: 13px;
  color: #85928f;
  font-size: 10px;
}
.legend span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #b3bfbd;
}
.legend .done {
  background: #47a16a;
}
.legend .run {
  background: #2b8e7d;
}
.pipeline-card :deep(.el-card__body) {
  padding: 14px;
}
.pipeline-canvas {
  position: relative;
  min-height: 410px;
  padding: 20px 12px;
  background-color: #fafcfc;
  background-image: radial-gradient(#dfe7e5 1px, transparent 1px);
  background-size: 18px 18px;
  border-radius: 8px;
  overflow: auto;
}
.flow-row {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 34px;
}
.main-flow {
  justify-content: center;
}
.main-flow .node:not(:last-child)::after,
.branch-flow .node:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 100%;
  top: 50%;
  width: 35px;
  height: 1px;
  background: #cbd6d4;
}
.main-flow .node:not(:last-child)::before,
.branch-flow .node:not(:last-child)::before {
  content: '';
  position: absolute;
  left: calc(100% + 28px);
  top: calc(50% - 3px);
  width: 6px;
  height: 6px;
  border-top: 1px solid #aebdba;
  border-right: 1px solid #aebdba;
  transform: rotate(45deg);
}
.node {
  position: relative;
  width: 135px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px;
  border: 1px solid #dce5e3;
  border-radius: 9px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 3px 8px rgba(46, 72, 68, 0.04);
}
.node:hover,
.node.selected {
  border-color: #54a698;
  box-shadow: 0 0 0 2px rgba(22, 124, 107, 0.1);
}
.node-icon {
  width: 29px;
  height: 29px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 50%;
  background: #eff3f2;
  color: #879592;
}
.node-text {
  display: grid;
}
.node-text strong {
  font-size: 11px;
  font-weight: 650;
  color: #3a4947;
}
.node-text small {
  font-size: 9px;
  color: #919e9b;
}
.node.completed .node-icon {
  color: #fff;
  background: #49a46e;
}
.node.running .node-icon {
  color: #fff;
  background: #218e7c;
}
.node.running {
  border-color: #58a99b;
  background: #f2faf8;
}
.node.running .node-icon :deep(svg) {
  animation: spin 1.2s linear infinite;
}
.branch-line {
  position: absolute;
  z-index: 1;
  border-left: 1px solid #cbd6d4;
  border-bottom: 1px solid #cbd6d4;
}
.branch-line.one {
  top: 81px;
  left: 52%;
  width: 190px;
  height: 94px;
}
.branch-line.two {
  top: 81px;
  left: 52%;
  width: 115px;
  height: 207px;
}
.branch-flow {
  margin-top: 71px;
  justify-content: flex-end;
  padding-right: 38px;
}
.branch-flow.second {
  margin-top: 72px;
}
.branch-flow.second .node:last-child {
  margin-left: 64px;
}
.node-detail :deep(.el-card__header) {
  padding: 16px;
}
.node-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.big-status {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #9ca9a7;
}
.big-status.completed {
  background: #49a46e;
}
.big-status.running {
  background: #218e7c;
}
.node-heading > div {
  display: grid;
}
.node-heading strong {
  font-size: 14px;
  font-weight: 650;
}
.node-heading small {
  color: #2a8e7d;
  font-size: 10px;
}
.node-detail :deep(.el-card__body) {
  padding: 0;
}
.node-body {
  padding: 17px;
}
.detail-pair {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  color: #83918e;
  font-size: 11px;
}
.detail-pair strong {
  color: #3b4b48;
  font-weight: 600;
}
.node-body h3 {
  margin: 15px 0 7px;
  color: #465552;
  font-size: 11px;
  font-weight: 650;
}
.node-body p {
  margin: 0;
  padding: 10px;
  border-radius: 7px;
  background: #f5f8f7;
  color: #657471;
  font-size: 11px;
  line-height: 1.5;
}
.output-file {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px;
  border: 1px solid #e4eae9;
  border-radius: 7px;
  color: #60706d;
  font-size: 10px;
}
.output-file span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.full-button {
  width: 100%;
  margin-top: 18px;
}
.run-info {
  margin-top: 15px;
}
.run-info :deep(.el-card__body) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
}
.run-status {
  display: flex;
  align-items: center;
  gap: 11px;
}
.pulse {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #208e7c;
  box-shadow: 0 0 0 5px #dff0ed;
}
.run-status > div {
  display: grid;
}
.run-status strong {
  font-size: 12px;
  font-weight: 650;
}
.run-status small {
  color: #83918e;
  font-size: 10px;
}
.run-progress {
  width: 280px;
  color: #83918e;
  font-size: 10px;
}
.log-toolbar {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}
.log-output {
  min-height: 560px;
  margin: 0;
  padding: 18px;
  border-radius: 8px;
  background: #14201f;
  color: #b8d6d0;
  font:
    11px/1.8 Consolas,
    monospace;
  white-space: pre-wrap;
}
.detail-tabs :deep(.el-empty) {
  padding-top: 100px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1200px) {
  .pipeline-layout {
    grid-template-columns: 1fr;
  }
  .node-detail {
    display: none;
  }
}
</style>
