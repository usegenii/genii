import { spawn } from 'node:child_process';

/**
 * Options for shell command execution.
 */
export interface ShellExecutorOptions {
	/** The command to execute */
	command: string;
	/** Working directory for the command */
	workingDirectory: string;
	/** Timeout in milliseconds */
	timeout: number;
	/** Abort signal for cancellation */
	signal: AbortSignal;
	/** Shell to use (e.g., '/bin/bash', '/bin/sh') */
	shell: string;
}

/**
 * Result of shell command execution.
 */
export interface ShellExecutorResult {
	/** Standard output from the command */
	stdout: string;
	/** Standard error from the command */
	stderr: string;
	/** Exit code of the command (124 for timeout) */
	exitCode: number;
	/** Whether the command timed out */
	timedOut: boolean;
}

/**
 * Execute a shell command with timeout and abort signal support.
 *
 * @param options - Execution options
 * @returns Result of the execution
 */
export async function executeShellCommand(options: ShellExecutorOptions): Promise<ShellExecutorResult> {
	const { command, workingDirectory, timeout, signal, shell } = options;

	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		let resolved = false;

		// Create timeout signal
		const timeoutSignal = AbortSignal.timeout(timeout);

		// Combine context signal with timeout signal
		const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

		const child = spawn(shell, ['-c', command], {
			cwd: workingDirectory,
			env: process.env,
			detached: true,
		});

		child.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		child.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		const killProcessGroup = (signal: NodeJS.Signals) => {
			if (child.pid === undefined) {
				return;
			}
			try {
				// Kill the entire process group (negative PID)
				process.kill(-child.pid, signal);
			} catch (err) {
				// ESRCH means process already exited, which is fine
				if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
					// Fallback to killing just the child
					child.kill(signal);
				}
			}
		};

		const handleAbort = () => {
			if (!resolved) {
				timedOut = true;
				killProcessGroup('SIGTERM');
				// Give process time to terminate gracefully, then force kill
				setTimeout(() => {
					if (!resolved) {
						killProcessGroup('SIGKILL');
					}
				}, 1000);
			}
		};

		combinedSignal.addEventListener('abort', handleAbort);

		child.on('close', (code) => {
			if (resolved) return;
			resolved = true;
			combinedSignal.removeEventListener('abort', handleAbort);
			resolve({
				stdout,
				stderr,
				exitCode: code ?? (timedOut ? 124 : 1),
				timedOut,
			});
		});

		child.on('error', (err) => {
			if (resolved) return;
			resolved = true;
			combinedSignal.removeEventListener('abort', handleAbort);

			if (err.name === 'AbortError') {
				timedOut = true;
			}

			resolve({
				stdout,
				stderr: stderr || err.message,
				exitCode: timedOut ? 124 : 1,
				timedOut,
			});
		});

		// Check if already aborted
		if (combinedSignal.aborted) {
			handleAbort();
		}
	});
}
