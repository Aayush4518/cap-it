import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/api1": {
        target: process.env.VITE_API1_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/api1/, ""),
      },
      "/api/api2": {
        target: process.env.VITE_API2_TARGET ?? "http://localhost:3002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/api2/, ""),
      },
      "/load-runner": {
        target: process.env.LOAD_RUNNER_TARGET ?? "http://127.0.0.1:3100",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/load-runner/, ""),
      },
    },
  },
});
