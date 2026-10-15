<template>
  <v-container>
    <div class="d-flex align-center mb-4">
      <h2 class="text-h5 font-weight-bold">订阅</h2>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-rss" @click="dialog = true">添加 RSS</v-btn>
    </div>

    <v-row v-if="subs.length">
      <v-col v-for="s in subs" :key="s.key" cols="6" sm="4" md="3" class="pod-col">
        <PodcastCard
          :title="s.title"
          :author="s.author"
          :artwork="s.artwork"
          @open="openPodcast(s)"
        />
        <div class="d-flex justify-end">
          <v-btn
            size="small"
            variant="text"
            color="error"
            prepend-icon="mdi-delete-outline"
            @click="remove(s.key)"
          >
            取消订阅
          </v-btn>
        </div>
      </v-col>
    </v-row>
    <div v-else class="text-center text-medium-emphasis mt-12">
      <v-icon icon="mdi-rss" size="64" class="mb-4" />
      <div>还没有订阅, 去发现页找感兴趣的播客吧</div>
      <div class="mt-2 text-caption">也可以手动粘贴 RSS 地址添加</div>
    </div>

    <!-- 手动添加 RSS -->
    <v-dialog v-model="dialog" max-width="480">
      <v-card title="添加 RSS 播客">
        <v-card-text>
          <v-text-field
            v-model="feedUrl"
            label="RSS 地址"
            placeholder="https://example.com/feed.xml"
            prepend-inner-icon="mdi-rss"
            clearable
            :error-messages="feedError"
            @keyup.enter="preview"
          />
          <v-alert v-if="previewError" type="error" variant="tonal" density="compact" class="mt-2">
            {{ previewError }}
          </v-alert>
          <div v-if="previewFeed" class="d-flex align-center gap-3 mt-2">
            <QueuedImage :src="previewFeed.image" aspect="1/1" radius="8px" class="prev-cover" />
            <div class="min-w-0">
              <div class="font-weight-medium text-truncate">{{ previewFeed.title }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ previewFeed.episodes.length }} 期节目
              </div>
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeDialog">取消</v-btn>
          <v-btn v-if="!previewFeed" color="primary" :loading="previewing" @click="preview">
            解析
          </v-btn>
          <v-btn v-else color="primary" @click="confirmSubscribe">订阅</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { backend, type RssFeed } from '../api'
import PodcastCard from '../components/PodcastCard.vue'
import QueuedImage from '../components/QueuedImage.vue'
import {
  getSubscriptions,
  isSubscribed,
  subscribe,
  subscriptionKeyFor,
  unsubscribe,
  type Subscription,
} from '../library'

const router = useRouter()
const subs = ref<Subscription[]>([])
const dialog = ref(false)
const feedUrl = ref('')
const feedError = ref('')
const previewError = ref('')
const previewing = ref(false)
const previewFeed = ref<RssFeed | null>(null)

function refresh() {
  subs.value = getSubscriptions()
}

function openPodcast(s: Subscription) {
  // 手动 RSS 顺手把 feedUrl 带上, 免得详情页再查
  const query = s.key.startsWith('rss:') ? { feed: s.feedUrl } : {}
  router.push({ path: `/podcast/${s.key}`, query })
}

function remove(key: string) {
  unsubscribe(key)
  refresh()
}

function closeDialog() {
  dialog.value = false
  feedUrl.value = ''
  feedError.value = ''
  previewError.value = ''
  previewFeed.value = null
}

async function preview() {
  const url = feedUrl.value.trim()
  if (!/^https?:\/\//i.test(url)) {
    feedError.value = '请输入有效的 http(s) 地址'
    return
  }
  feedError.value = ''
  previewError.value = ''
  previewFeed.value = null
  previewing.value = true
  try {
    previewFeed.value = await backend.rss(url)
  } catch (e) {
    previewError.value = e instanceof Error ? e.message : '解析失败'
  } finally {
    previewing.value = false
  }
}

function confirmSubscribe() {
  const url = feedUrl.value.trim()
  const feed = previewFeed.value
  if (!feed) return
  const key = subscriptionKeyFor(url)
  if (!isSubscribed(key)) {
    subscribe({ key, feedUrl: url, title: feed.title, author: '', artwork: feed.image })
  }
  closeDialog()
  refresh()
  router.push({ path: `/podcast/${key}`, query: { feed: url } })
}

onMounted(refresh)
</script>

<style scoped>
@media (min-width: 1280px) {
  .pod-col {
    flex: 0 0 20%;
    max-width: 20%;
  }
}
.prev-cover {
  width: 56px;
}
.min-w-0 {
  min-width: 0;
}
.gap-3 {
  gap: 12px;
}
</style>
