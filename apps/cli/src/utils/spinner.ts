/**
 * Spinner utilities for async operations.
 * @module utils/spinner
 */

// TODO: Implement with ora library

/**
 * Spinner instance interface.
 */
export interface Spinner {
	/** Start the spinner with a message */
	start(message?: string): void;
	/** Stop the spinner */
	stop(): void;
	/** Stop with success message */
	succeed(message?: string): void;
	/** Stop with failure message */
	fail(message?: string): void;
	/** Stop with warning message */
	warn(message?: string): void;
	/** Stop with info message */
	info(message?: string): void;
	/** Update the spinner text */
	text: string;
	/** Whether the spinner is currently spinning */
	isSpinning: boolean;
}

/**
 * Create a spinner for displaying progress.
 * @param options - Spinner options
 * @returns Spinner instance
 */
export function createSpinner(_options?: { text?: string }): Spinner {
	// TODO: Implement with ora
	// const spinner = ora(options);
	// return spinner;

	// Stub implementation
	let _text = _options?.text ?? '';
	let _spinning = false;

	return {
		start(message?: string) {
			if (message) _text = message;
			_spinning = true;
			console.log(`[*] ${_text}`);
		},
		stop() {
			_spinning = false;
		},
		succeed(message?: string) {
			_spinning = false;
			console.log(`[+] ${message ?? _text}`);
		},
		fail(message?: string) {
			_spinning = false;
			console.log(`[-] ${message ?? _text}`);
		},
		warn(message?: string) {
			_spinning = false;
			console.log(`[!] ${message ?? _text}`);
		},
		info(message?: string) {
			_spinning = false;
			console.log(`[i] ${message ?? _text}`);
		},
		get text() {
			return _text;
		},
		set text(value: string) {
			_text = value;
		},
		get isSpinning() {
			return _spinning;
		},
	};
}

/**
 * Run an async operation with a spinner.
 * @param operation - The async operation to run
 * @param options - Spinner options
 * @returns The result of the operation
 */
export async function withSpinner<T>(
	operation: () => Promise<T>,
	options: {
		text: string;
		successText?: string;
		failText?: string;
	},
): Promise<T> {
	const spinner = createSpinner({ text: options.text });
	spinner.start();

	try {
		const result = await operation();
		spinner.succeed(options.successText);
		return result;
	} catch (error) {
		spinner.fail(options.failText ?? `${options.text} failed`);
		throw error;
	}
}
