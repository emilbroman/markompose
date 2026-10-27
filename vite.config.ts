import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Declarations are emitted into dist/ by tsc before vite runs.
    emptyOutDir: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "markompose",
    },
  },
});
