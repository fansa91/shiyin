<template>
  <div
    class="episode-row d-flex align-center gap-3 pa-3"
    :class="{ 'is-current': isCurrent }"
    @click="$emit('play')"
  >
    <QueuedImage :src="episode.artwork" aspect="1/1" radius="8px" class="ep-cover" />

    <div class="flex-1-1 min-w-0">
      <div class="text-body-2 font-weight-medium text-truncate-2">{{ episode.title }}</div>
      <div class="text-caption text-medium-emphasis mt-1">
        {{ formatDate(episode.pubDate) }}
        <template v-if="episode.duration"> · {{ formatDuration(episode.duration) }}</template>
        <template v-if="entry"> · 已播 {{ Math.round((entry.position / entry.duration) * 100) }}%</template>
      </div>
      <div v-if="episode.description" class="text-caption text-medium-emphasis text-truncate-2 mt-1">
        {{ episode.description }}
      </div>
      <v-progress-linear
        v-if="entry && entry.duration > 0"
        :model-value="(entry.position / entry.duration) * 100"
        color="primary"
        height="3"
        rounded
        class="mt-2"
      />
    </div>

    <v-btn
      :icon="isCurrent && playing ? 'mdi-pause' : 'mdi-play'"
      variant="text"
      color="primary"
      @click.stop="$emit('play')"
    />
    <v-btn
      :icon="inLater ? 'mdi-bookmark' : 'mdi-bookmark-outline'"
      :color="inLater ? 'primary' : undefined"
      variant="text"
      @click.stop="$emit('toggle-later')"
    >
      <v-tooltip activator="parent" location="top">{{ inLater ? '取消稍后听' : '稍后听' }}</v-tooltip>
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { formatDate, formatDuration } from '../api'
import type { HistoryEntry } from '../library'
import type { Episode } from '../models'
import QueuedImage from './QueuedImage.vue'

defineProps<{
  episode: Episode
  /** 是否正在播放这一集 */
  isCurrent: boolean
  playing: boolean
  inLater: boolean
  /** 播放历史条目 (断点续播进度) */
  entry?: HistoryEntry
}>()

defineEmits<{ play: []; 'toggle-later': [] }>()
</script>

<style scoped>
.episode-row {
  cursor: pointer;
  border-radius: 12px;
}
.episode-row:hover {
  background: rgba(128, 128, 128, 0.08);
}
.episode-row.is-current {
  background: rgba(128, 128, 128, 0.12);
}
.ep-cover {
  width: 56px;
}
.min-w-0 {
  min-width: 0;
}
.text-truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.gap-3 {
  gap: 12px;
}
</style>
