import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Declarations are emitted into dist/ by tsc before vite runs.
    emptyOutDir: false,
    lib: {
      entry: { markompose: "src/index.ts", lezer: "src/lezer.ts" },
      formats: ["es"],
    },
    rollupOptions: {
      // Lezer is a peer dependency of markompose/lezer. The composer is shared
      // between the entries, so both see the same element and its languages.
      external: [/^@lezer\//],
    },
  },
});
