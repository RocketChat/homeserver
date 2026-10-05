import { extractDomainFromId, RoomState } from '@rocket.chat/federation-room';
import type { EventID, Pdu, PersistentEventBase, State } from '@rocket.chat/federation-room';

/** The room data the relation checks read; the state service provides it. */
export interface EventLookup {
	getEvent(eventId: EventID): Promise<PersistentEventBase | null>;
	getStateBeforeEvent(event: PersistentEventBase): Promise<State>;
}

function getRelation(event: Readonly<Pdu>) {
	if (event.type === 'm.room.message' || event.type === 'm.room.encrypted') {
		return event.content['m.relates_to'];
	}
}

/**
 * Whether `replacement`, an `m.replace` edit, may replace `original` under the spec's validity rules
 * for replacement events: same room, sender and event type, neither of them a state event, and the
 * original not itself an edit.
 */
export function isValidReplacement(replacement: PersistentEventBase, original: PersistentEventBase | null): boolean {
	if (!original || original.rejected) {
		return false;
	}

	if (original.roomId !== replacement.roomId || original.sender !== replacement.sender || original.type !== replacement.type) {
		return false;
	}

	if (original.isState() || replacement.isState()) {
		return false;
	}

	if (getRelation(original.event)?.rel_type === 'm.replace') {
		return false;
	}

	// encrypted edits carry their new content inside the ciphertext
	const edit = replacement.event;
	return edit.type !== 'm.room.message' || typeof edit.content['m.new_content'] === 'object';
}

/**
 * Whether listeners may hear of `event`: anything but an edit, or an edit that is a valid
 * replacement of an event we know.
 */
export async function isNotifiableEdit(
	{ eventId, event }: { eventId: EventID; event: Readonly<Pdu> },
	lookup: EventLookup,
): Promise<boolean> {
	const relation = getRelation(event);
	if (relation?.rel_type !== 'm.replace') {
		return true;
	}

	const [replacement, original] = await Promise.all([
		lookup.getEvent(eventId),
		relation.event_id ? lookup.getEvent(relation.event_id) : null,
	]);

	return replacement !== null && isValidReplacement(replacement, original);
}

/**
 * Whether `redaction` may remove `target`: it must come from the same room, and from the target
 * sender's homeserver or from someone holding the room's redact power level before the redaction.
 * A homeserver is trusted to police redactions among its own users, as the spec requires.
 */
export async function isRedactionAllowed(
	redaction: PersistentEventBase,
	target: PersistentEventBase,
	lookup: EventLookup,
): Promise<boolean> {
	if (target.roomId !== redaction.roomId || target.isCreateEvent()) {
		return false;
	}

	if (extractDomainFromId(target.sender) === extractDomainFromId(redaction.sender)) {
		return true;
	}

	const stateBeforeRedaction = await lookup.getStateBeforeEvent(redaction);
	const powerLevelsEvent = stateBeforeRedaction.get('m.room.power_levels:');
	if (!powerLevelsEvent) {
		return new RoomState(stateBeforeRedaction).creator === redaction.sender;
	}

	const powerLevels = powerLevelsEvent.toPowerLevelEvent();
	const senderLevel = powerLevels.getPowerLevelForUser(redaction.sender, stateBeforeRedaction.get('m.room.create:'));

	return senderLevel >= powerLevels.getRequiredPowerForRedact();
}

/** The event a redaction removes, when its sender is allowed to remove it. */
export async function findAllowedRedactionTarget(redactionId: EventID, lookup: EventLookup): Promise<EventID | undefined> {
	const redaction = await lookup.getEvent(redactionId);
	const redacts = redaction?.getRedacts();
	const target = redacts ? await lookup.getEvent(redacts) : null;

	if (redaction && redacts && target && (await isRedactionAllowed(redaction, target, lookup))) {
		return redacts;
	}
}
