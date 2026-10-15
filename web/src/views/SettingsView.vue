<template>
  <v-container style="max-width: 640px">
    <h2 class="text-h5 font-weight-bold mb-4">设置</h2>

    <v-card elevation="0" color="surface-container" class="mb-4" rounded="xl">
      <v-card-title class="text-subtitle-1 font-weight-bold">外观</v-card-title>
      <v-card-text>
        <v-select
          v-model="settings.themeMode"
          :items="themeItems"
          label="主题模式"
          variant="outlined"
          density="comfortable"
          class="mb-4"
        />
        <div class="text-body-2 mb-2">主题色</div>
        <div class="d-flex flex-wrap gap-2 align-center">
          <v-btn
            v-for="c in seedPresets"
            :key="c"
            icon
            size="small"
            :style="{ background: c }"
            :class="{ 'seed-active': settings.seedColor.toLowerCase() === c.toLowerCase() }"
            @click="settings.seedColor = c"
          >
            <v-icon v-if="settings.seedColor.toLowerCase() === c.toLowerCase()" icon="mdi-check" />
          </v-btn>
          <v-menu :close-on-content-click="false">
            <template #activator="{ props }">
              <v-btn icon="mdi-eyedropper" variant="outlined" size="small" v-bind="props" />
            </template>
            <v-color-picker v-model="settings.seedColor" mode="hex" hide-inputs show-swatches />
          </v-menu>
        </div>
      </v-card-text>
    </v-card>

    <v-card elevation="0" color="surface-container" class="mb-4" rounded="xl">
      <v-card-title class="text-subtitle-1 font-weight-bold">播放</v-card-title>
      <v-card-text>
        <v-select
          v-model="settings.defaultSpeed"
          :items="speedItems"
          label="默认倍速"
          variant="outlined"
          density="comfortable"
        />
      </v-card-text>
    </v-card>

    <v-card elevation="0" color="surface-container" class="mb-4" rounded="xl">
      <v-card-title class="text-subtitle-1 font-weight-bold">内容地区</v-card-title>
      <v-card-text>
        <v-select
          v-model="settings.country"
          :items="COUNTRIES"
          label="排行榜 / 搜索地区"
          variant="outlined"
          density="comfortable"
        />
      </v-card-text>
    </v-card>

    <v-card elevation="0" color="surface-container" class="mb-4" rounded="xl">
      <v-card-title class="text-subtitle-1 font-weight-bold">云端同步</v-card-title>
      <v-card-text>
        <v-alert v-if="opError" type="error" variant="tonal" density="compact" class="mb-3">
          {{ opError }}
        </v-alert>

        <div v-if="!sync.bound">
          <div class="text-body-2 text-medium-emphasis mb-3">
            登录后在多设备间同步订阅、稍后听、播放进度和设置。密码经加盐哈希存储，服务端不存明文。
          </div>
          <v-tabs v-model="authTab" density="compact" class="mb-3">
            <v-tab value="login">登录</v-tab>
            <v-tab value="register">注册</v-tab>
          </v-tabs>
          <v-text-field
            v-model="username"
            label="用户名（3-32 位字母/数字/_/-）"
            variant="outlined"
            density="comfortable"
            class="mb-3"
            :disabled="authLoading"
            @keyup.enter="onAuth"
          />
          <v-text-field
            v-model="password"
            label="密码（至少 8 位）"
            type="password"
            variant="outlined"
            density="comfortable"
            :disabled="authLoading"
            @keyup.enter="onAuth"
          />
          <v-btn color="primary" :loading="authLoading" @click="onAuth" class="mt-1">
            {{ authTab === 'login' ? '登录' : '注册并登录' }}
          </v-btn>
        </div>

        <div v-else>
          <div class="d-flex align-center gap-2 mb-3 flex-wrap">
            <v-chip color="success" size="small">已登录</v-chip>
            <span class="text-body-2">{{ sync.username }}</span>
            <span class="text-body-2 text-medium-emphasis">上次同步：{{ lastSyncText }}</span>
            <v-progress-circular v-if="sync.syncing" indeterminate size="18" width="2" />
          </div>
          <v-alert v-if="sync.lastError" type="error" variant="tonal" density="compact" class="mb-3">
            {{ sync.lastError }}
          </v-alert>
          <div class="d-flex gap-2 flex-wrap">
            <v-btn variant="tonal" :loading="sync.syncing" @click="onSyncNow">立即同步</v-btn>
            <v-btn variant="tonal" @click="onLogout" :loading="logoutLoading">退出登录</v-btn>
            <v-btn variant="text" color="error" @click="showDelete = true">删除账号</v-btn>
          </div>
          <div class="text-caption text-medium-emphasis mt-3">
            退出登录只断开本机，本地数据保留；删除账号会清空该账号的全部云端数据。
          </div>
        </div>
      </v-card-text>
    </v-card>

    <v-dialog v-model="showDelete" max-width="440">
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold">删除账号？</v-card-title>
        <v-card-text class="text-body-2">
          <div class="mb-3">
            将删除账号「{{ sync.username }}」的全部云端数据（订阅、稍后听、播放进度、设置），本地数据不受影响。此操作不可撤销。
          </div>
          <v-text-field
            v-model="deletePassword"
            label="输入密码确认"
            type="password"
            variant="outlined"
            density="comfortable"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDelete = false">取消</v-btn>
          <v-btn color="error" :loading="delLoading" @click="onDeleteAccount">删除</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-card elevation="0" color="surface-container" rounded="xl">
      <v-card-title class="text-subtitle-1 font-weight-bold">关于</v-card-title>
      <v-card-text class="text-body-2 text-medium-emphasis">
        <div class="mb-1">拾音 · Web 播客播放器</div>
        <div class="d-flex align-center gap-2">
          后端状态:
          <v-chip :color="health === true ? 'success' : health === false ? 'error' : undefined" size="small">
            {{ health === true ? '正常' : health === false ? '异常' : '检测中' }}
          </v-chip>
          <v-btn size="small" variant="text" @click="checkHealth">重新检测</v-btn>
        </div>
        <div class="mt-2 text-caption">播客目录来自 iTunes Search API, RSS 解析走自建后端。</div>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { backend, timeAgo } from '../api'
import { COUNTRIES, SPEEDS, settings } from '../settings'
import { useSyncStore } from '../stores/sync'

const sync = useSyncStore()

const themeItems = [
  { value: 'system', title: '跟随系统' },
  { value: 'light', title: '浅色' },
  { value: 'dark', title: '暗色' },
]
const speedItems = SPEEDS.map((s) => ({ value: s, title: `${s}x` }))
const seedPresets = ['#6750A4', '#0061A4', '#00696E', '#4C662B', '#8C4A60', '#96590B', '#B3261E']

const health = ref<boolean | null>(null)

async function checkHealth() {
  health.value = null
  try {
    const r = await backend.health()
    health.value = r.ok === true
  } catch {
    health.value = false
  }
}

onMounted(checkHealth)

/* ---------------- 云端同步 ---------------- */

const authTab = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const authLoading = ref(false)
const logoutLoading = ref(false)
const delLoading = ref(false)
const opError = ref('')
const showDelete = ref(false)
const deletePassword = ref('')

const lastSyncText = computed(() => (sync.lastSyncAt ? timeAgo(sync.lastSyncAt) : '从未'))

async function onAuth() {
  opError.value = ''
  authLoading.value = true
  try {
    if (authTab.value === 'register') {
      await sync.register(username.value, password.value)
    } else {
      await sync.login(username.value, password.value)
    }
    username.value = ''
    password.value = ''
  } catch (e: any) {
    opError.value = e?.message ?? (authTab.value === 'register' ? '注册失败' : '登录失败')
  } finally {
    authLoading.value = false
  }
}

async function onSyncNow() {
  opError.value = ''
  try {
    await sync.pull()
    await sync.pushNow()
  } catch (e: any) {
    opError.value = e?.message ?? '同步失败'
  }
}

async function onLogout() {
  opError.value = ''
  logoutLoading.value = true
  try {
    await sync.logout()
  } catch (e: any) {
    opError.value = e?.message ?? '退出失败'
  } finally {
    logoutLoading.value = false
  }
}

async function onDeleteAccount() {
  opError.value = ''
  delLoading.value = true
  try {
    await sync.deleteAccount(deletePassword.value)
    showDelete.value = false
    deletePassword.value = ''
  } catch (e: any) {
    opError.value = e?.message ?? '删除失败'
  } finally {
    delLoading.value = false
  }
}
</script>

<style scoped>
.gap-2 {
  gap: 8px;
}
.seed-active {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
