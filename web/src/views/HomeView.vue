<template>
  <v-container>
    <div class="d-flex align-center mb-4">
      <h2 class="text-h5 font-weight-bold">推荐播客</h2>
      <v-spacer />
      <v-btn variant="text" color="primary" to="/charts">
        查看排行榜
        <v-icon icon="mdi-chevron-right" />
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-row v-if="loading">
      <v-col v-for="n in 10" :key="n" cols="6" sm="4" md="3" class="pod-col">
        <v-skeleton-loader type="image, text" />
      </v-col>
    </v-row>

    <v-row v-else>
      <v-col
        v-for="p in podcasts"
        :key="p.collectionId"
        cols="6"
        sm="4"
        md="3"
        class="pod-col"
      >
        <PodcastCard
          :title="p.collectionName"
          :author="p.artistName"
          :artwork="p.artworkUrl600"
          @open="$router.push(`/podcast/${p.collectionId}`)"
        />
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { backend, type ChartItem } from '../api'
import { settings } from '../settings'
import PodcastCard from '../components/PodcastCard.vue'

const podcasts = ref<ChartItem[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    podcasts.value = (await backend.charts(settings.country, 0, 12)).slice(0, 12)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => settings.country, load)
</script>

<style scoped>
/* 桌面端 5 列: 2(手机) → 3(sm) → 4(md) → 5(≥1280px) */
@media (min-width: 1280px) {
  .pod-col {
    flex: 0 0 20%;
    max-width: 20%;
  }
}
</style>
