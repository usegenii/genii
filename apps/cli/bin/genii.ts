#!/usr/bin/env node
/**
 * Binary entry point for the genii CLI.
 * @module bin/genii
 */

import { program } from '../src/index';

program.parse(process.argv);
