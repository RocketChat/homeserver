import type { PersistentEventBase } from '../manager/event-wrapper';
import { type EventID } from '../types/_common';

export const RejectCodes = {
	AuthError: 'auth_error',
	ValidationError: 'validation_error',
	NotImplemented: 'not_implemented',
} as const;

export type RejectCode = (typeof RejectCodes)[keyof typeof RejectCodes];

class StateResolverAuthorizationError extends Error {
	name = 'StateResolverAuthorizationError';

	reason: string;

	rejectedBy?: EventID;

	constructor(
		public code: RejectCode,
		{
			rejectedEvent,
			reason,
			rejectedBy,
		}: {
			rejectedEvent: PersistentEventBase<any, any>;
			reason: string;
			rejectedBy?: PersistentEventBase<any, any>;
		},
	) {
		// build the message
		let message = `${code}: ${rejectedEvent.toStrippedJson()} failed authorization check`;

		if (rejectedBy) {
			message += ` against auth event ${rejectedBy.toStrippedJson()}`;
		}

		message += `: ${reason}`;

		super(message);

		this.reason = reason;

		this.rejectedBy = rejectedBy?.eventId;
	}
}

export { StateResolverAuthorizationError };
