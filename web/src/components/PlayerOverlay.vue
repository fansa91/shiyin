<template>
  <!-- 全屏播放器: 常驻 DOM (v-show), shikwasa 实例只挂载一次不卸载 -->
  <div v-show="player.expanded" class="player-overlay">
    <v-toolbar flat color="transparent">
      <v-btn icon="mdi-chevron-down" @click="player.expanded = false" />
      <v-toolbar-title class="text-body-1">正在播放</v-toolbar-title>
      <v-spacer />
      <v-btn icon="mdi-playlist-music" @click="showQueue = !showQueue">
        <v-tooltip activator="parent" location="bottom">播放队列</v-tooltip>
      </v-btn>
    </v-toolbar>

    <div class="player-body">
      <div class="cover-wrap">
        <QueuedImage
          v-if="player.current"
          :src="player.current.artwork"
          aspect="1/1"
          radius="24px"
          class="cover"
        />
      </div>

      <div class="text-center px-6 mt-4">
        <div class="text-h6 font-weight-bold text-truncate-2">{{ player.current?.title }}</div>
        <div class="text-body-2 text-medium-emphasis mt-1 text-truncate">
          {{ player.current?.podcastAuthor || player.current?.podcastTitle }}
        </div>
      </div>

      <!-- shikwasa 完整播放器: 进度条 / 播放暂停 / ±10s / 倍速 / 音量 / 章节 -->
      <div ref="mountEl" class="shk-mount mt-2" />

      <div class="d-flex justify-center align-center gap-2 mt-1">
        <v-btn icon="mdi-rewind-30" variant="text" size="large" @click="player.skipBackward()">
          <v-tooltip activator="parent" location="top">后退 30 秒</v-tooltip>
        </v-btn>
        <v-btn icon="mdi-skip-previous" variant="text" size="large" :disabled="!player.hasPrev" @click="player.prev()" />
        <v-btn
          :icon="player.isPlaying ? 'mdi-pause-circle' : 'mdi-play-circle'"
          color="primary"
          size="x-large"
          variant="text"
          @click="player.toggle()"
        />
        <v-btn icon="mdi-skip-next" variant="text" size="large" :disabled="!player.hasNext" @click="player.next()" />
        <v-btn icon="mdi-fast-forward-30" variant="text" size="large" @click="player.skipForward()">
          <v-tooltip activator="parent" location="top">快进 30 秒</v-tooltip>
        </v-btn>
      </div>

      <div class="d-flex justify-center align-center mt-1">
        <span class="text-caption text-medium-emphasis mr-2">倍速</span>
        <v-chip-group v-model="speedIdx" mandatory>
          <v-chip v-for="s in SPEEDS" :key="s" size="small" @click="player.setSpeed(s)">
            {{ s }}x
          </v-chip>
        </v-chip-group>
      </div>

      <!-- 播放队列 -->
      <v-expand-transition>
        <div v-show="showQueue" class="queue-wrap mt-2">
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
import { computed, onMounted, ref } from 'vue'
import { SPEEDS } from '../settings'
import { usePlayerStore } from '../stores/player'
import QueuedImage from './QueuedImage.vue'

const player = usePlayerStore()
const mountEl = ref<HTMLElement | null>(null)
const showQueue = ref(false)

const speedIdx = computed({
  get: () => Math.max(0, SPEEDS.indexOf(player.speed)),
  set: () => {},
})

onMounted(() => {
  // 容器常驻, 只注册一次; Player 实例在首次播放时延迟创建
  if (mountEl.value) player.ensurePlayer(mountEl.value)
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
  max-width: 560px;
  width: 100%;
  margin: 0 auto;
  padding: 8px 16px 32px;
  display: flex;
  flex-direction: column;
}
.cover-wrap {
  display: flex;
  justify-content: center;
}
.cover {
  width: min(320px, 64vw);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
}
.text-truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.gap-2 {
  gap: 8px;
}
/* shikwasa 挂载区: M3 圆角, 高度自适应 */
.shk-mount :deep(.shk-player) {
  border-radius: 16px;
  height: auto;
  min-height: 120px;
  box-shadow: none;
  border: 1px solid rgba(128, 128, 128, 0.2);
}
.shk-mount :deep(.shk) {
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
