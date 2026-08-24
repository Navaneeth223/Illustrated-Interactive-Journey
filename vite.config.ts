import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    target: "es2020",
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
