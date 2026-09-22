import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import pkg from "./package.json" with { type: "json" };
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// `--mode web` builds the browser version (see docs/WEB.md); any other mode is the Tauri app.
export default defineConfig(({ mode }) => {
  const web = mode === "web";
  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        "@platform": web ? "/src/platform/web/index.ts" : "/src/platform/tauri.ts",
      },
    },

    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },

    build: {
      outDir: web ? "dist-web" : "dist",
    },

    worker: {
      format: "es" as const,
    },

    // sqlite-wasm locates its .wasm file relative to its own module; pre-bundling breaks that.
    optimizeDeps: {
      exclude: ["@sqlite.org/sqlite-wasm"],
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: web ? 5173 : 1420,
      strictPort: !web,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
