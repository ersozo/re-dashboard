import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/units': 'http://localhost:8000',
      '/report-data': 'http://localhost:8000',
      '/historical-data': 'http://localhost:8000',
      '/historical-hourly-data': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
