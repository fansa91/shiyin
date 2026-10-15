<template>
  <v-card class="podcast-card" elevation="0" @click="$emit('open')">
    <QueuedImage :src="artwork" aspect="1/1" radius="12px" />
    <div class="pa-2">
      <div class="text-body-2 font-weight-medium text-truncate-2">{{ title }}</div>
      <div class="text-caption text-medium-emphasis text-truncate">{{ author }}</div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import QueuedImage from './QueuedImage.vue'

defineProps<{
  title: string
  author: string
  artwork: string
}>()

defineEmits<{ open: [] }>()
</script>

<style scoped>
.podcast-card {
  cursor: pointer;
  background: transparent;
}
.podcast-card:hover :deep(.queued-img) {
  filter: brightness(0.92);
}
.text-truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.5em;
}
</style>
