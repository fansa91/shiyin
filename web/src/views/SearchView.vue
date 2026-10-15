<template>
  <v-container>
    <v-text-field
      v-model="q"
      label="搜索播客"
      prepend-inner-icon="mdi-magnify"
      clearable
      density="comfortable"
      hint="iTunes 播客目录, 按回车搜索"
      persistent-hint
      @keyup.enter="doSearch"
      @click:clear="results = []"
    >
      <template #append>
        <v-btn color="primary" :loading="loading" @click="doSearch">搜索</v-btn>
      </template>
    </v-text-field>

    <v-alert v-if="error" type="error" variant="tonal" class="mt-4">{{ error }}</v-alert>

    <v-row v-if="loading" class="mt-2">
      <v-col v-for="n in 10" :key="n" cols="6" sm="4" md="3" class="pod-col">
        <v-skeleton-loader type="image, text" />
      </v-col>
    </v-row>

    <template v-else-if="searched">
      <div class="text-caption text-medium-emphasis my-3">找到 {{ results.length }} 个播客</div>
      <v-row>
        <v-col v-for="p in results" :key="p.collectionId" cols="6" sm="4" md="3" class="pod-col">
          <PodcastCard
            :title="p.collectionName"
            :author="p.artistName"
            :artwork="artwork(p.artworkUrl600 || p.artworkUrl100)"
            @open="$router.push(`/podcast/${p.collectionId}`)"
          />
        </v-col>
      </v-row>
      <v-alert v-if="!results.length" type="info" variant="tonal" class="mt-4">
        没有搜到结果, 换个关键词试试
      </v-alert>
    </template>

    <div v-else class="text-center text-medium-emphasis mt-12">
      <v-icon icon="mdi-podcast" size="64" class="mb-4" />
      <div>输入关键词搜索全网播客</div>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { artwork, itunes, type ITunesPodcast } from '../api'
import { settings } from '../settings'
import PodcastCard from '../components/PodcastCard.vue'

const q = ref('')
const results = ref<ITunesPodcast[]>([])
const loading = ref(false)
const searched = ref(false)
const error = ref('')

async function doSearch() {
  const term = q.value.trim()
  if (!term) return
  loading.value = true
  error.value = ''
  try {
    const r = await itunes.search(term, settings.country, 25)
    results.value = r.results
    searched.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : '搜索失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
@media (min-width: 1280px) {
  .pod-col {
    flex: 0 0 20%;
    max-width: 20%;
  }
}
</style>
