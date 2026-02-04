/**
 * Binary entry point for the genii CLI.
 * @module bin/genii
 *
 * Note: The shebang (#!/usr/bin/env node) is added by tsup during build.
 */

import { program } from '../src/index';

program.parse(process.argv);
