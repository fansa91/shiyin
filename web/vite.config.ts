import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  server: {
    // 本地开发时把 /api 转发到后端, 生产环境由 Caddy 反代
    proxy: { '/api': 'http://localhost:3000' },
  },
})
