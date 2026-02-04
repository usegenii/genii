import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/**/*.ts', '!src/**/*.test.ts'],
	outDir: 'dist',
	format: ['esm'],
	platform: 'node',
	target: 'node20',
	bundle: true,
	splitting: true,
	dts: true,
	sourcemap: true,
	clean: true,
	treeshake: true,
	// Don't bundle external npm packages or workspace packages
	external: [/^@genii\//, /^[^./]/],
});
