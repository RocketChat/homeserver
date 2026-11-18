import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { type Pdu, PersistentEventFactory } from '@rocket.chat/federation-room';

import type { ConfigService } from './config.service';
import type { FederationRequestService } from './federation-request.service';
import type { FederationSenderService } from './federation-sender.service';
import { FederationService } from './federation.service';
import type { StateService } from './state.service';
import type { StickyEventService } from './sticky-event.service';

const LOCAL_SERVER = 'local.example.com';
const ROOM_ID = `!room:${LOCAL_SERVER}`;
const ALICE = `@alice:${LOCAL_SERVER}`;

function stateEvent(type: string, stateKey: string, content: Record<string, unknown>) {
	return PersistentEventFactory.createFromRawEvent(
		{
			type,
			state_key: stateKey,
			content,
			room_id: ROOM_ID,
			sender: ALICE,
			origin_server_ts: 1700000000000,
			depth: 5,
			auth_events: [],
			prev_events: [],
		} as unknown as Pdu,
		'10',
	);
}

describe('FederationService.sendEventToAllServersInRoom', () => {
	let service: FederationService;
	let sendPDUToMultiple: ReturnType<typeof mock>;

	beforeEach(() => {
		sendPDUToMultiple = mock(() => undefined);

		const configService = { serverName: LOCAL_SERVER } as unknown as ConfigService;
		const stateService = {
			getServerSetInRoom: mock(async () => new Set([LOCAL_SERVER, 'joined.example.com'])),
			signEvent: mock(async (event: unknown) => event),
		} as unknown as StateService;
		const federationSenderService = { sendPDUToMultiple } as unknown as FederationSenderService;

		service = new FederationService(configService, {} as FederationRequestService, stateService, federationSenderService, null as never);
	});

	const destinations = () => sendPDUToMultiple.mock.calls[0][0] as string[];

	test('also sends a membership change to the server of the user it targets', async () => {
		await service.sendEventToAllServersInRoom(stateEvent('m.room.member', '@bob:invited.example.com', { membership: 'invite' }));

		expect(destinations().sort()).toEqual(['invited.example.com', 'joined.example.com']);
	});

	test('sends a state event keyed by something other than a user id only to the servers in the room', async () => {
		await service.sendEventToAllServersInRoom(
			stateEvent('org.matrix.msc3401.call.member', `_${ALICE}_DEVICE_m.call`, { application: 'm.call' }),
		);

		expect(destinations()).toEqual(['joined.example.com']);
	});

	test('sends a state event keyed by a user id that is not a membership only to the servers in the room', async () => {
		await service.sendEventToAllServersInRoom(stateEvent('org.example.profile', '@bob:elsewhere.example.com', {}));

		expect(destinations()).toEqual(['joined.example.com']);
	});

	test('sends a state event whose key has no server part only to the servers in the room', async () => {
		await service.sendEventToAllServersInRoom(stateEvent('m.rtc.slot', 'm.call#ROOM', {}));

		expect(destinations()).toEqual(['joined.example.com']);
	});

	test('sends a state event with an empty key only to the servers in the room', async () => {
		await service.sendEventToAllServersInRoom(stateEvent('m.room.topic', '', { topic: 'hello' }));

		expect(destinations()).toEqual(['joined.example.com']);
	});
});

describe('FederationService.notifyRemoteServerUp', () => {
	const setup = (droppedPdus: boolean) => {
		const notifyRemoteServerUp = mock(() => droppedPdus);
		const pushOwnStickyEventsToServers = mock(async () => 0);

		const service = new FederationService(
			{ serverName: LOCAL_SERVER } as unknown as ConfigService,
			{} as FederationRequestService,
			{} as StateService,
			{ notifyRemoteServerUp } as unknown as FederationSenderService,
			{ pushOwnStickyEventsToServers } as unknown as StickyEventService,
		);

		return { service, notifyRemoteServerUp, pushOwnStickyEventsToServers };
	};

	test('pushes own sticky events again to a server that lost events while it was unreachable', () => {
		const { service, notifyRemoteServerUp, pushOwnStickyEventsToServers } = setup(true);

		service.notifyRemoteServerUp('remote.example.com');

		expect(notifyRemoteServerUp).toHaveBeenCalledWith('remote.example.com');
		expect(pushOwnStickyEventsToServers).toHaveBeenCalledWith('remote.example.com');
	});

	test('pushes nothing again to a server that lost nothing', () => {
		const { service, pushOwnStickyEventsToServers } = setup(false);

		service.notifyRemoteServerUp('remote.example.com');

		expect(pushOwnStickyEventsToServers).not.toHaveBeenCalled();
	});
});
