import { defineConfig } from 'tsup';

export default defineConfig({
	entry: {
		daemon: 'bin/daemon.ts',
		index: 'src/index.ts',
	},
	outDir: 'dist',
	format: ['esm'],
	platform: 'node',
	target: 'node20',
	bundle: true,
	splitting: false,
	dts: false,
	sourcemap: true,
	clean: true,
	treeshake: true,
	minify: false,
	banner: {
		js: '#!/usr/bin/env node',
	},
	// Don't bundle dependencies - they're installed via npm
	external: [/^[^./]/],
});
