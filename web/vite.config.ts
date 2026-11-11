import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the Go API and the Flue agent service are proxied like nginx does in Docker.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_PROXY ?? 'http://localhost:8080', changeOrigin: true },
      '/agents': { target: process.env.AGENT_PROXY ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
});
