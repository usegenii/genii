/**
 * Inbound filter types for filtering incoming updates.
 */

/**
 * Interface for filtering inbound updates before processing.
 *
 * Filters can be used to restrict which updates are processed
 * based on user ID, chat type, or other criteria.
 */
export interface InboundFilter<TUpdate = unknown> {
	/**
	 * Determine if an update should be processed.
	 *
	 * @param update - The inbound update to check
	 * @returns true if the update should be processed, false otherwise
	 */
	shouldProcess(update: TUpdate): boolean;
}
