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
import { onMounted, ref } from 'vue'
import { backend } from '../api'
import { COUNTRIES, SPEEDS, settings } from '../settings'

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
