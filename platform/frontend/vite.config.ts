import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 本地开发时让浏览器始终请求同源 /api，由 Vite 转发到后端。
  // 避免 localhost / 127.0.0.1 / IPv6 或 CORS 差异在登录页只显示 Failed to fetch。
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    // 本地共享工作目录的文件事件可能丢失，轮询保证修改后的模块及时失效。
    watch: { usePolling: true, interval: 500 },
    proxy: {
      '/api': process.env.VITE_BACKEND_URL || 'http://127.0.0.1:3001',
      '/callback': process.env.VITE_BACKEND_URL || 'http://127.0.0.1:3001',
    },
  },
})
