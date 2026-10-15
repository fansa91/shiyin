<template>
  <v-app>
    <!-- 桌面端侧边栏: ≥1280px 完整, 960–1280px 图标 rail -->
    <v-navigation-drawer
      v-if="mdAndUp"
      :rail="railMode"
      permanent
      color="surface-container"
      :width="248"
    >
      <v-list nav>
        <div class="d-flex align-center px-3 py-3 logo" @click="$router.push('/')">
          <v-icon icon="mdi-podcast" color="primary" size="28" class="mr-3" />
          <span v-if="!railMode" class="text-h6 font-weight-bold">拾音</span>
        </div>
        <v-list-subheader>发现</v-list-subheader>
        <v-list-item prepend-icon="mdi-home" title="首页" to="/" exact />
        <v-list-item prepend-icon="mdi-magnify" title="搜索" to="/search" />
        <v-list-item prepend-icon="mdi-trophy-outline" title="排行榜" to="/charts" />
        <v-list-item prepend-icon="mdi-shape-outline" title="分类" to="/categories" />
        <v-list-subheader>资料库</v-list-subheader>
        <v-list-item prepend-icon="mdi-rss" title="订阅" to="/subscriptions" />
        <v-list-item prepend-icon="mdi-bookmark-outline" title="稍后听" to="/later" />
        <v-list-item prepend-icon="mdi-history" title="播放历史" to="/history" />
      </v-list>
      <template #append>
        <v-list nav>
          <v-list-item prepend-icon="mdi-cog" title="设置" to="/settings" />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- 移动端: 顶部栏 + 底部 5 项导航 -->
    <v-app-bar v-if="smAndDown" flat color="surface-container">
      <v-app-bar-title class="font-weight-bold">拾音</v-app-bar-title>
      <template #append>
        <v-btn icon="mdi-cog" to="/settings" />
      </template>
    </v-app-bar>

    <v-bottom-navigation v-if="smAndDown" grow color="primary" :model-value="bottomTab" @update:model-value="goTab">
      <v-btn value="home">
        <v-icon icon="mdi-home" />
        首页
      </v-btn>
      <v-btn value="search">
        <v-icon icon="mdi-magnify" />
        搜索
      </v-btn>
      <v-btn value="charts">
        <v-icon icon="mdi-trophy-outline" />
        排行
      </v-btn>
      <v-btn value="subscriptions">
        <v-icon icon="mdi-rss" />
        订阅
      </v-btn>
      <v-btn value="history">
        <v-icon icon="mdi-history" />
        历史
      </v-btn>
    </v-bottom-navigation>

    <v-main :class="{ 'has-mini': !!player.current }">
      <router-view />
    </v-main>

    <!-- 迷你播放条 + 全屏播放器 (常驻, 全局单例) -->
    <MiniPlayer />
    <PlayerOverlay />
  </v-app>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay, useTheme } from 'vuetify'
import MiniPlayer from './components/MiniPlayer.vue'
import PlayerOverlay from './components/PlayerOverlay.vue'
import { initTheme, themeIsDark } from './theme'
import { usePlayerStore } from './stores/player'

const theme = useTheme()
const { mdAndUp, smAndDown, xlAndUp } = useDisplay()
const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

/** 960–1280px 显示图标 rail, ≥1280px 完整侧边栏 */
const railMode = computed(() => mdAndUp.value && !xlAndUp.value)

// M3 主题色 / 深浅模式, 设置变化时自动重算, 并同步给 shikwasa
initTheme(theme)
function syncPlayerTheme() {
  player.applyTheme(theme.current.value.colors as Record<string, string>, themeIsDark())
}
syncPlayerTheme()
watch(
  () => [theme.current.value.colors, theme.global.name.value],
  syncPlayerTheme,
  { deep: true },
)

/** 移动端底部导航高亮 */
const bottomTab = computed(() => {
  const p = route.path
  if (p.startsWith('/search')) return 'search'
  if (p.startsWith('/charts') || p.startsWith('/categories')) return 'charts'
  if (p.startsWith('/subscriptions') || p.startsWith('/later')) return 'subscriptions'
  if (p.startsWith('/history')) return 'history'
  return 'home'
})
function goTab(v: unknown) {
  const map: Record<string, string> = {
    home: '/',
    search: '/search',
    charts: '/charts',
    subscriptions: '/subscriptions',
    history: '/history',
  }
  const path = map[String(v)]
  if (path) router.push(path)
}
</script>

<style scoped>
.logo {
  cursor: pointer;
}
/* 迷你播放条浮在内容上, 给主内容留出底部空间 */
.has-mini .v-main__wrap {
  padding-bottom: 88px;
}
@media (max-width: 959px) {
  .has-mini .v-main__wrap {
    padding-bottom: 152px;
  }
}
</style>
