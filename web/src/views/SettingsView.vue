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
            用同步码在多设备间同步订阅、稍后听、播放进度和设置。无需注册，同步码即身份凭证，请妥善保存。
          </div>
          <v-btn color="primary" variant="tonal" :loading="genLoading" @click="onGenerate">
            生成同步码
          </v-btn>
          <template v-if="newCode">
            <v-text-field
              :model-value="newCode"
              label="你的同步码（只显示一次）"
              readonly
              variant="outlined"
              density="comfortable"
              class="mt-4"
              append-inner-icon="mdi-content-copy"
              @click:append-inner="copyText(newCode)"
            />
            <v-alert type="warning" variant="tonal" density="compact" class="text-body-2">
              同步码只显示这一次，请立即复制保存。丢失后云端数据无法找回。
            </v-alert>
          </template>

          <v-divider class="my-4" />
          <div class="text-body-2 mb-2">已有同步码？输入绑定</div>
          <div class="d-flex gap-2">
            <v-text-field
              v-model="inputCode"
              label="同步码"
              variant="outlined"
              density="comfortable"
              class="flex-grow-1"
              :disabled="bindLoading"
            />
            <v-btn color="primary" :loading="bindLoading" @click="onBind">绑定</v-btn>
          </div>
        </div>

        <div v-else>
          <div class="d-flex align-center gap-2 mb-3 flex-wrap">
            <v-chip color="success" size="small">已绑定</v-chip>
            <span class="text-body-2 text-medium-emphasis">上次同步：{{ lastSyncText }}</span>
            <v-progress-circular v-if="sync.syncing" indeterminate size="18" width="2" />
          </div>
          <v-alert v-if="sync.lastError" type="error" variant="tonal" density="compact" class="mb-3">
            {{ sync.lastError }}
          </v-alert>
          <div class="d-flex gap-2 flex-wrap">
            <v-btn variant="tonal" :loading="sync.syncing" @click="onSyncNow">立即同步</v-btn>
            <v-btn variant="tonal" @click="onRotate">换码</v-btn>
            <v-btn variant="tonal" @click="sync.unbind()">解绑</v-btn>
            <v-btn variant="text" color="error" @click="showDelete = true">删除云端数据</v-btn>
          </div>
          <div class="text-caption text-medium-emphasis mt-3">
            解绑只断开本机，本地数据保留；换码后旧码立即作废，需在其他设备重新绑定。
          </div>
        </div>
      </v-card-text>
    </v-card>

    <v-dialog v-model="showRotated" max-width="440">
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold">新同步码</v-card-title>
        <v-card-text>
          <v-text-field
            :model-value="rotatedCode"
            readonly
            variant="outlined"
            density="comfortable"
            append-inner-icon="mdi-content-copy"
            @click:append-inner="copyText(rotatedCode)"
          />
          <div class="text-body-2 text-medium-emphasis">
            旧码已作废。请在其他设备上用新码重新绑定。
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" @click="showRotated = false">知道了</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showDelete" max-width="440">
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold">删除云端数据？</v-card-title>
        <v-card-text class="text-body-2">
          将删除该同步码对应的全部云端数据（订阅、稍后听、播放进度、设置），本地数据不受影响。此操作不可撤销。
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDelete = false">取消</v-btn>
          <v-btn color="error" :loading="delLoading" @click="onDeleteRemote">删除</v-btn>
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
  { value: 'dark', title: '深色' },
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

const newCode = ref('')
const inputCode = ref('')
const genLoading = ref(false)
const bindLoading = ref(false)
const delLoading = ref(false)
const opError = ref('')
const showDelete = ref(false)
const showRotated = ref(false)
const rotatedCode = ref('')

const lastSyncText = computed(() => (sync.lastSyncAt ? timeAgo(sync.lastSyncAt) : '从未'))

async function copyText(t: string) {
  try {
    await navigator.clipboard.writeText(t)
  } catch {
    /* 剪贴板不可用时用户手动复制 */
  }
}

async function onGenerate() {
  opError.value = ''
  genLoading.value = true
  try {
    newCode.value = await sync.generateCode()
  } catch (e: any) {
    opError.value = e?.message ?? '生成失败'
  } finally {
    genLoading.value = false
  }
}

async function onBind() {
  opError.value = ''
  bindLoading.value = true
  try {
    await sync.bindCode(inputCode.value)
    inputCode.value = ''
    newCode.value = ''
  } catch (e: any) {
    opError.value = e?.message ?? '绑定失败'
  } finally {
    bindLoading.value = false
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

async function onRotate() {
  opError.value = ''
  try {
    rotatedCode.value = await sync.rotateCode()
    showRotated.value = true
  } catch (e: any) {
    opError.value = e?.message ?? '换码失败'
  }
}

async function onDeleteRemote() {
  delLoading.value = true
  try {
    await sync.deleteRemote()
    showDelete.value = false
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
