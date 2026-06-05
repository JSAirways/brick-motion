import path from "node:path";
import os from "node:os";

import { defineConfig } from "vite";

// Keep Vite's optimize cache outside `node_modules/.vite` — on Windows + OneDrive,
// `rmdir node_modules/.vite/deps` often hits EPERM when the folder is synced or locked.
const viteCacheDir = path.join(os.tmpdir(), "brick-motion-vite");

export default defineConfig({
  base: "./",
  cacheDir: viteCacheDir,
  build: {
    outDir: "dist-renderer"
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
