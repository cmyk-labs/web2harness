import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome138",
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
    fs: {
      allow: [
        searchForWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url))),
        fileURLToPath(new URL("../assets", import.meta.url)),
      ],
    },
    watch: {
      ignored: ["**/build/**", "**/release/**"],
    },
  },
});
