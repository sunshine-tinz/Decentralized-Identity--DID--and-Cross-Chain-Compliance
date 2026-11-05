/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: ["@stellar-did/sdk"],
  },
  build: {
    commonjsOptions: {
      include: [/sdk/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
