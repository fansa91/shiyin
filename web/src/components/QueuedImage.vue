<template>
  <div ref="root" class="queued-img" :style="{ aspectRatio: aspect, borderRadius: radius }">
    <img v-if="shown" :src="shown" class="qi-img" draggable="false" alt="" />
    <div v-else class="qi-placeholder">
      <v-progress-circular v-if="pending" indeterminate :size="24" :width="2" />
      <v-icon v-else-if="failed" icon="mdi-image-off" />
      <v-icon v-else icon="mdi-podcast" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { imageQueue } from '../imageQueue'

const props = withDefaults(
  defineProps<{
    src: string
    /** 播客封面多为正方形 */
    aspect?: string
    radius?: string
  }>(),
  { aspect: '1/1', radius: '0' },
)

const root = ref<HTMLElement | null>(null)
const shown = ref('')
const failed = ref(false)
const pending = ref(false)
let observer: IntersectionObserver | null = null
let gen = 0

function preload(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => resolve(true)
    im.onerror = () => resolve(false)
    im.src = url
  })
}

function enqueue() {
  const g = gen
  const url = props.src
  if (!url || shown.value) return
  pending.value = true
  imageQueue.push(async () => {
    if (g !== gen) return
    const ok = await preload(url)
    if (g !== gen) return
    pending.value = false
    if (ok) shown.value = url
    else failed.value = true
  })
}

function disconnect() {
  observer?.disconnect()
  observer = null
}

function observe() {
  disconnect()
  if (!root.value || typeof IntersectionObserver === 'undefined') {
    enqueue()
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          disconnect()
          enqueue()
        }
      }
    },
    { rootMargin: '300px' },
  )
  observer.observe(root.value)
}

function reset() {
  gen++
  shown.value = ''
  failed.value = false
  pending.value = false
  observe()
}

watch(() => props.src, reset)

onMounted(observe)
onBeforeUnmount(() => {
  gen++
  disconnect()
})
</script>

<style scoped>
.queued-img {
  position: relative;
  overflow: hidden;
  background: rgba(128, 128, 128, 0.12);
  flex-shrink: 0;
}
.qi-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.qi-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(128, 128, 128, 0.6);
}
</style>
