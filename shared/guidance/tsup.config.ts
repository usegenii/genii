import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['templates/index.ts'],
	outDir: 'templates',
	format: ['esm'],
	platform: 'node',
	target: 'node20',
	bundle: false,
	splitting: false,
	dts: true,
	sourcemap: true,
	clean: false, // Don't clean - we need to keep the .md files
	treeshake: false,
});
