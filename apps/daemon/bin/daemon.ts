/**
 * Binary entry point for the geniigotchi daemon.
 * @module bin/daemon
 *
 * Note: The shebang (#!/usr/bin/env node) is added by tsup during build.
 */

import { main } from '../src/index';

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
