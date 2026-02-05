import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['templates/index.ts'],
	outDir: 'dist',
	format: ['esm'],
	platform: 'node',
	target: 'node20',
	bundle: false,
	splitting: false,
	dts: true,
	sourcemap: true,
	clean: true,
	treeshake: false,
});
