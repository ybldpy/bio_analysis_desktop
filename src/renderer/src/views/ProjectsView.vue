<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '../components/PageHeader.vue'
import StatusTag from '../components/StatusTag.vue'
import { projects } from '../data/mockData'
import { fetchProjectList, requestCreateProject, type BioProject } from '../api/bioProject.js'
import { RAW_RESPONSE_STATUS_OK } from '../api/common.js'

const emit = defineEmits(['navigate'])
const search = ref('')
const status = ref('全部状态')
const dialogVisible = ref(false)
const isCreatingProject = ref(false)
const isLoadingProject = ref(false)

const form = ref({ name: '', owner: '', description: '' })


const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()

  if (!keyword) {
    return projectList.value
  }

  return projectList.value.filter((project) =>
    project.projectName.toLowerCase().includes(keyword)
  )
})

async function createProject() {
  isCreatingProject.value = true

  try {
    const response = await requestCreateProject({
      projectName: form.value.name,
      description: form.value.description
    })

    if (response.status !== RAW_RESPONSE_STATUS_OK) {
      ElMessage.error(response.failMsg || '项目创建失败')
      return
    }

    loadProjects()
    ElMessage.success('项目创建成功')
    dialogVisible.value = false
    form.value.name = ''
    form.value.description = ''
  } catch (error) {
    console.error(error)
    ElMessage.error('项目创建失败')
  } finally {
    isCreatingProject.value = false
  }
}



const projectList = ref<BioProject[]>([])

async function loadProjects() {

  isLoadingProject.value = true
  try {
    const response = await fetchProjectList()

    if (response.status !== RAW_RESPONSE_STATUS_OK) {
      ElMessage.error(response.failMsg || '项目列表加载失败')
      return
    }

    projectList.value = response.data
  } catch (error) {
    console.error(error)
    ElMessage.error('项目列表加载失败')
  } finally {
    isLoadingProject.value = false
  }
}

const currentPage = ref(1)

loadProjects()

</script>

<template>
  <div>
    <PageHeader title="项目管理" description="按检测批次或研究主题组织样本与分析任务">
      <el-button type="primary" @click="dialogVisible = true"><el-icon>
          <Plus />
        </el-icon>新建项目</el-button>
    </PageHeader>

    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <el-input v-model="search" clearable placeholder="搜索项目名称" class="search-input">
          <template #prefix><el-icon>
              <Search />
            </el-icon></template>
        </el-input>
        <el-select v-model="status" style="width: 140px">
          <el-option v-for="item in ['全部状态', '进行中', '已完成', '已归档']" :key="item" :label="item" :value="item" />
        </el-select>
        <div class="toolbar-spacer"></div>
        <span class="count">共 {{ filtered.length }} 个项目</span>
        <el-button><el-icon>
            <Refresh />
          </el-icon></el-button>
      </div>

      <el-table :data="filtered" row-key="id" v-loading="isLoadingProject">
        <el-table-column label="项目名称" min-width="270">
          <template #default="{ row }">
            <div class="project-cell">
              <div class="project-icon">
                <el-icon>
                  <Folder />
                </el-icon>
              </div>
              <div>
                <strong>{{ row.projectName }}</strong>
                <!-- <small>{{ row.id }}</small> -->
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="项目描述" min-width="260" show-overflow-tooltip />
        <!-- <el-table-column label="样本 / 任务" width="130">
          <template #default="{ row }"><span class="number">{{ row.samples }}</span> / {{ row.tasks }}</template>
        </el-table-column> -->
        <!-- <el-table-column prop="owner" label="负责团队" width="120" /> -->
        <!-- <el-table-column label="状态" width="105"><template #default="{ row }">
            <StatusTag :status="row.status" />
          </template></el-table-column> -->
        <el-table-column prop="createdAt" label="创建日期" width="120" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default>
            <el-button link type="primary" @click="emit('navigate', 'tasks')">查看</el-button>
            <!-- <el-dropdown><el-button link><el-icon>
                  <MoreFilled />
                </el-icon></el-button><template
                #dropdown><el-dropdown-menu><el-dropdown-item>编辑项目</el-dropdown-item><el-dropdown-item>归档项目</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
    -->
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <el-pagination v-model:current-page="currentPage" :total="filtered.length" :page-size="20"
          layout="total, prev, pager, next" />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新建项目" width="520px" :close-on-click-modal="false">
      


        <div
          v-loading="isCreatingProject"
          element-loading-text="正在创建项目..."
        >
        <el-form label-position="top">
          <div class="form-grid">
            <el-form-item label="项目名称" required><el-input v-model="form.name" placeholder="请输入项目名称" /></el-form-item>
          </div>
          <el-form-item label="项目描述">
            <el-input v-model="form.description" type="textarea" :rows="3" placeholder="简要说明项目背景与用途" />
          </el-form-item>
        </el-form>
        </div>
        <template #footer>
          <el-button :disabled="isCreatingProject" @click="dialogVisible = false">
            取消
          </el-button>
          <el-button
            type="primary"
            :disabled="!form.name"
            :loading="isCreatingProject"
            @click="createProject"
          >
            创建项目
          </el-button>
        </template>

      
    </el-dialog>
  </div>
</template>

<style scoped>
.table-card :deep(.el-card__body) {
  padding: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid #edf1f0;
}

.search-input {
  width: 310px;
}

.toolbar-spacer {
  flex: 1;
}

.count {
  color: #83918f;
  font-size: 12px;
}

.project-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: #167c6b;
  background: #e9f5f3;
  font-size: 18px;
}

.project-cell div:last-child {
  display: grid;
}

.project-cell strong {
  color: #263634;
  font-size: 13px;
  font-weight: 650;
}

.project-cell small {
  color: #97a3a1;
  font-size: 10px;
}

.number {
  color: #167c6b;
  font-weight: 700;
}

.pagination {
  display: flex;
  justify-content: flex-end;
  padding: 17px 20px;
  border-top: 1px solid #edf1f0;
}

.form-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 14px;
}
</style>
