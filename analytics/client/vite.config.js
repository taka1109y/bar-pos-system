import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 分析サイト(analytics/client)の Vite 設定。
// 本番 client(5173)と衝突しないよう 5174 を使い、/api は analytics-server(3101)へプロキシする。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:3101',
    },
  },
  build: {
    // echarts(+zrender) 単体で 500KB を超えるため警告閾値を引き上げる(分離済みチャンクなので初回のみの読込)
    chunkSizeWarningLimit: 700,
    // echarts(+zrender) は単体で ~600KB あるためアプリ本体と分離してキャッシュ効率を上げる
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'echarts', test: /node_modules[\\/](echarts|zrender)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
})
