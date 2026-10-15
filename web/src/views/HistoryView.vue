<template>
  <v-container>
    <div class="d-flex align-center mb-4">
      <h2 class="text-h5 font-weight-bold">播放历史</h2>
      <v-spacer />
      <v-btn
        v-if="items.length"
        variant="text"
        color="error"
        prepend-icon="mdi-delete-sweep-outline"
        @click="confirmClear = true"
      >
        清空
      </v-btn>
    </div>

    <v-list v-if="items.length" class="bg-transparent">
      <v-list-item
        v-for="{ guid, entry } in items"
        :key="guid"
        class="hist-row mb-1"
        rounded="xl"
        @click="resume(guid, entry)"
      >
        <template #prepend>
          <QueuedImage :src="entry.artwork" aspect="1/1" radius="8px" class="hist-cover mr-3" />
        </template>
        <v-list-item-title class="font-weight-medium">{{ entry.title }}</v-list-item-title>
        <v-list-item-subtitle>
          {{ entry.podcastTitle }} · {{ timeAgo(entry.updatedAt) }}
        </v-list-item-subtitle>
        <div class="d-flex align-center gap-2 mt-1" style="max-width: 320px">
          <v-progress-linear
            :model-value="entry.duration > 0 ? (entry.position / entry.duration) * 100 : 0"
            color="primary"
            height="4"
            rounded
          />
          <span class="text-caption text-medium-emphasis text-no-wrap">
            {{ formatDuration(entry.position) }} / {{ formatDuration(entry.duration) }}
          </span>
        </div>
        <template #append>
          <v-btn icon="mdi-play" variant="text" color="primary" @click.stop="resume(guid, entry)" />
          <v-btn icon="mdi-delete-outline" variant="text" @click.stop="remove(guid)" />
        </template>
      </v-list-item>
    </v-list>

    <div v-else class="text-center text-medium-emphasis mt-12">
      <v-icon icon="mdi-history" size="64" class="mb-4" />
      <div>还没有播放记录</div>
    </div>

    <v-dialog v-model="confirmClear" max-width="360">
      <v-card title="清空播放历史?">
        <v-card-text>所有断点续播进度将被删除, 不可恢复。</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmClear = false">取消</v-btn>
          <v-btn color="error" @click="doClear">清空</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { formatDuration, timeAgo } from '../api'
import QueuedImage from '../components/QueuedImage.vue'
import {
  clearHistory,
  getHistoryList,
  removeHistoryEntry,
  type HistoryEntry,
} from '../library'
import type { Episode } from '../models'
import { usePlayerStore } from '../stores/player'

const player = usePlayerStore()
const items = ref<{ guid: string; entry: HistoryEntry }[]>([])
const confirmClear = ref(false)

function refresh() {
  items.value = getHistoryList()
}

/** 继续播放: 用快照里的元数据直接播, store 会自动断点续播 */
function resume(guid: string, entry: HistoryEntry) {
  if (player.current?.guid === guid) {
    player.toggle()
    return
  }
  const ep: Episode = {
    guid,
    title: entry.title,
    description: '',
    pubDate: '',
    duration: entry.duration,
    audioUrl: entry.audioUrl,
    artwork: entry.artwork,
    podcastTitle: entry.podcastTitle,
    podcastAuthor: entry.podcastAuthor,
    podcastKey: entry.podcastKey,
    feedUrl: entry.feedUrl,
    chapters: [],
  }
  player.playEpisode(ep)
}

function remove(guid: string) {
  removeHistoryEntry(guid)
  refresh()
}

function doClear() {
  clearHistory()
  confirmClear.value = false
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.hist-row {
  cursor: pointer;
}
.hist-row:hover {
  background: rgba(128, 128, 128, 0.08);
}
.hist-cover {
  width: 52px;
}
.gap-2 {
  gap: 8px;
}
</style>
