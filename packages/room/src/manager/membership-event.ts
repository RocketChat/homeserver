import type { PersistentEventBase } from './event-wrapper';

class MembershipEvent {
	constructor(private readonly event: PersistentEventBase) {}

	get sender() {
		return this.event.sender;
	}
}

export { MembershipEvent };
