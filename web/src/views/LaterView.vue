<template>
  <v-container>
    <h2 class="text-h5 font-weight-bold mb-4">稍后听</h2>

    <v-list v-if="items.length" class="bg-transparent">
      <v-list-item
        v-for="it in items"
        :key="it.guid"
        class="later-row mb-1"
        rounded="xl"
        @click="playItem(it)"
      >
        <template #prepend>
          <QueuedImage :src="it.artwork" aspect="1/1" radius="8px" class="later-cover mr-3" />
        </template>
        <v-list-item-title class="font-weight-medium">{{ it.title }}</v-list-item-title>
        <v-list-item-subtitle>{{ it.podcastTitle }} · {{ timeAgo(it.addedAt) }}</v-list-item-subtitle>
        <template #append>
          <v-btn icon="mdi-play" variant="text" color="primary" @click.stop="playItem(it)" />
          <v-btn icon="mdi-bookmark-remove-outline" variant="text" @click.stop="remove(it.guid)" />
        </template>
      </v-list-item>
    </v-list>

    <div v-else class="text-center text-medium-emphasis mt-12">
      <v-icon icon="mdi-bookmark-outline" size="64" class="mb-4" />
      <div>稍后听列表是空的</div>
      <div class="mt-2 text-caption">在单集旁点书签图标即可加入</div>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { timeAgo } from '../api'
import QueuedImage from '../components/QueuedImage.vue'
import { getLater, removeLater, type LaterItem } from '../library'
import type { Episode } from '../models'
import { usePlayerStore } from '../stores/player'

const player = usePlayerStore()
const items = ref<LaterItem[]>([])

function refresh() {
  items.value = getLater()
}

/** 稍后听条目只有基础元数据 (无章节), 直接播; 想看章节可进播客详情页 */
function playItem(it: LaterItem) {
  const ep: Episode = {
    guid: it.guid,
    title: it.title,
    description: '',
    pubDate: '',
    duration: 0,
    audioUrl: it.audioUrl,
    artwork: it.artwork,
    podcastTitle: it.podcastTitle,
    podcastAuthor: '',
    podcastKey: it.podcastKey,
    feedUrl: it.feedUrl,
    chapters: [],
  }
  if (player.current?.guid === it.guid) player.toggle()
  else player.playEpisode(ep)
}

function remove(guid: string) {
  removeLater(guid)
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.later-row {
  cursor: pointer;
}
.later-row:hover {
  background: rgba(128, 128, 128, 0.08);
}
.later-cover {
  width: 52px;
}
</style>
