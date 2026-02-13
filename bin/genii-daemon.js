#!/usr/bin/env node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const entry = pathToFileURL(require.resolve('@genii/daemon/daemon'));
await import(entry);
