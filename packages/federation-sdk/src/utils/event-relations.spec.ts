import { describe, expect, it } from 'bun:test';

import { PersistentEventFactory, RejectCodes, roomIdSchema, userIdSchema } from '@rocket.chat/federation-room';
import type {
	EventID,
	PduContent,
	PduForType,
	PduMessageEventContent,
	PduWithHashesAndSignaturesOptional,
	PersistentEventBase,
	State,
} from '@rocket.chat/federation-room';

import { findAllowedRedactionTarget, isJsonObject, isNotifiableEdit, isRedactionAllowed, isValidReplacement } from './event-relations';
import type { EventLookup } from './event-relations';

const roomId = roomIdSchema.parse('!room:rc1');
const otherRoomId = roomIdSchema.parse('!other:rc1');
let ts = 1732999153019;

const common = (room = roomId) => {
	ts += 1;
	return { room_id: room, depth: 5, auth_events: [], prev_events: [], origin_server_ts: ts };
};

const message = (sender: string, content: PduMessageEventContent = { msgtype: 'm.text', body: 'hi' }, room = roomId) =>
	PersistentEventFactory.createFromRawEvent({ ...common(room), type: 'm.room.message', sender: userIdSchema.parse(sender), content }, '10');

const encrypted = (sender: string, content: PduContent<'m.room.encrypted'> = { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'old' }) =>
	PersistentEventFactory.createFromRawEvent({ ...common(), type: 'm.room.encrypted', sender: userIdSchema.parse(sender), content }, '10');

const replaces = (eventId: EventID): { rel_type: 'm.replace'; event_id: EventID } => ({ rel_type: 'm.replace', event_id: eventId });

const edit = (sender: string, original: PersistentEventBase, room = roomId) =>
	message(
		sender,
		{
			'msgtype': 'm.text',
			'body': '* new',
			'm.new_content': { msgtype: 'm.text', body: 'new' },
			'm.relates_to': replaces(original.eventId),
		},
		room,
	);

const encryptedEdit = (sender: string, original: PersistentEventBase) =>
	encrypted(sender, { 'algorithm': 'm.megolm.v1.aes-sha2', 'ciphertext': 'new', 'm.relates_to': replaces(original.eventId) });

const redaction = (sender: string, target: PersistentEventBase, room = roomId) =>
	PersistentEventFactory.createFromRawEvent(
		{ ...common(room), type: 'm.room.redaction', sender: userIdSchema.parse(sender), redacts: target.eventId, content: {} },
		'10',
	);

const creator = userIdSchema.parse('@alice:rc1');
const createEvent = PersistentEventFactory.createFromRawEvent(
	{ ...common(), type: 'm.room.create', sender: creator, state_key: '', content: { creator, room_version: '10' } },
	'10',
);

function roomState(powerLevels?: PduContent<'m.room.power_levels'>): State {
	const state: State = new Map();
	state.set('m.room.create:', createEvent);
	if (powerLevels) {
		state.set(
			'm.room.power_levels:',
			PersistentEventFactory.createFromRawEvent(
				{ ...common(), type: 'm.room.power_levels', sender: creator, state_key: '', content: powerLevels },
				'10',
			),
		);
	}
	return state;
}

function lookup(events: PersistentEventBase[], state: State = roomState()): EventLookup & { requested: EventID[] } {
	const byId = new Map(events.map((event) => [event.eventId, event]));
	const requested: EventID[] = [];
	return {
		requested,
		getEvent: async (eventId) => {
			requested.push(eventId);
			return byId.get(eventId) ?? null;
		},
		getStateBeforeEvent: async () => state,
	};
}

const powerLevels: PduContent<'m.room.power_levels'> = {
	users: { [creator]: 100, [userIdSchema.parse('@mod:hs1')]: 50 },
	users_default: 0,
	events: {},
};

describe('isJsonObject', () => {
	// the SDK's ingest schema doesn't look at m.new_content, so any JSON shape can reach these checks
	it('accepts an object', () => {
		expect(isJsonObject({ msgtype: 'm.text', body: 'new' })).toBe(true);
	});

	it('rejects null', () => {
		expect(isJsonObject(null)).toBe(false);
	});

	it('rejects an array', () => {
		expect(isJsonObject([{ msgtype: 'm.text', body: 'new' }])).toBe(false);
	});

	it('rejects primitives and a missing value', () => {
		expect(isJsonObject('new')).toBe(false);
		expect(isJsonObject(1)).toBe(false);
		expect(isJsonObject(undefined)).toBe(false);
	});
});

describe('isValidReplacement', () => {
	it('accepts an edit by the original sender', () => {
		const original = message('@alice:rc1');
		expect(isValidReplacement(edit('@alice:rc1', original), original)).toBe(true);
	});

	it('accepts an encrypted edit of an encrypted message', () => {
		const original = encrypted('@alice:rc1');
		expect(isValidReplacement(encryptedEdit('@alice:rc1', original), original)).toBe(true);
	});

	it('rejects an edit when the original is unknown', () => {
		expect(isValidReplacement(edit('@alice:rc1', message('@alice:rc1')), null)).toBe(false);
	});

	it('rejects an edit by anyone else, even from the same server', () => {
		const original = message('@alice:rc1');
		expect(isValidReplacement(edit('@bob:rc1', original), original)).toBe(false);
	});

	it('rejects an edit from another room', () => {
		const original = message('@alice:rc1');
		expect(isValidReplacement(edit('@alice:rc1', original, otherRoomId), original)).toBe(false);
	});

	it('rejects an edit of a different event type', () => {
		const original = message('@alice:rc1');
		expect(isValidReplacement(encryptedEdit('@alice:rc1', original), original)).toBe(false);
	});

	it('rejects an edit of an edit', () => {
		const firstEdit = edit('@alice:rc1', message('@alice:rc1'));
		expect(isValidReplacement(edit('@alice:rc1', firstEdit), firstEdit)).toBe(false);
	});

	it('rejects an edit of a state event', () => {
		// messages have no state_key, so only a malformed event from the network can be one
		const malformed: PduWithHashesAndSignaturesOptional<PduForType<'m.room.message'>> & { state_key: string } = {
			...common(),
			type: 'm.room.message',
			sender: userIdSchema.parse('@alice:rc1'),
			state_key: '',
			content: { msgtype: 'm.text', body: 'hi' },
		};
		const original = PersistentEventFactory.createFromRawEvent(malformed, '10');
		expect(original.isState()).toBe(true);
		expect(isValidReplacement(edit('@alice:rc1', original), original)).toBe(false);
	});

	it('rejects a plaintext edit without m.new_content', () => {
		const original = message('@alice:rc1');
		const bareEdit = message('@alice:rc1', { 'msgtype': 'm.text', 'body': '* new', 'm.relates_to': replaces(original.eventId) });
		expect(isValidReplacement(bareEdit, original)).toBe(false);
	});

	it('rejects a plaintext edit whose m.new_content is an array', () => {
		const original = message('@alice:rc1');
		const fields: { msgtype: 'm.text'; body: string } = { msgtype: 'm.text', body: 'new' };
		const arrayEdit = message('@alice:rc1', {
			'msgtype': 'm.text',
			'body': '* new',
			'm.new_content': Object.assign([], fields),
			'm.relates_to': replaces(original.eventId),
		});
		expect(isValidReplacement(arrayEdit, original)).toBe(false);
	});

	it('rejects an edit of a rejected event', () => {
		const original = message('@alice:rc1');
		original.reject(RejectCodes.AuthError, 'not allowed');
		expect(isValidReplacement(edit('@alice:rc1', original), original)).toBe(false);
	});
});

describe('isNotifiableEdit', () => {
	it('lets anything that is not an edit through without looking it up', async () => {
		const plain = message('@alice:rc1');
		expect(await isNotifiableEdit(plain, lookup([]))).toBe(true);
	});

	it('lets a valid edit of a known event through', async () => {
		const original = message('@alice:rc1');
		const valid = edit('@alice:rc1', original);
		expect(await isNotifiableEdit(valid, lookup([original]))).toBe(true);
	});

	it('looks up only the original, not the edit it was given', async () => {
		const original = message('@alice:rc1');
		const valid = edit('@alice:rc1', original);
		const events = lookup([original]);
		await isNotifiableEdit(valid, events);
		expect(events.requested).toEqual([original.eventId]);
	});

	it('holds back an edit of somebody else’s message', async () => {
		const original = message('@alice:rc1');
		const forged = edit('@mallory:hs1', original);
		expect(await isNotifiableEdit(forged, lookup([original]))).toBe(false);
	});

	it('holds back an encrypted edit of somebody else’s message', async () => {
		const original = encrypted('@alice:rc1');
		const forged = encryptedEdit('@mallory:hs1', original);
		expect(await isNotifiableEdit(forged, lookup([original]))).toBe(false);
	});

	it('holds back an edit of an unknown event', async () => {
		const valid = edit('@alice:rc1', message('@alice:rc1'));
		expect(await isNotifiableEdit(valid, lookup([]))).toBe(false);
	});
});

describe('isRedactionAllowed', () => {
	it('allows the author to redact their own message', async () => {
		const target = message('@bob:hs1');
		expect(await isRedactionAllowed(redaction('@bob:hs1', target), target, lookup([], roomState(powerLevels)))).toBe(true);
	});

	it("allows another user of the author's homeserver", async () => {
		const target = message('@bob:hs1');
		expect(await isRedactionAllowed(redaction('@carol:hs1', target), target, lookup([], roomState(powerLevels)))).toBe(true);
	});

	it("does not load room state for a redaction from the author's homeserver", async () => {
		const target = message('@bob:hs1');
		const noState: EventLookup = {
			getEvent: async () => null,
			getStateBeforeEvent: async () => {
				throw new Error('state should not be needed');
			},
		};
		expect(await isRedactionAllowed(redaction('@carol:hs1', target), target, noState)).toBe(true);
	});

	it('allows a user with the redact power level from another homeserver', async () => {
		const target = message('@alice:rc1');
		expect(await isRedactionAllowed(redaction('@mod:hs1', target), target, lookup([], roomState(powerLevels)))).toBe(true);
	});

	it('rejects a user without the redact power level from another homeserver', async () => {
		const target = message('@alice:rc1');
		expect(await isRedactionAllowed(redaction('@mallory:hs1', target), target, lookup([], roomState(powerLevels)))).toBe(false);
	});

	it('honours a raised redact level', async () => {
		const target = message('@alice:rc1');
		const state = roomState({ ...powerLevels, redact: 75 });
		expect(await isRedactionAllowed(redaction('@mod:hs1', target), target, lookup([], state))).toBe(false);
	});

	it('rejects a redaction from another room', async () => {
		const target = message('@alice:rc1');
		expect(await isRedactionAllowed(redaction('@alice:rc1', target, otherRoomId), target, lookup([], roomState(powerLevels)))).toBe(false);
	});

	it('rejects redacting the create event', async () => {
		expect(await isRedactionAllowed(redaction('@alice:rc1', createEvent), createEvent, lookup([], roomState(powerLevels)))).toBe(false);
	});

	it('gives only the creator redact rights when the room has no power levels', async () => {
		const target = message('@bob:hs1');
		expect(await isRedactionAllowed(redaction('@alice:rc1', target), target, lookup([]))).toBe(true);
		expect(await isRedactionAllowed(redaction('@mallory:other', target), target, lookup([]))).toBe(false);
	});
});

describe('findAllowedRedactionTarget', () => {
	it('returns the target of an allowed redaction', async () => {
		const target = message('@alice:rc1');
		const allowed = redaction('@mod:hs1', target);
		expect(await findAllowedRedactionTarget(allowed, lookup([target], roomState(powerLevels)))).toBe(target.eventId);
	});

	it('looks up only the target, not the redaction it was given', async () => {
		const target = message('@alice:rc1');
		const allowed = redaction('@mod:hs1', target);
		const events = lookup([target], roomState(powerLevels));
		await findAllowedRedactionTarget(allowed, events);
		expect(events.requested).toEqual([target.eventId]);
	});

	it('returns nothing for a redaction its sender may not make', async () => {
		const target = message('@alice:rc1');
		const forged = redaction('@mallory:hs1', target);
		expect(await findAllowedRedactionTarget(forged, lookup([target], roomState(powerLevels)))).toBeUndefined();
	});

	it('returns nothing for a redaction of an unknown event', async () => {
		const forged = redaction('@mallory:hs1', message('@alice:rc1'));
		expect(await findAllowedRedactionTarget(forged, lookup([], roomState(powerLevels)))).toBeUndefined();
	});
});
