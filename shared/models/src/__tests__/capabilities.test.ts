import { describe, expect, it } from 'vitest';
import { getProviderCapabilities, isValidProviderType } from '../capabilities';

describe('provider capabilities', () => {
	it('recognizes Google as a supported provider type', () => {
		expect(isValidProviderType('google')).toBe(true);
		expect(isValidProviderType('google-vertex')).toBe(false);
	});

	it('exposes Google thinking as off at the Genii capability boundary', () => {
		expect(getProviderCapabilities('google')).toEqual({
			supportedThinkingLevels: ['off'],
			defaultThinkingLevel: 'off',
		});
	});
});
