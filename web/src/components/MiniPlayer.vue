<template>
  <v-slide-y-reverse-transition>
    <div v-if="player.current" class="mini-player" @click="player.expanded = true">
      <QueuedImage :src="player.current.artwork" aspect="1/1" radius="8px" class="mini-cover" />
      <div class="flex-1-1 min-w-0 px-3">
        <div class="text-body-2 font-weight-medium text-truncate">{{ player.current.title }}</div>
        <div class="text-caption text-medium-emphasis text-truncate">
          {{ player.current.podcastAuthor || player.current.podcastTitle }}
        </div>
        <v-progress-linear
          :model-value="player.progress * 100"
          color="primary"
          height="2"
          class="mt-1"
        />
      </div>
      <v-btn
        :icon="player.isPlaying ? 'mdi-pause' : 'mdi-play'"
        variant="text"
        size="large"
        @click.stop="player.toggle()"
      />
    </div>
  </v-slide-y-reverse-transition>
</template>

<script setup lang="ts">
import { usePlayerStore } from '../stores/player'
import QueuedImage from './QueuedImage.vue'

const player = usePlayerStore()
</script>

<style scoped>
.mini-player {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 1005;
  display: flex;
  align-items: center;
  padding: 8px 8px 8px 8px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-container-high));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}
.mini-cover {
  width: 48px;
}
.min-w-0 {
  min-width: 0;
}
/* 移动端底栏导航之上留出空间 */
@media (max-width: 959px) {
  .mini-player {
    bottom: 76px;
  }
}
</style>
