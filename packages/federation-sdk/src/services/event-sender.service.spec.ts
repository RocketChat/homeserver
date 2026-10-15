import 'reflect-metadata';

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { EventRouterService } from '@rocket.chat/appservice';
import {
	type Pdu,
	type PersistentEventBase,
	PersistentEventFactory,
	RejectCodes,
	type RoomID,
	StateResolverAuthorizationError,
	type UserID,
} from '@rocket.chat/federation-room';

import { EventRejectedError, EventSenderService } from './event-sender.service';
import type { FederationService } from './federation.service';
import { PartialStateResolutionError, type StateService, UnknownRoomError } from './state.service';
import type { StickyEventService } from './sticky-event.service';

const ROOM_ID = '!room:example.com' as RoomID;
const SENDER = '@bridge:example.com' as UserID;

describe('EventSenderService.sendCustomEvent', () => {
	let service: EventSenderService;
	let buildEvent: ReturnType<typeof mock>;
	let getRoomVersion: ReturnType<typeof mock>;
	let handlePdu: ReturnType<typeof mock>;
	let sendEventToAllServersInRoom: ReturnType<typeof mock>;
	let routePersistent: ReturnType<typeof mock>;

	// buildEvent echoes back the raw event it was handed so assertions can read
	// the type/content that would be persisted, plus the rejection fields the
	// service checks.
	let builtEvent: PersistentEventBase;

	beforeEach(() => {
		getRoomVersion = mock(async () => '10');
		buildEvent = mock(async (raw: unknown) => {
			builtEvent = { ...(raw as object), eventId: '$evt:example.com', rejected: false } as unknown as PersistentEventBase;
			return builtEvent;
		});
		handlePdu = mock(async () => undefined);
		sendEventToAllServersInRoom = mock(async () => undefined);
		routePersistent = mock(async () => undefined);

		const stateService = { getRoomVersion, buildEvent, handlePdu } as unknown as StateService;
		const federationService = { sendEventToAllServersInRoom } as unknown as FederationService;
		const eventRouterService = { routePersistent } as unknown as EventRouterService;

		service = new EventSenderService(stateService, federationService, eventRouterService, {} as StickyEventService);
	});

	test('sends a custom (unknown) event type through the full pipeline', async () => {
		const content = { ping_id: 'abc', ts: 123 };

		const result = await service.sendCustomEvent(ROOM_ID, 'org.matrix.bridge.ping', content, SENDER);

		expect(buildEvent).toHaveBeenCalledTimes(1);
		const rawPassedToBuild = buildEvent.mock.calls[0][0] as { type: string; content: unknown; sender: string; room_id: string };
		expect(rawPassedToBuild.type).toBe('org.matrix.bridge.ping');
		expect(rawPassedToBuild.content).toEqual(content);
		expect(rawPassedToBuild.sender).toBe(SENDER);
		expect(rawPassedToBuild.room_id).toBe(ROOM_ID);

		expect(handlePdu).toHaveBeenCalledTimes(1);
		expect(sendEventToAllServersInRoom).toHaveBeenCalledWith(builtEvent);
		expect(routePersistent).toHaveBeenCalledWith(builtEvent);
		expect(result).toBe(builtEvent);
	});

	test('accepts a known event type when its content is valid', async () => {
		const content = { msgtype: 'm.text', body: 'hello' };

		await service.sendCustomEvent(ROOM_ID, 'm.room.message', content, SENDER);

		expect(buildEvent).toHaveBeenCalledTimes(1);
		expect(routePersistent).toHaveBeenCalledTimes(1);
	});

	test('rejects a known event type with invalid content before building or sending', async () => {
		// m.room.message requires msgtype + body; this omits them.
		await expect(service.sendCustomEvent(ROOM_ID, 'm.room.message', { foo: 'bar' }, SENDER)).rejects.toThrow(/failed schema validation/);

		expect(buildEvent).not.toHaveBeenCalled();
		expect(handlePdu).not.toHaveBeenCalled();
		expect(sendEventToAllServersInRoom).not.toHaveBeenCalled();
		expect(routePersistent).not.toHaveBeenCalled();
	});

	test('propagates the error when the room version cannot be resolved', async () => {
		// getRoomVersion throws on an unknown room rather than resolving undefined
		getRoomVersion.mockRejectedValueOnce(new UnknownRoomError(ROOM_ID));

		await expect(service.sendCustomEvent(ROOM_ID, 'org.matrix.bridge.ping', {}, SENDER)).rejects.toThrow(UnknownRoomError);

		expect(buildEvent).not.toHaveBeenCalled();
		expect(handlePdu).not.toHaveBeenCalled();
	});

	test('throws and does not federate when the built event is rejected', async () => {
		buildEvent.mockImplementationOnce(async (raw: unknown) => {
			builtEvent = { ...(raw as object), rejected: true, rejectReason: 'nope' } as unknown as PersistentEventBase;
			return builtEvent;
		});

		await expect(service.sendCustomEvent(ROOM_ID, 'org.matrix.bridge.ping', {}, SENDER)).rejects.toThrow('nope');

		expect(handlePdu).toHaveBeenCalledTimes(1);
		expect(sendEventToAllServersInRoom).not.toHaveBeenCalled();
		expect(routePersistent).not.toHaveBeenCalled();
	});
});

describe('EventSenderService.sendStateEvent', () => {
	const CALL_MEMBER = 'org.matrix.msc3401.call.member';
	const STATE_KEY = `_${SENDER}_DEVICE_m.call`;

	let service: EventSenderService;
	let buildEvent: ReturnType<typeof mock>;
	let handlePdu: ReturnType<typeof mock>;
	let sendEventToAllServersInRoom: ReturnType<typeof mock>;
	let routePersistent: ReturnType<typeof mock>;
	let builtEvent: PersistentEventBase;

	beforeEach(() => {
		buildEvent = mock(async (raw: unknown) => {
			builtEvent = PersistentEventFactory.createFromRawEvent(raw as Pdu, '10');
			return builtEvent;
		});
		handlePdu = mock(async () => undefined);
		sendEventToAllServersInRoom = mock(async () => undefined);
		routePersistent = mock(async () => undefined);

		const stateService = { getRoomVersion: mock(async () => '10'), buildEvent, handlePdu } as unknown as StateService;
		const federationService = { sendEventToAllServersInRoom } as unknown as FederationService;
		const eventRouterService = { routePersistent } as unknown as EventRouterService;

		service = new EventSenderService(stateService, federationService, eventRouterService, {} as StickyEventService);
	});

	test('persists a state event of any type under any state key and relays it everywhere', async () => {
		const content = { application: 'm.call', call_id: '', device_id: 'DEVICE' };

		const result = await service.sendStateEvent(ROOM_ID, CALL_MEMBER, STATE_KEY, content, SENDER);

		expect(buildEvent).toHaveBeenCalledTimes(1);
		expect(buildEvent.mock.calls[0][0]).toMatchObject({
			type: CALL_MEMBER,
			state_key: STATE_KEY,
			content,
			sender: SENDER,
			room_id: ROOM_ID,
		});
		expect(builtEvent.isState()).toBe(true);
		expect(handlePdu).toHaveBeenCalledWith(builtEvent);
		expect(sendEventToAllServersInRoom).toHaveBeenCalledWith(builtEvent);
		expect(routePersistent).toHaveBeenCalledWith(builtEvent);
		expect(result).toEqual({ eventId: builtEvent.eventId });
	});

	test('accepts empty content', async () => {
		await service.sendStateEvent(ROOM_ID, CALL_MEMBER, STATE_KEY, {}, SENDER);

		expect(builtEvent.getContent()).toEqual({});
		expect(sendEventToAllServersInRoom).toHaveBeenCalledWith(builtEvent);
	});

	test('rejects a known state type with invalid content before building or sending', async () => {
		await expect(service.sendStateEvent(ROOM_ID, 'm.room.member', SENDER, { foo: 'bar' }, SENDER)).rejects.toThrow(
			/failed schema validation/,
		);

		expect(buildEvent).not.toHaveBeenCalled();
		expect(handlePdu).not.toHaveBeenCalled();
	});

	test('throws EventRejectedError and does not relay when authorization rejects the event', async () => {
		handlePdu.mockImplementationOnce(async (event: PersistentEventBase) => {
			event.reject(RejectCodes.AuthError, 'user power level 0 is less than event required power level 50');
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, {
				rejectedEvent: event,
				reason: 'user power level 0 is less than event required power level 50',
			});
		});

		const error = await service.sendStateEvent(ROOM_ID, CALL_MEMBER, STATE_KEY, {}, SENDER).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(EventRejectedError);
		expect(error).toMatchObject({
			eventId: builtEvent.eventId,
			code: RejectCodes.AuthError,
			reason: 'user power level 0 is less than event required power level 50',
		});
		expect((error as Error).cause).toBeInstanceOf(StateResolverAuthorizationError);
		expect(sendEventToAllServersInRoom).not.toHaveBeenCalled();
		expect(routePersistent).not.toHaveBeenCalled();
	});

	test('passes through a failure that is not a rejection', async () => {
		handlePdu.mockImplementationOnce(async (event: PersistentEventBase) => {
			throw new PartialStateResolutionError(event);
		});

		await expect(service.sendStateEvent(ROOM_ID, CALL_MEMBER, STATE_KEY, {}, SENDER)).rejects.toBeInstanceOf(PartialStateResolutionError);

		expect(sendEventToAllServersInRoom).not.toHaveBeenCalled();
	});
});

describe('EventSenderService.sendStickyEvent', () => {
	const RTC_MEMBER = 'org.matrix.msc4143.rtc.member';
	const CONTENT = { slot_id: 'm.call#ROOM', msc4354_sticky_key: 'member-1' };

	let service: EventSenderService;
	let buildEvent: ReturnType<typeof mock>;
	let handlePdu: ReturnType<typeof mock>;
	let markSticky: ReturnType<typeof mock>;
	let sendEventToAllServersInRoom: ReturnType<typeof mock>;
	let routePersistent: ReturnType<typeof mock>;
	let builtEvent: PersistentEventBase;

	beforeEach(() => {
		buildEvent = mock(async (raw: unknown) => {
			builtEvent = PersistentEventFactory.createFromRawEvent(raw as Pdu, '10');
			return builtEvent;
		});
		handlePdu = mock(async () => undefined);
		markSticky = mock(async () => undefined);
		sendEventToAllServersInRoom = mock(async () => undefined);
		routePersistent = mock(async () => undefined);

		const stateService = { getRoomVersion: mock(async () => '10'), buildEvent, handlePdu } as unknown as StateService;
		const federationService = { sendEventToAllServersInRoom } as unknown as FederationService;
		const eventRouterService = { routePersistent } as unknown as EventRouterService;
		const stickyEventService = { markSticky } as unknown as StickyEventService;

		service = new EventSenderService(stateService, federationService, eventRouterService, stickyEventService);
	});

	test('persists a message event that is sticky for the given duration and relays it everywhere', async () => {
		const result = await service.sendStickyEvent(ROOM_ID, RTC_MEMBER, CONTENT, SENDER, 3_600_000);

		const raw = buildEvent.mock.calls[0][0] as Record<string, unknown>;
		expect(raw).toMatchObject({
			type: RTC_MEMBER,
			content: CONTENT,
			sender: SENDER,
			room_id: ROOM_ID,
			msc4354_sticky: { duration_ms: 3_600_000 },
		});
		expect(raw).not.toHaveProperty('state_key');
		expect(builtEvent.event).toHaveProperty('msc4354_sticky', { duration_ms: 3_600_000 });
		expect(handlePdu).toHaveBeenCalledWith(builtEvent);
		expect(markSticky).toHaveBeenCalledWith(builtEvent, raw.origin_server_ts);
		expect(sendEventToAllServersInRoom).toHaveBeenCalledWith(builtEvent);
		expect(routePersistent).toHaveBeenCalledWith(builtEvent);
		expect(result).toEqual({ eventId: builtEvent.eventId });
	});

	test.each([0, -1, 1.5, 3_600_001, Number.NaN])('refuses a duration of %p ms before building anything', async (durationMs) => {
		await expect(service.sendStickyEvent(ROOM_ID, RTC_MEMBER, CONTENT, SENDER, durationMs)).rejects.toBeInstanceOf(RangeError);

		expect(buildEvent).not.toHaveBeenCalled();
	});

	test('throws EventRejectedError and neither records nor relays the event when authorization rejects it', async () => {
		handlePdu.mockImplementationOnce(async (event: PersistentEventBase) => {
			event.reject(RejectCodes.AuthError, "sender's membership is not join");
			throw new StateResolverAuthorizationError(RejectCodes.AuthError, { rejectedEvent: event, reason: "sender's membership is not join" });
		});

		await expect(service.sendStickyEvent(ROOM_ID, RTC_MEMBER, CONTENT, SENDER, 110_000)).rejects.toBeInstanceOf(EventRejectedError);

		expect(markSticky).not.toHaveBeenCalled();
		expect(sendEventToAllServersInRoom).not.toHaveBeenCalled();
		expect(routePersistent).not.toHaveBeenCalled();
	});
});
