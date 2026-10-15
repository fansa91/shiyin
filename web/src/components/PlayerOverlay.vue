<template>
  <!-- 展开播放视图: 常驻 DOM (v-show), 单例 shikwasa 搬移至此放大显示 -->
  <div v-show="player.expanded" class="player-overlay">
    <v-toolbar flat color="transparent">
      <v-btn icon="mdi-chevron-down" @click="player.setExpanded(false)" />
      <v-toolbar-title class="text-body-1">正在播放</v-toolbar-title>
      <v-spacer />
      <v-btn icon="mdi-playlist-music" @click="showQueue = !showQueue">
        <v-tooltip activator="parent" location="bottom">播放队列</v-tooltip>
      </v-btn>
    </v-toolbar>

    <div class="player-body">
      <!-- shikwasa 原生界面: 封面 / 标题 / 章节 / 进度条 / 播放暂停 /
           快进快退 / 倍速 / 音量均为原生, 与底部坞是同一实例 -->
      <div ref="expandedMount" class="shk-expanded-mount" />

      <!-- 播放队列: shikwasa 无播放列表, 应用层自管 -->
      <v-expand-transition>
        <div v-show="showQueue" class="queue-wrap mt-4">
          <div class="d-flex align-center px-4 py-2">
            <span class="text-subtitle-2 font-weight-bold">播放队列 ({{ player.queue.length }})</span>
            <v-spacer />
            <v-btn size="small" variant="text" color="error" @click="player.clearQueue()">清空</v-btn>
          </div>
          <v-list class="queue-list">
            <v-list-item
              v-for="(ep, i) in player.queue"
              :key="ep.guid"
              :active="i === player.currentIndex"
              color="primary"
              @click="player.playAt(i)"
            >
              <template #prepend>
                <span class="text-caption text-medium-emphasis mr-2" style="min-width: 20px">{{ i + 1 }}</span>
              </template>
              <v-list-item-title class="text-body-2">{{ ep.title }}</v-list-item-title>
              <v-list-item-subtitle class="text-caption">{{ ep.podcastTitle }}</v-list-item-subtitle>
              <template #append>
                <v-btn icon="mdi-close" size="small" variant="text" @click.stop="player.removeAt(i)" />
              </template>
            </v-list-item>
          </v-list>
        </div>
      </v-expand-transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { usePlayerStore } from '../stores/player'

const player = usePlayerStore()
const expandedMount = ref<HTMLElement | null>(null)
const showQueue = ref(false)

onMounted(() => {
  // 容器常驻, 只注册一次; Player 实例在首次播放时延迟创建,
  // 展开时单例的根元素会搬移至此 (store.setExpanded)
  if (expandedMount.value) player.registerExpanded(expandedMount.value)
})
</script>

<style scoped>
.player-overlay {
  position: fixed;
  inset: 0;
  z-index: 1010;
  background: rgb(var(--v-theme-background));
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.player-body {
  max-width: 640px;
  width: 100%;
  margin: 0 auto;
  padding: 8px 16px 32px;
  display: flex;
  flex-direction: column;
}
/* 展开视图里的原生播放器: M3 圆角卡片, 主题色由 store 的 CSS 变量同步 */
.shk-expanded-mount :deep(.shk-player) {
  border-radius: 20px;
  box-shadow: none;
  border: 1px solid rgba(128, 128, 128, 0.2);
}
.shk-expanded-mount :deep(.shk) {
  font-family: inherit;
}
.queue-wrap {
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 16px;
  overflow: hidden;
}
.queue-list {
  max-height: 320px;
  overflow-y: auto;
  background: transparent;
}
</style>
