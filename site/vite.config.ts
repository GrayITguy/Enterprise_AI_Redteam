import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "vendor", test: /node_modules[\\/](react|react-dom|react-router)[\\/]/ },
            { name: "charts", test: /node_modules[\\/]recharts[\\/]/ },
            { name: "query", test: /node_modules[\\/]@tanstack[\\/]react-query[\\/]/ },
          ],
        },
      },
    },
  },
});
