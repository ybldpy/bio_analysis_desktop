<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import DashboardView from './views/DashboardView.vue'
import ProjectsView from './views/ProjectsView.vue'
import TasksView from './views/TasksView.vue'
import NewTaskView from './views/analysisTaskCreation/index.vue'
import TaskUploadView from './views/analysisTaskCreation/TaskUpload.vue'
import TaskDetailView from './views/TaskDetailView.vue'
import TaskResultsView from './views/TaskResultsView.vue'
import ResultsView from './views/ResultsView.vue'
import ReferenceLibraryView from './views/ReferenceLibraryView.vue'

const activePage = ref('dashboard')
const previousPage = ref('tasks')
const collapsed = ref(false)
const selectedPipelineId = ref<number | null>(null)
const selectedResultStageId = ref<number | undefined>()
const taskDetailOrigin = ref('tasks')
const referenceNavigationLocked = ref(false)

const menuGroups = [
  {
    label: '工作台',
    items: [
      { id: 'dashboard', label: '首页概览', icon: 'House' },
      { id: 'projects', label: '项目管理', icon: 'FolderOpened' },
      { id: 'tasks', label: '任务管理', icon: 'List' }
      // { id: 'results', label: '结果中心', icon: 'DataAnalysis' }
    ]
  },
  {
    label: '资源',
    items: [
      { id: 'references', label: '参考序列库', icon: 'Coin' }
    ]
  }
]

const pageTitle = computed(() => {
  const item = menuGroups
    .flatMap((group) => group.items)
    .find((menu) => menu.id === activePage.value)
  if (activePage.value === 'new-task') return '新建分析任务'
  if (activePage.value === 'task-upload') return '上传任务数据'
  if (activePage.value === 'task-detail') return '任务详情'
  if (activePage.value === 'task-results') return '任务结果'
  return item?.label || '页面'
})

const currentComponent = computed(
  () =>
    ({
      dashboard: DashboardView,
      projects: ProjectsView,
      tasks: TasksView,
      'new-task': NewTaskView,
      'task-upload': TaskUploadView,
      'task-detail': TaskDetailView,
      'task-results': TaskResultsView,
      results: ResultsView,
      references: ReferenceLibraryView
    })[activePage.value]
)

function navigate(page) {
  if (activePage.value === 'references' && page !== 'references' && referenceNavigationLocked.value) {
    ElMessage.warning('参考上传正在进行或结果待核实，请先在参考序列库页面完成处理再离开')
    return
  }
  if (page === 'downloads') {
    ElMessage.info('该模块将在后续版本接入')
    return
  }
  previousPage.value = activePage.value
  activePage.value = page
}



const currentComponentProps = computed(() => {
  if (activePage.value === 'task-detail' || activePage.value === 'task-results') {
    return {
      pipelineId: selectedPipelineId.value,
      ...(activePage.value === 'task-results' ? { stageId: selectedResultStageId.value } : {})
    }
  }
  return {}
})

function viewTask(pipelineId: number) {
  if (!Number.isInteger(pipelineId) || pipelineId <= 0) {
    ElMessage.error('任务编号无效')
    return
  }
  if (!['task-detail', 'task-results'].includes(activePage.value)) taskDetailOrigin.value = activePage.value
  selectedPipelineId.value = pipelineId
  activePage.value = 'task-detail'
}

function viewTaskResults(target: { pipelineId: number; stageId?: number }) {
  if (!Number.isInteger(target.pipelineId) || target.pipelineId <= 0) {
    ElMessage.error('任务编号无效')
    return
  }
  if (!['task-detail', 'task-results'].includes(activePage.value)) taskDetailOrigin.value = activePage.value
  selectedPipelineId.value = target.pipelineId
  selectedResultStageId.value = target.stageId
  activePage.value = 'task-results'
}

function handleBack() {
  if (activePage.value === 'task-results') {
    activePage.value = 'task-detail'
    return
  }
  if (activePage.value === 'task-detail') {
    activePage.value = taskDetailOrigin.value
    return
  }
  activePage.value = previousPage.value === 'task-detail' ? 'tasks' : previousPage.value
}
</script>

<template>
  <div class="app-shell">
    <aside :class="['sidebar', { collapsed }]">
      <div class="brand">
        <div class="brand-mark">
          <span class="helix one"></span><span class="helix two"></span><i></i>
        </div>
        <div v-if="!collapsed" class="brand-text">
          <strong>BioScope</strong><span>微生物基因组分析</span>
        </div>
      </div>

      <nav>
        <div v-for="group in menuGroups" :key="group.label" class="menu-group">
          <div v-if="!collapsed" class="group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.id"
            :title="item.label"
            :class="[
              'menu-item',
              {
                active:
                  activePage === item.id ||
                  (item.id === 'tasks' && ['new-task', 'task-upload', 'task-detail', 'task-results'].includes(activePage))
              }
            ]"
            @click="navigate(item.id)"
          >
            <el-icon :size="18"><component :is="item.icon" /></el-icon
            ><span v-if="!collapsed">{{ item.label }}</span>
            <b v-if="!collapsed && item.id === 'tasks'">6</b>
          </button>
        </div>
      </nav>

      <div class="sidebar-bottom">
        <button class="menu-item" title="系统设置">
          <el-icon :size="18"><Setting /></el-icon><span v-if="!collapsed">系统设置</span>
        </button>
        <div class="user-card">
          <el-avatar :size="34" class="avatar">张</el-avatar>
          <div v-if="!collapsed" class="user-info">
            <strong>张老师</strong><span>系统管理员</span>
          </div>
          <el-dropdown v-if="!collapsed" trigger="click"
            ><el-button text circle
              ><el-icon><MoreFilled /></el-icon></el-button
            ><template #dropdown
              ><el-dropdown-menu
                ><el-dropdown-item>个人设置</el-dropdown-item
                ><el-dropdown-item>切换账号</el-dropdown-item
                ><el-dropdown-item divided>退出登录</el-dropdown-item></el-dropdown-menu
              ></template
            ></el-dropdown
          >
        </div>
      </div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div class="topbar-left">
          <button class="collapse-button" @click="collapsed = !collapsed">
            <el-icon><Fold v-if="!collapsed" /><Expand v-else /></el-icon>
          </button>
          <el-breadcrumb separator="/"
            ><el-breadcrumb-item>微生物全基因组分析</el-breadcrumb-item
            ><el-breadcrumb-item>{{ pageTitle }}</el-breadcrumb-item></el-breadcrumb
          >
        </div>
        <div class="topbar-right">
          <!-- <div class="system-health"><span></span>系统运行正常</div>
          <el-tooltip content="搜索任务、样本或项目"
            ><button class="top-icon">
              <el-icon><Search /></el-icon></button
          ></el-tooltip> -->
          <!-- <el-popover
            v-model:visible="notificationsVisible"
            placement="bottom-end"
            :width="340"
            trigger="click"
          >
            <template #reference
              ><el-badge :value="2" class="notification-badge"
                ><button class="top-icon">
                  <el-icon><Bell /></el-icon></button></el-badge
            ></template>
            <div class="popover-title">
              <strong>通知</strong><el-button link type="primary">全部已读</el-button>
            </div>
            <div class="notice">
              <span class="notice-icon warning"
                ><el-icon><Warning /></el-icon
              ></span>
              <div>
                <strong>任务需要确认</strong>
                <p>FLU-A-240721-03 等待选择参考基因组</p>
                <small>21 分钟前</small>
              </div>
            </div>
            <div class="notice">
              <span class="notice-icon success"
                ><el-icon><Check /></el-icon
              ></span>
              <div>
                <strong>分析已完成</strong>
                <p>KP-ICU-0719-12 的分析报告已生成</p>
                <small>8 分钟前</small>
              </div>
            </div>
          </el-popover> -->
          <el-divider direction="vertical" />
          <el-button class="quick-create" type="primary" @click="navigate('new-task')"
            ><el-icon><Plus /></el-icon>新建任务</el-button
          >
        </div>
      </header>

      <main class="content-area">
        <Transition name="page" mode="out-in">
          <component
            :is="currentComponent"
            :key="['task-detail', 'task-results'].includes(activePage) ? `${activePage}:${selectedPipelineId}` : activePage"
            v-bind="currentComponentProps"
            @navigate="navigate"
            @navigation-lock="referenceNavigationLocked = $event"
            @view-task="viewTask"
            @view-results="viewTaskResults"
            @cancel="handleBack"
            @upload="navigate('task-upload')"
            @submitted="navigate('tasks')"
            @back="handleBack"
          />
        </Transition>
      </main>
    </section>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  background: #f3f6f6;
  color: #1f302e;
}
.sidebar {
  position: relative;
  width: 224px;
  display: flex;
  flex-direction: column;
  flex: none;
  background: #102f2d;
  color: #d7e6e3;
  transition: width 0.2s ease;
  z-index: 2;
}
.sidebar.collapsed {
  width: 70px;
}
.brand {
  height: 70px;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 19px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.brand-mark {
  position: relative;
  width: 33px;
  height: 33px;
  flex: none;
  border-radius: 9px;
  background: linear-gradient(145deg, #31a28d, #187263);
  overflow: hidden;
}
.brand-mark .helix {
  position: absolute;
  left: 8px;
  width: 17px;
  height: 1px;
  background: #dff7f2;
  transform: rotate(37deg);
}
.brand-mark .one {
  top: 11px;
  box-shadow: 0 10px 0 #dff7f2;
}
.brand-mark .two {
  top: 16px;
  transform: rotate(-37deg);
}
.brand-mark i {
  position: absolute;
  left: 10px;
  top: 6px;
  width: 13px;
  height: 21px;
  border-left: 2px solid #dff7f2;
  border-right: 2px solid #dff7f2;
  border-radius: 50%;
  transform: rotate(10deg);
}
.brand-text {
  display: grid;
  white-space: nowrap;
}
.brand-text strong {
  color: #fff;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.brand-text span {
  color: #82aaa4;
  font-size: 9px;
  letter-spacing: 0.5px;
}
nav {
  flex: 1;
  padding: 15px 10px;
}
.menu-group {
  margin-bottom: 18px;
}
.group-label {
  padding: 0 11px 7px;
  color: #668c87;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.2px;
}
.menu-item {
  width: 100%;
  height: 42px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 3px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #9fc0bb;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: 0.15s;
}
.menu-item:hover {
  color: #eef8f6;
  background: rgba(255, 255, 255, 0.06);
}
.menu-item.active {
  color: #fff;
  background: #1c665b;
  box-shadow: inset 3px 0 0 #62c5b4;
}
.menu-item span {
  flex: 1;
  font-size: 12px;
}
.menu-item b {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 9px;
  background: #d49339;
  color: #fff;
  text-align: center;
  font-size: 9px;
}
.collapsed .menu-item {
  justify-content: center;
  padding: 0;
}
.sidebar-bottom {
  padding: 8px 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.user-card {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 7px;
  padding: 9px 4px;
}
.avatar {
  flex: none;
  background: #dcece9;
  color: #185f54;
  font-size: 12px;
  font-weight: 700;
}
.user-info {
  display: grid;
  flex: 1;
  min-width: 0;
}
.user-info strong {
  color: #f3f8f7;
  font-size: 11px;
  font-weight: 600;
}
.user-info span {
  color: #729a94;
  font-size: 9px;
}
.user-card :deep(.el-button) {
  color: #82a7a2;
}
.workspace {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
}
.topbar {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 0 25px;
  border-bottom: 1px solid #e1e8e7;
  background: #fff;
}
.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
}
.topbar-left {
  gap: 17px;
}
.collapse-button,
.top-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #6c7d7a;
  cursor: pointer;
}
.collapse-button:hover,
.top-icon:hover {
  background: #f0f5f4;
  color: #167c6b;
}
.topbar :deep(.el-breadcrumb__inner) {
  color: #899693;
  font-size: 11px;
}
.topbar :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: #3a4a47;
  font-weight: 600;
}
.topbar-right {
  gap: 7px;
}
.system-health {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 9px;
  padding: 5px 9px;
  border-radius: 14px;
  background: #edf7f3;
  color: #49806f;
  font-size: 9px;
}
.system-health span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #46a26b;
}
.notification-badge {
  display: flex;
}
.notification-badge :deep(.el-badge__content) {
  top: 3px;
  right: 6px;
  font-size: 8px;
}
.quick-create {
  margin-left: 3px;
}
.content-area {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 25px 28px 36px;
}
.popover-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 9px;
  border-bottom: 1px solid #e9eeed;
}
.popover-title strong {
  font-weight: 650;
}
.notice {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid #edf1f0;
}
.notice:last-child {
  border: 0;
}
.notice-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 8px;
}
.notice-icon.warning {
  background: #fff3df;
  color: #c58220;
}
.notice-icon.success {
  background: #e8f5ed;
  color: #3d925f;
}
.notice > div {
  display: grid;
}
.notice strong {
  font-size: 11px;
  font-weight: 650;
}
.notice p {
  margin: 2px 0;
  color: #667572;
  font-size: 10px;
}
.notice small {
  color: #98a3a1;
  font-size: 9px;
}
</style>
