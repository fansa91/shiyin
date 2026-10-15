<template>
  <v-container>
    <v-btn variant="text" prepend-icon="mdi-arrow-left" class="mb-2" @click="$router.back()">
      返回
    </v-btn>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <template v-if="loading">
      <v-skeleton-loader type="article" />
      <v-skeleton-loader v-for="n in 5" :key="n" type="list-item-two-line" class="mt-2" />
    </template>

    <template v-else-if="podcast">
      <!-- 头图区 -->
      <div class="d-flex flex-column flex-sm-row gap-4 mb-4">
        <QueuedImage :src="podcast.artwork" aspect="1/1" radius="16px" class="hero-cover" />
        <div class="flex-1-1 min-w-0">
          <h2 class="text-h5 font-weight-bold">{{ podcast.title }}</h2>
          <div class="text-body-2 text-medium-emphasis mt-1">{{ podcast.author }}</div>
          <div class="text-caption text-medium-emphasis mt-1">{{ episodes.length }} 期节目</div>
          <div class="d-flex gap-2 mt-3">
            <v-btn
              :color="subscribed ? undefined : 'primary'"
              :variant="subscribed ? 'outlined' : 'flat'"
              :prepend-icon="subscribed ? 'mdi-check' : 'mdi-plus'"
              @click="toggleSubscribe"
            >
              {{ subscribed ? '已订阅' : '订阅' }}
            </v-btn>
            <v-btn
              v-if="episodes.length"
              variant="tonal"
              prepend-icon="mdi-play"
              @click="playAll"
            >
              全部播放
            </v-btn>
          </div>
        </div>
      </div>

      <!-- 简介 -->
      <v-card v-if="podcast.description" elevation="0" class="desc-card mb-4" color="surface-container">
        <v-card-text :class="{ 'desc-text': true, collapsed: !descOpen }">
          {{ podcast.description }}
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" size="small" @click="descOpen = !descOpen">
            {{ descOpen ? '收起' : '展开' }}
          </v-btn>
        </v-card-actions>
      </v-card>

      <!-- 单集列表 -->
      <h3 class="text-h6 font-weight-bold mb-2">单集</h3>
      <div v-if="!episodes.length" class="text-medium-emphasis my-6 text-center">
        暂无单集
      </div>
      <EpisodeRow
        v-for="ep in episodes"
        :key="ep.guid"
        :episode="ep"
        :is-current="player.current?.guid === ep.guid"
        :playing="player.isPlaying && player.current?.guid === ep.guid"
        :in-later="laterSet.has(ep.guid)"
        :entry="historyMap[ep.guid]"
        @play="onPlay(ep)"
        @toggle-later="onToggleLater(ep)"
      />
    </template>
  </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  artwork,
  backend,
  itunes,
  stripHtml,
  type ITunesEpisode,
} from '../api'
import EpisodeRow from '../components/EpisodeRow.vue'
import QueuedImage from '../components/QueuedImage.vue'
import {
  addLater,
  getHistoryEntry,
  isInLater,
  isSubscribed,
  removeLater,
  subscribe,
  unsubscribe,
  subscriptionKeyFor,
  getSubscriptions,
} from '../library'
import { rssKey, toEpisode, type Episode, type Podcast } from '../models'
import { settings } from '../settings'
import { usePlayerStore } from '../stores/player'

const route = useRoute()
const player = usePlayerStore()

const podcast = ref<Podcast | null>(null)
const episodes = ref<Episode[]>([])
const loading = ref(true)
const error = ref('')
const descOpen = ref(false)
const subscribed = ref(false)
const laterSet = ref<Set<string>>(new Set())

/** guid → 历史条目, 用于显示已播进度 */
const historyMap = computed(() => {
  const m: Record<string, ReturnType<typeof getHistoryEntry>> = {}
  for (const ep of episodes.value) {
    const e = getHistoryEntry(ep.guid)
    if (e) m[ep.guid] = e
  }
  return m
})

function refreshLaterSet() {
  const s = new Set<string>()
  for (const ep of episodes.value) {
    if (isInLater(ep.guid)) s.add(ep.guid)
  }
  laterSet.value = s
}

async function load() {
  loading.value = true
  error.value = ''
  podcast.value = null
  episodes.value = []
  const id = route.params.id as string
  try {
    if (/^\d+$/.test(id)) {
      await loadFromITunes(id)
    } else if (id.startsWith('rss:')) {
      await loadFromRssKey(id)
    } else {
      throw new Error('无效的播客 ID')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
    refreshLaterSet()
  }
}

/** iTunes 播客: lookup 拿 feedUrl → 后端 RSS 取全量单集+章节 */
async function loadFromITunes(id: string) {
  const show = await itunes.lookup(id, settings.country)
  const info = show.results[0]
  if (!info?.feedUrl) throw new Error('该播客未提供 RSS 源')
  const key = subscriptionKeyFor(info.feedUrl, info.collectionId)
  const pod: Podcast = {
    key,
    collectionId: info.collectionId,
    feedUrl: info.feedUrl,
    title: info.collectionName,
    author: info.artistName,
    artwork: artwork(info.artworkUrl600 || info.artworkUrl100),
    description: '',
  }
  let eps: Episode[] = []
  try {
    const feed = await backend.rss(info.feedUrl)
    pod.description = stripHtml(feed.description)
    if (!pod.artwork) pod.artwork = feed.image
    eps = feed.episodes.map((e) =>
      toEpisode(
        { ...e, description: stripHtml(e.description) },
        { key: pod.key, title: pod.title, author: pod.author, artwork: pod.artwork, feedUrl: pod.feedUrl },
      ),
    )
  } catch (e) {
    // RSS 失败 → iTunes 单集兜底 (无章节)
    console.warn('RSS 解析失败, 降级到 iTunes 单集:', e)
    eps = await itunesEpisodesFallback(id, pod)
  }
  podcast.value = pod
  episodes.value = eps
  subscribed.value = isSubscribed(pod.key)
}

/** iTunes 单集兜底 */
async function itunesEpisodesFallback(id: string, pod: Podcast): Promise<Episode[]> {
  const r = await itunes.episodes(id, settings.country)
  return (r.results.slice(1) as ITunesEpisode[])
    .filter((t) => t.episodeUrl)
    .map((t) =>
      toEpisode(
        {
          guid: String(t.trackId),
          title: t.trackName,
          description: stripHtml(t.description || t.shortDescription),
          pubDate: t.releaseDate,
          duration: Math.round((t.trackTimeMillis ?? 0) / 1000),
          audioUrl: t.episodeUrl!,
          image: artwork(t.artworkUrl600 || t.artworkUrl160),
          chapters: [],
        },
        { key: pod.key, title: pod.title, author: pod.author, artwork: pod.artwork, feedUrl: pod.feedUrl },
      ),
    )
}

/** 手动 RSS: id 为 'rss:' + feedUrl 哈希, feedUrl 从 query 或订阅里取 */
async function loadFromRssKey(id: string) {
  const feedUrl =
    (route.query.feed as string) || getSubscriptions().find((s) => s.key === id)?.feedUrl
  if (!feedUrl) throw new Error('找不到该 RSS 源地址')
  // 哈希校验, 防止 query 被篡改串台
  if (rssKey(feedUrl) !== id) throw new Error('RSS 地址与 ID 不匹配')
  const feed = await backend.rss(feedUrl)
  const pod: Podcast = {
    key: id,
    feedUrl,
    title: feed.title,
    author: '',
    artwork: feed.image,
    description: stripHtml(feed.description),
  }
  podcast.value = pod
  episodes.value = feed.episodes.map((e) =>
    toEpisode(
      { ...e, description: stripHtml(e.description) },
      { key: pod.key, title: pod.title, author: pod.author, artwork: pod.artwork, feedUrl: pod.feedUrl },
    ),
  )
  subscribed.value = isSubscribed(pod.key)
}

function toggleSubscribe() {
  const pod = podcast.value
  if (!pod) return
  if (subscribed.value) {
    unsubscribe(pod.key)
    subscribed.value = false
  } else {
    subscribe({
      key: pod.key,
      feedUrl: pod.feedUrl,
      collectionId: pod.collectionId,
      title: pod.title,
      author: pod.author,
      artwork: pod.artwork,
    })
    subscribed.value = true
  }
}

function onPlay(ep: Episode) {
  if (player.current?.guid === ep.guid) {
    player.toggle()
    return
  }
  player.playEpisode(ep, episodes.value)
}

function playAll() {
  if (episodes.value.length) player.playEpisode(episodes.value[0], episodes.value)
}

function onToggleLater(ep: Episode) {
  if (isInLater(ep.guid)) {
    removeLater(ep.guid)
    laterSet.value.delete(ep.guid)
  } else {
    addLater({
      guid: ep.guid,
      title: ep.title,
      podcastTitle: ep.podcastTitle,
      artwork: ep.artwork,
      audioUrl: ep.audioUrl,
      podcastKey: ep.podcastKey,
      feedUrl: ep.feedUrl,
    })
    laterSet.value.add(ep.guid)
  }
}

onMounted(load)
watch(() => route.params.id, load)
watch(() => route.query.feed, load)
</script>

<style scoped>
.hero-cover {
  width: 160px;
}
@media (max-width: 599px) {
  .hero-cover {
    width: 120px;
  }
}
.min-w-0 {
  min-width: 0;
}
.gap-4 {
  gap: 16px;
}
.gap-2 {
  gap: 8px;
}
.desc-card {
  border-radius: 16px;
}
.desc-text {
  white-space: pre-line;
}
.desc-text.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
