import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    external: ['react'],
  },
  {
    // React hooks ship the "use client" directive so Next.js App Router treats
    // the module as a client boundary.
    entry: { 'react/index': 'src/react/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    sourcemap: true,
    treeshake: true,
    external: ['react'],
    banner: { js: '"use client";' },
  },
]);
