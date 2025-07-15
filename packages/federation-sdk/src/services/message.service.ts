import {
	type ReactionAuthEvents,
	type ReactionEvent,
	reactionEvent,
} from '@hs/core';
import {
	type MessageAuthEvents,
	type RoomMessageEvent,
	roomMessageEvent,
} from '@hs/core';
import { type SignedEvent } from '@hs/core';

import { ForbiddenError } from '@hs/core';
import {
	type RedactionAuthEvents,
	type RedactionEvent,
	redactionEvent,
} from '@hs/core';
import { createLogger } from '@hs/core';
import { generateId } from '@hs/core';
import { signEvent } from '@hs/core';
import { inject } from 'tsyringe';
import { singleton } from 'tsyringe';
import type { ConfigService } from './config.service';
import { EventService, EventType } from './event.service';
import { FederationService } from './federation.service';
import type { RoomService } from './room.service';
import { StateService } from './state.service';
import { PersistentEventBase, PersistentEventFactory } from '@hs/room';

@singleton()
export class MessageService {
	private readonly logger = createLogger('MessageService');

	constructor(
		@inject('EventService') private readonly eventService: EventService,
		@inject('ConfigService') private readonly configService: ConfigService,
		@inject('FederationService')
		private readonly federationService: FederationService,
		@inject('RoomService') private readonly roomService: RoomService,
		@inject('StateService') private readonly stateService: StateService,
	) {}

	async sendMessage(
		roomId: string,
		message: string,
		senderUserId: string,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(
				`Room version not found for room ${roomId} white trying to send message`,
			);
		}

		const event = PersistentEventFactory.newMessageEvent(
			roomId,
			senderUserId,
			message,
			roomVersion,
		);

		await Promise.all([
			this.stateService.addAuthEvents(event),
			this.stateService.addPrevEvents(event),
		]);

		await this.stateService.signEvent(event);

		await this.stateService.persistTimelineEvent(event);
		if (event.rejected) {
			throw new Error(event.rejectedReason);
		}

		void this.federationService.sendEventToAllServersInRoom(event);

		return event;
	}

	async sendReaction(
		roomId: string,
		eventId: string,
		emoji: string,
		senderUserId: string,
		targetServer: string,
	): Promise<SignedEvent<ReactionEvent>> {
		const isTombstoned = await this.roomService.isRoomTombstoned(roomId);
		if (isTombstoned) {
			this.logger.warn(
				`Attempted to send message to a tombstoned room: ${roomId}`,
			);
			throw new ForbiddenError(
				'Cannot react to a message in a tombstoned room',
			);
		}

		const serverName = this.configService.getServerConfig().name;
		const signingKey = await this.configService.getSigningKey();

		const latestEventDoc = await this.eventService.getLastEventForRoom(roomId);
		const prevEvents = latestEventDoc ? [latestEventDoc._id] : [];

		const authEvents = await this.eventService.getAuthEventIds(
			EventType.REACTION,
			{ roomId, senderId: senderUserId },
		);

		const currentDepth = latestEventDoc?.event?.depth ?? 0;
		const newDepth = currentDepth + 1;

		const authEventsMap: ReactionAuthEvents = {
			'm.room.create':
				authEvents.find((event) => event.type === EventType.CREATE)?._id || '',
			'm.room.power_levels':
				authEvents.find((event) => event.type === EventType.POWER_LEVELS)
					?._id || '',
			'm.room.member':
				authEvents.find((event) => event.type === EventType.MEMBER)?._id || '',
		};

		const { state_key, ...eventForSigning } = reactionEvent({
			roomId,
			sender: senderUserId,
			auth_events: authEventsMap,
			prev_events: prevEvents,
			depth: newDepth,
			content: {
				'm.relates_to': {
					rel_type: 'm.annotation',
					event_id: eventId,
					key: emoji,
				},
			},
			origin: serverName,
			ts: Date.now(),
		});

		const signedEvent = await signEvent(
			eventForSigning,
			Array.isArray(signingKey) ? signingKey[0] : signingKey,
			serverName,
		);

		this.logger.debug(signedEvent);

		await this.federationService.sendEvent(targetServer, signedEvent);

		const reactionEventId = generateId(signedEvent);
		await this.eventService.insertEvent(signedEvent, reactionEventId);

		this.logger.info(
			`Sent reaction ${emoji} to ${targetServer} for event ${eventId} - ${reactionEventId}`,
		);

		return { ...signedEvent, event_id: reactionEventId };
	}

	async updateMessage(
		roomId: string,
		message: string,
		senderUserId: string,
		targetServer: string,
		eventIdToReplace: string,
	): Promise<SignedEvent<RoomMessageEvent>> {
		const serverName = this.configService.getServerConfig().name;
		const signingKey = await this.configService.getSigningKey();

		const latestEventDoc = await this.eventService.getLastEventForRoom(roomId);
		const prevEvents = latestEventDoc ? [latestEventDoc._id] : [];

		const authEvents = await this.eventService.getAuthEventIds(
			EventType.MESSAGE,
			{ roomId, senderId: senderUserId },
		);

		const currentDepth = latestEventDoc?.event?.depth ?? 0;
		const newDepth = currentDepth + 1;

		const authEventsMap: MessageAuthEvents = {
			'm.room.create':
				authEvents.find((event) => event.type === EventType.CREATE)?._id || '',
			'm.room.power_levels':
				authEvents.find((event) => event.type === EventType.POWER_LEVELS)
					?._id || '',
			'm.room.member':
				authEvents.find((event) => event.type === EventType.MEMBER)?._id || '',
		};

		// For message edits, Matrix requires:
		// 1. A fallback body with "* " prefix for clients that don't support edits
		// 2. The new content directly in "m.new_content" (not inside m.relates_to)
		// 3. A relates_to field with rel_type: "m.replace" and event_id pointing to original
		const { state_key, ...eventForSigning } = roomMessageEvent({
			roomId,
			sender: senderUserId,
			auth_events: authEventsMap,
			prev_events: prevEvents,
			depth: newDepth,
			content: {
				msgtype: 'm.text',
				body: `* ${message}`, // Fallback for clients not supporting edits
				'm.mentions': {},
				'm.relates_to': {
					rel_type: 'm.replace',
					event_id: eventIdToReplace,
				},
				'm.new_content': {
					msgtype: 'm.text',
					body: message, // The actual new content
				},
			},
			origin: serverName,
			ts: Date.now(),
		});

		const signedEvent = await signEvent(
			eventForSigning,
			Array.isArray(signingKey) ? signingKey[0] : signingKey,
			serverName,
		);

		await this.federationService.sendEvent(targetServer, signedEvent);

		return signedEvent;
	}

	async redactMessage(
		roomId: string,
		eventIdToRedact: string,
		reason: string | undefined,
		senderUserId: string,
		targetServer: string,
	): Promise<SignedEvent<RedactionEvent>> {
		const serverName = this.configService.getServerConfig().name;
		const signingKey = await this.configService.getSigningKey();

		const latestEventDoc = await this.eventService.getLastEventForRoom(roomId);
		const prevEvents = latestEventDoc ? [latestEventDoc._id] : [];

		const authEvents = await this.eventService.getAuthEventIds(
			EventType.MESSAGE,
			{ roomId, senderId: senderUserId },
		);

		const currentDepth = latestEventDoc?.event?.depth ?? 0;
		const newDepth = currentDepth + 1;

		const authEventsMap: RedactionAuthEvents = {
			'm.room.create':
				authEvents.find((event) => event.type === EventType.CREATE)?._id || '',
			'm.room.power_levels':
				authEvents.find((event) => event.type === EventType.POWER_LEVELS)
					?._id || '',
			'm.room.member':
				authEvents.find((event) => event.type === EventType.MEMBER)?._id || '',
		};

		if (
			!authEventsMap['m.room.create'] ||
			!authEventsMap['m.room.power_levels'] ||
			!authEventsMap['m.room.member']
		) {
			throw new Error(
				"There are missing critical auth events (create, power_levels, or sender's member event) for the redaction event on the sending server.",
			);
		}

		const { state_key, ...eventForSigning } = redactionEvent({
			roomId,
			sender: senderUserId,
			auth_events: authEventsMap,
			prev_events: prevEvents,
			depth: newDepth,
			content: {
				redacts: eventIdToRedact,
				...(reason && { reason }),
			},
			origin: serverName,
			ts: Date.now(),
		});

		const signedEvent = await signEvent(
			eventForSigning,
			Array.isArray(signingKey) ? signingKey[0] : signingKey,
			serverName,
		);

		const eventId = await this.eventService.insertEvent(signedEvent);
		const eventToFederate: RedactionEvent = {
			...signedEvent,
			redacts: eventForSigning.redacts,
		};
		await this.federationService.sendEvent<RedactionEvent>(
			targetServer,
			eventToFederate,
		);
		await this.eventService.processRedaction(eventToFederate);

		return { ...signedEvent, event_id: eventId };
	}
}
