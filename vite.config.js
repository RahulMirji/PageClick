import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react()],
  base: "",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        sidebar: resolve(__dirname, "sidebar.html"),
        options: resolve(__dirname, "options.html"),
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content/capture-dom.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-markdown": ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
  publicDir: "public",
});
