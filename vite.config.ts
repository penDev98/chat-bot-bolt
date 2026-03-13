import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
    '/api/property-offer': {
      target: 'https://100imoti-fe.vercel.app',
      changeOrigin: true,
      secure: false,
    }
    }
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
