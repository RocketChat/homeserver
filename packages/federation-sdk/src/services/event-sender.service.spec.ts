import 'reflect-metadata';

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { EventRouterService } from '@rocket.chat/appservice';
import type { PersistentEventBase, RoomID, UserID } from '@rocket.chat/federation-room';

import { EventSenderService } from './event-sender.service';
import type { FederationService } from './federation.service';
import type { StateService } from './state.service';

const ROOM_ID = '!room:example.com' as RoomID;
const SENDER = '@bridge:example.com' as UserID;

describe('EventSenderService.sendCustomEvent', () => {
	let service: EventSenderService;
	let buildEvent: ReturnType<typeof mock>;
	let getRoomVersion: ReturnType<typeof mock>;
	let handlePdu: ReturnType<typeof mock>;
	let sendEventToAllServersInRoom: ReturnType<typeof mock>;
	let routeEvent: ReturnType<typeof mock>;

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
		routeEvent = mock(async () => undefined);

		const stateService = { getRoomVersion, buildEvent, handlePdu } as unknown as StateService;
		const federationService = { sendEventToAllServersInRoom } as unknown as FederationService;
		const eventRouterService = { routeEvent } as unknown as EventRouterService;

		service = new EventSenderService(stateService, federationService, eventRouterService);
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
		expect(routeEvent).toHaveBeenCalledWith(builtEvent);
		expect(result).toBe(builtEvent);
	});

	test('accepts a known event type when its content is valid', async () => {
		const content = { msgtype: 'm.text', body: 'hello' };

		await service.sendCustomEvent(ROOM_ID, 'm.room.message', content, SENDER);

		expect(buildEvent).toHaveBeenCalledTimes(1);
		expect(routeEvent).toHaveBeenCalledTimes(1);
	});

	test('rejects a known event type with invalid content before building or sending', async () => {
		// m.room.message requires msgtype + body; this omits them.
		await expect(service.sendCustomEvent(ROOM_ID, 'm.room.message', { foo: 'bar' }, SENDER)).rejects.toThrow(/failed schema validation/);

		expect(buildEvent).not.toHaveBeenCalled();
		expect(handlePdu).not.toHaveBeenCalled();
		expect(sendEventToAllServersInRoom).not.toHaveBeenCalled();
		expect(routeEvent).not.toHaveBeenCalled();
	});

	test('throws when the room version cannot be resolved', async () => {
		getRoomVersion.mockResolvedValueOnce(undefined);

		await expect(service.sendCustomEvent(ROOM_ID, 'org.matrix.bridge.ping', {}, SENDER)).rejects.toThrow(/Room version not found/);

		expect(buildEvent).not.toHaveBeenCalled();
	});

	test('throws and does not federate when the built event is rejected', async () => {
		buildEvent.mockImplementationOnce(async (raw: unknown) => {
			builtEvent = { ...(raw as object), rejected: true, rejectReason: 'nope' } as unknown as PersistentEventBase;
			return builtEvent;
		});

		await expect(service.sendCustomEvent(ROOM_ID, 'org.matrix.bridge.ping', {}, SENDER)).rejects.toThrow('nope');

		expect(handlePdu).toHaveBeenCalledTimes(1);
		expect(sendEventToAllServersInRoom).not.toHaveBeenCalled();
		expect(routeEvent).not.toHaveBeenCalled();
	});
});
