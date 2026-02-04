/**
 * Daemon start command and command group registration.
 * @module commands/daemon/start
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { createDaemonClient, getSocketPath } from "../../client";
import { getFormatter, getOutputFormat } from "../../output/formatter";
import { createSpinner } from "../../utils/spinner";
import { logsCommand } from "./logs";
import { reloadCommand } from "./reload";
import { statusCommand } from "./status";
import { stopCommand } from "./stop";

/**
 * Check if the daemon is already running by attempting to ping it.
 */
async function isDaemonRunning(): Promise<boolean> {
  const client = createDaemonClient();
  try {
    await client.connect();
    await client.ping();
    await client.disconnect();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the daemon to become available.
 */
async function waitForDaemon(timeoutMs: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeoutMs) {
    if (await isDaemonRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

/**
 * Get the path to the daemon entry script.
 */
function getDaemonEntryPath(): string {
  // Get the path relative to CLI package
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // Navigate from apps/cli/src/commands/daemon to apps/daemon/src
  return resolve(
    currentDir,
    "..",
    "..",
    "..",
    "..",
    "daemon",
    "src",
    "index.ts",
  );
}

interface StartOptions {
  foreground?: boolean;
  background?: boolean;
  data?: string;
  guidance?: string;
  pidFile?: string;
  logFile?: string;
}

/**
 * Start the Genii daemon.
 */
export function startCommand(daemon: Command): void {
  daemon
    .command("start")
    .description("Start the Genii daemon")
    .option("-f, --foreground", "Run in foreground (do not daemonize)")
    .option("-b, --background", "Run in background (default)")
    .option(
      "-d, --data <path>",
      "Path to data directory (config, conversations, snapshots, guidance)",
    )
    .option(
      "-g, --guidance <path>",
      "Override guidance directory (defaults to {data}/guidance)",
    )
    .option("--pid-file <path>", "Path to PID file")
    .option("--log-file <path>", "Path to log file")
    .action(async (options: StartOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const format = getOutputFormat(globalOpts);
      const formatter = getFormatter(format);

      // Check if daemon is already running
      const running = await isDaemonRunning();
      if (running) {
        formatter.message("Daemon is already running", "info");
        return;
      }

      // Foreground mode: run in current process (not implemented yet)
      if (options.foreground) {
        formatter.message("Starting daemon in foreground...", "info");
        formatter.error(
          "Foreground mode not yet implemented. Use background mode.",
        );
        process.exit(1);
      }

      // Background mode (default)
      const spinner = createSpinner({ text: "Starting daemon..." });
      spinner.start();

      try {
        const daemonEntry = getDaemonEntryPath();
        const socketPath = getSocketPath();

        // Build environment for the daemon process
        const env = {
          ...process.env,
          GENII_SOCKET: socketPath,
          ...(options.data && { GENII_DATA: options.data }),
          ...(options.guidance && { GENII_GUIDANCE: options.guidance }),
          ...(options.pidFile && { GENII_PID_FILE: options.pidFile }),
          ...(options.logFile && { GENII_LOG_FILE: options.logFile }),
        };

        // Spawn the daemon process detached
        const child = spawn(
          process.execPath,
          ["--import", "tsx", daemonEntry],
          {
            detached: true,
            stdio: "ignore",
            env,
          },
        );

        // Unref so parent can exit
        child.unref();

        // Wait for daemon to become available
        const started = await waitForDaemon(5000);

        if (started) {
          spinner.succeed("Daemon started successfully");
          if (format === "json") {
            formatter.success({ started: true, pid: child.pid });
          }
        } else {
          spinner.fail("Daemon failed to start");
          formatter.error("Daemon process started but is not responding");
          process.exit(1);
        }
      } catch (error) {
        spinner.fail("Failed to start daemon");
        formatter.error(
          error instanceof Error ? error : new Error(String(error)),
        );
        process.exit(1);
      }
    });
}

/**
 * Register all daemon-related commands under the 'daemon' command group.
 */
export function registerDaemonCommands(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Manage the Genii daemon process");

  startCommand(daemon);
  stopCommand(daemon);
  statusCommand(daemon);
  logsCommand(daemon);
  reloadCommand(daemon);
}
