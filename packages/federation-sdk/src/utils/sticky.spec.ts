import { describe, expect, it } from 'bun:test';

import { MAX_STICKY_DURATION_MS, getStickyDurationMs, getStickyExpiresAt } from './sticky';

const SENT_AT = 1_700_000_000_000;

const pdu = (sticky: unknown, extra: Record<string, unknown> = {}) => ({
	origin_server_ts: SENT_AT,
	...(sticky !== undefined && { msc4354_sticky: sticky }),
	...extra,
});

describe('getStickyDurationMs', () => {
	it('reads the duration the sender asked for', () => {
		expect(getStickyDurationMs(pdu({ duration_ms: 110_000 }))).toBe(110_000);
	});

	it.each([
		['no sticky field', undefined],
		['a sticky field that is not an object', 3600],
		['a missing duration', {}],
		['a non-integer duration', { duration_ms: 1.5 }],
		['a duration given as a string', { duration_ms: '3600000' }],
		['a negative duration', { duration_ms: -1 }],
	])('treats an event with %s as not sticky', (_, sticky) => {
		expect(getStickyDurationMs(pdu(sticky))).toBeUndefined();
	});

	it('treats a state event as not sticky', () => {
		expect(getStickyDurationMs(pdu({ duration_ms: 110_000 }, { state_key: '' }))).toBeUndefined();
	});
});

describe('getStickyExpiresAt', () => {
	it('counts from the send time when the event arrives after it was sent', () => {
		expect(getStickyExpiresAt(pdu({ duration_ms: 110_000 }), SENT_AT + 2_000)).toBe(SENT_AT + 110_000);
	});

	it('counts from the receive time when the sender clock is ahead', () => {
		expect(getStickyExpiresAt(pdu({ duration_ms: 110_000 }), SENT_AT - 5_000)).toBe(SENT_AT - 5_000 + 110_000);
	});

	it('caps the duration at one hour', () => {
		expect(getStickyExpiresAt(pdu({ duration_ms: 10 * MAX_STICKY_DURATION_MS }), SENT_AT)).toBe(SENT_AT + MAX_STICKY_DURATION_MS);
	});

	it('treats an event that arrives after its stickiness ended as not sticky', () => {
		expect(getStickyExpiresAt(pdu({ duration_ms: 110_000 }), SENT_AT + 110_000)).toBeUndefined();
	});

	it('treats a zero duration as not sticky', () => {
		expect(getStickyExpiresAt(pdu({ duration_ms: 0 }), SENT_AT)).toBeUndefined();
	});

	it('treats an event without a valid duration as not sticky', () => {
		expect(getStickyExpiresAt(pdu({ duration_ms: -1 }), SENT_AT)).toBeUndefined();
	});
});
