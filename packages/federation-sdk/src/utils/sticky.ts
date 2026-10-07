// MSC4354 sticky events, under the unstable names in use on the wire
export const STICKY_EVENT_FIELD = 'msc4354_sticky';

export const MAX_STICKY_DURATION_MS = 3_600_000;

type MaybeStickyPdu = {
	origin_server_ts: number;
	state_key?: unknown;
	[STICKY_EVENT_FIELD]?: unknown;
};

// how long the sender asked the event to stay sticky, or undefined when it is not a sticky event
export function getStickyDurationMs(pdu: MaybeStickyPdu): number | undefined {
	// only message events can be sticky
	if ('state_key' in pdu) {
		return undefined;
	}

	const sticky = pdu[STICKY_EVENT_FIELD];
	if (typeof sticky !== 'object' || sticky === null) {
		return undefined;
	}

	const { duration_ms: durationMs } = sticky as { duration_ms?: unknown };
	if (typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs < 0) {
		return undefined;
	}

	return durationMs;
}

// until when the event stays sticky for this server, which received it at `receivedAt`;
// undefined when it is not sticky, or already was not by the time it arrived
export function getStickyExpiresAt(pdu: MaybeStickyPdu, receivedAt: number): number | undefined {
	const durationMs = getStickyDurationMs(pdu);
	if (durationMs === undefined) {
		return undefined;
	}

	const expiresAt = Math.min(receivedAt, pdu.origin_server_ts) + Math.min(durationMs, MAX_STICKY_DURATION_MS);

	return expiresAt > receivedAt ? expiresAt : undefined;
}
