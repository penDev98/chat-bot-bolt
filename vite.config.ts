import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/external': {
        target: 'https://100imoti-fe.vercel.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/external/, '/api'),
        secure: false,
      }
    }
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
