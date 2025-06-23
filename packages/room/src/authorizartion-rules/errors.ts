import type { PersistentEventBase } from "../manager/event-manager";

class StateResolverAuthorizationError extends Error {
	name = "StateResolverAuthorizationError";

	constructor(
		message: string,
		{
			eventFailed,
			reason,
		}: {
			eventFailed: PersistentEventBase;
			reason?: PersistentEventBase;
		},
	) {
		let error = `${message} for event ${eventFailed.eventId} in room ${eventFailed.roomId} type ${eventFailed.type} state_key ${eventFailed.stateKey}`;
		if (reason) {
			error += `, reason: ${reason.eventId} in room ${reason.roomId} type ${reason.type} state_key ${reason.stateKey}`;
		}
		super(error);
	}
}

export { StateResolverAuthorizationError };
