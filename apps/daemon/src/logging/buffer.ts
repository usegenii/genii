import type { LogEntry, RpcLogLevel, RpcMethods } from '@genii/lib/rpc/methods';

export type LogFilter = RpcMethods['subscribe.logs'];
export type PendingLogEntry = Omit<LogEntry, 'sequence'>;
export type LogEntryListener = (entry: LogEntry) => void;

const DEFAULT_LOG_CAPACITY = 1_000;

const LOG_LEVEL_PRIORITY: Record<RpcLogLevel, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60,
};

function resolveSinceTimestamp(since: string | number | undefined, now: number): number | undefined {
	if (typeof since === 'number') {
		return since;
	}
	if (since === undefined) {
		return undefined;
	}

	const durationMatch = /^(\d+)(ms|s|m|h|d)$/.exec(since.trim());
	if (durationMatch) {
		const amount = Number(durationMatch[1]);
		const unit = durationMatch[2];
		const multiplier =
			unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
		return now - amount * multiplier;
	}

	const parsed = Date.parse(since);
	return Number.isNaN(parsed) ? undefined : parsed;
}

export function matchesLogFilter(entry: LogEntry, filter: LogFilter, now = Date.now()): boolean {
	if (filter.level && LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[filter.level]) {
		return false;
	}
	if (filter.component && entry.component !== filter.component) {
		return false;
	}

	const sinceTimestamp = resolveSinceTimestamp(filter.since, now);
	return sinceTimestamp === undefined || entry.timestamp >= sinceTimestamp;
}

export class LogBuffer {
	private readonly _capacity: number;
	private readonly _entries: LogEntry[] = [];
	private readonly _listeners = new Set<LogEntryListener>();
	private _nextSequence = 1;

	constructor(capacity = DEFAULT_LOG_CAPACITY) {
		if (!Number.isInteger(capacity) || capacity <= 0) {
			throw new Error('Log buffer capacity must be a positive integer');
		}
		this._capacity = capacity;
	}

	append(pending: PendingLogEntry): LogEntry {
		const entry: LogEntry = {
			...pending,
			sequence: this._nextSequence++,
		};
		this._entries.push(entry);
		if (this._entries.length > this._capacity) {
			this._entries.splice(0, this._entries.length - this._capacity);
		}

		for (const listener of this._listeners) {
			try {
				listener(entry);
			} catch {
				// A log consumer must never interfere with the daemon's logging path.
			}
		}
		return entry;
	}

	recent(filter: LogFilter = {}): LogEntry[] {
		const matches = this._entries.filter((entry) => matchesLogFilter(entry, filter));
		const requestedLimit = filter.limit ?? matches.length;
		const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.floor(requestedLimit)) : matches.length;
		return limit === 0 ? [] : matches.slice(-limit);
	}

	subscribe(listener: LogEntryListener): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	get size(): number {
		return this._entries.length;
	}
}

export function createLogBuffer(capacity?: number): LogBuffer {
	return new LogBuffer(capacity);
}
