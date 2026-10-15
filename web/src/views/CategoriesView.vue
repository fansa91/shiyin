<template>
  <v-container>
    <h2 class="text-h5 font-weight-bold mb-4">分类</h2>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-row v-if="loading">
      <v-col v-for="n in 12" :key="n" cols="6" sm="4" md="3">
        <v-skeleton-loader type="text" />
      </v-col>
    </v-row>

    <v-row v-else>
      <v-col v-for="(g, i) in genres" :key="g.id" cols="6" sm="4" md="3">
        <v-card
          class="genre-card pa-4 d-flex align-center"
          elevation="0"
          :style="{ background: cardColor(i) }"
          @click="$router.push({ path: '/charts', query: { genre: g.id } })"
        >
          <v-icon :icon="genreIcon(g.name)" class="mr-3" size="28" />
          <span class="text-subtitle-1 font-weight-medium">{{ g.name }}</span>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useTheme } from 'vuetify'
import { backend, type Genre } from '../api'

const theme = useTheme()
const genres = ref<Genre[]>([])
const loading = ref(true)
const error = ref('')

/** M3 tonal 色板轮换, 深浅主题自动适配 */
function cardColor(i: number): string {
  const dark = theme.global.name.value === 'dark'
  const tones = dark
    ? ['#4F378B', '#29394D', '#3D4A2C', '#4D2E3D', '#2C4A44', '#4A3A24']
    : ['#EADDFF', '#D9E7F5', '#DDEDC8', '#F5D9E3', '#C8EDE8', '#F0E2C8']
  return tones[i % tones.length]
}

function genreIcon(name: string): string {
  if (/新闻|时事/.test(name)) return 'mdi-newspaper'
  if (/喜剧|搞笑|幽默/.test(name)) return 'mdi-emoticon-laugh'
  if (/音乐/.test(name)) return 'mdi-music'
  if (/科技|技术/.test(name)) return 'mdi-laptop'
  if (/商业|财经|投资/.test(name)) return 'mdi-briefcase'
  if (/教育|学习|课程/.test(name)) return 'mdi-school'
  if (/历史/.test(name)) return 'mdi-history'
  if (/科学/.test(name)) return 'mdi-flask'
  if (/健康|健身/.test(name)) return 'mdi-heart-pulse'
  if (/运动|体育/.test(name)) return 'mdi-run'
  if (/故事|小说|文学/.test(name)) return 'mdi-book-open'
  if (/儿童|少儿/.test(name)) return 'mdi-teddy-bear'
  if (/电影|电视|影视/.test(name)) return 'mdi-movie'
  if (/游戏/.test(name)) return 'mdi-gamepad-variant'
  return 'mdi-tag'
}

onMounted(async () => {
  try {
    genres.value = await backend.genres()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.genre-card {
  cursor: pointer;
  border-radius: 16px;
  min-height: 76px;
}
.genre-card:hover {
  filter: brightness(0.94);
}
</style>
