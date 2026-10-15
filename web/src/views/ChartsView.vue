<template>
  <v-container>
    <div class="d-flex align-center flex-wrap gap-3 mb-4">
      <h2 class="text-h5 font-weight-bold">排行榜</h2>
      <v-spacer />
      <v-select
        v-model="country"
        :items="COUNTRIES"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 140px"
      />
      <v-select
        v-model="genre"
        :items="genreItems"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 160px"
      />
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-list v-if="loading" class="bg-transparent">
      <v-skeleton-loader v-for="n in 8" :key="n" type="list-item-avatar-two-line" class="mb-1" />
    </v-list>

    <v-list v-else class="bg-transparent">
      <v-list-item
        v-for="(p, i) in charts"
        :key="p.collectionId"
        class="chart-row mb-1"
        rounded="xl"
        @click="$router.push(`/podcast/${p.collectionId}`)"
      >
        <template #prepend>
          <span class="rank text-h6 font-weight-bold mr-3" :class="{ 'text-primary': i < 3 }">
            {{ i + 1 }}
          </span>
          <QueuedImage :src="p.artworkUrl600" aspect="1/1" radius="8px" class="chart-cover mr-3" />
        </template>
        <v-list-item-title class="font-weight-medium">{{ p.collectionName }}</v-list-item-title>
        <v-list-item-subtitle>{{ p.artistName }}</v-list-item-subtitle>
        <template #append>
          <v-icon icon="mdi-chevron-right" />
        </template>
      </v-list-item>
    </v-list>
  </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { backend, type ChartItem, type Genre } from '../api'
import { COUNTRIES, settings } from '../settings'
import QueuedImage from '../components/QueuedImage.vue'

const route = useRoute()
const charts = ref<ChartItem[]>([])
const genres = ref<Genre[]>([])
const loading = ref(true)
const error = ref('')

const country = ref(settings.country)
// 分类页带 ?genre= 跳转过来
const genre = ref(Number(route.query.genre ?? 0))

const genreItems = computed(() => [
  { value: 0, title: '全部' },
  ...genres.value.map((g) => ({ value: g.id, title: g.name })),
])

async function loadGenres() {
  try {
    genres.value = await backend.genres()
  } catch {
    /* 排行榜照常可用, 分类筛选降级 */
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    charts.value = await backend.charts(country.value, genre.value, 50)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadGenres()
  await load()
})

// 选择器变化同步回全局设置 (搜索/首页共用地区)
watch(country, (v) => {
  settings.country = v
  load()
})
watch(genre, load)
watch(
  () => route.query.genre,
  (g) => {
    genre.value = Number(g ?? 0)
  },
)
</script>

<style scoped>
.chart-row {
  cursor: pointer;
}
.chart-row:hover {
  background: rgba(128, 128, 128, 0.08);
}
.rank {
  min-width: 32px;
  text-align: center;
}
.chart-cover {
  width: 56px;
}
.gap-3 {
  gap: 12px;
}
</style>
