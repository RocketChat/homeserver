import {
	type MessageAuthEvents,
	type RoomMessageEvent,
	roomMessageEvent,
} from '@rocket.chat/federation-core';
import { type SignedEvent } from '@rocket.chat/federation-core';

import { ForbiddenError } from '@rocket.chat/federation-core';
import {
	type RedactionAuthEvents,
	type RedactionEvent,
	redactionEvent,
} from '@rocket.chat/federation-core';
import { createLogger } from '@rocket.chat/federation-core';
import { signEvent } from '@rocket.chat/federation-core';
import {
	type EventID,
	type PersistentEventBase,
	PersistentEventFactory,
	type RoomVersion,
} from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';
import { EventRepository } from '../repositories/event.repository';
import { ConfigService } from './config.service';
import { EventService } from './event.service';
import { FederationService } from './federation.service';
import { RoomService } from './room.service';
import { StateService } from './state.service';

// File message content type
export type FileMessageContent = {
	body: string;
	msgtype: 'm.image' | 'm.file' | 'm.video' | 'm.audio';
	url: string;
	info?: {
		size?: number;
		mimetype?: string;
		w?: number;
		h?: number;
		duration?: number;
		thumbnail_url?: string;
		thumbnail_info?: {
			w?: number;
			h?: number;
			mimetype?: string;
			size?: number;
		};
	};
};

@singleton()
export class MessageService {
	private readonly logger = createLogger('MessageService');

	constructor(
		private readonly eventService: EventService,
		private readonly configService: ConfigService,

		private readonly federationService: FederationService,
		private readonly roomService: RoomService,
		private readonly stateService: StateService,

		private readonly eventRepository: EventRepository,
	) {}

	async sendMessage(
		roomId: string,
		rawMessage: string,
		formattedMessage: string,
		senderUserId: string,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(
				`Room version not found for room ${roomId} white trying to send message`,
			);
		}

		const event = await this.stateService.buildEvent<'m.room.message'>(
			{
				type: 'm.room.message',
				content: {
					msgtype: 'm.text',
					body: rawMessage,
					format: 'org.matrix.custom.html',
					formatted_body: formattedMessage,
				},
				room_id: roomId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderUserId,
			},
			roomVersion,
		);

		await this.stateService.persistTimelineEvent(event);
		if (event.rejected) {
			throw new Error(event.rejectedReason);
		}

		void this.federationService.sendEventToAllServersInRoom(event);

		return event;
	}

	async sendReplyToMessage(
		roomId: string,
		rawMessage: string,
		formattedMessage: string,
		eventToReplyTo: string,
		senderUserId: string,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(
				`Room version not found for room ${roomId} white trying to send message`,
			);
		}

		const event = await this.stateService.buildEvent<'m.room.message'>(
			{
				type: 'm.room.message',
				content: {
					msgtype: 'm.text',
					body: rawMessage,
					format: 'org.matrix.custom.html',
					formatted_body: formattedMessage,
					'm.relates_to': {
						'm.in_reply_to': {
							event_id: eventToReplyTo,
						},
					},
				},
				room_id: roomId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderUserId,
			},
			roomVersion,
		);

		await this.stateService.persistTimelineEvent(event);
		if (event.rejected) {
			throw new Error(event.rejectedReason);
		}

		void this.federationService.sendEventToAllServersInRoom(event);

		return event;
	}

	async sendFileMessage(
		roomId: string,
		content: FileMessageContent,
		senderUserId: string,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(
				`Room version not found for room ${roomId} while trying to send file message`,
			);
		}

		const event = await this.stateService.buildEvent<'m.room.message'>(
			{
				type: 'm.room.message',
				content: content,
				room_id: roomId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderUserId,
			},
			roomVersion,
		);

		await this.stateService.persistTimelineEvent(event);
		if (event.rejected) {
			throw new Error(event.rejectedReason);
		}

		void this.federationService.sendEventToAllServersInRoom(event);

		return event;
	}

	async sendThreadMessage(
		roomId: string,
		rawMessage: string,
		formattedMessage: string,
		senderUserId: string,
		threadRootEventId: string,
		latestThreadEventId?: string,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(
				`Room version not found for room ${roomId} while trying to send thread message`,
			);
		}

		const event = await this.stateService.buildEvent<'m.room.message'>(
			{
				type: 'm.room.message',
				content: {
					msgtype: 'm.text',
					body: rawMessage,
					format: 'org.matrix.custom.html',
					formatted_body: formattedMessage,
					'm.relates_to': !latestThreadEventId
						? {
								rel_type: 'm.thread',
								event_id: threadRootEventId,
								is_falling_back: true,
							}
						: {
								rel_type: 'm.thread',
								event_id: threadRootEventId,
								is_falling_back: true,
								'm.in_reply_to': { event_id: latestThreadEventId },
							},
				},
				room_id: roomId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderUserId,
			},
			roomVersion,
		);

		await this.stateService.persistTimelineEvent(event);
		if (event.rejected) {
			throw new Error(event.rejectedReason);
		}

		void this.federationService.sendEventToAllServersInRoom(event);

		return event;
	}

	async sendReplyToInsideThreadMessage(
		roomId: string,
		rawMessage: string,
		formattedMessage: string,
		senderUserId: string,
		threadRootEventId: string,
		eventToReplyTo: string,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(
				`Room version not found for room ${roomId} while trying to send thread message`,
			);
		}

		const event = await this.stateService.buildEvent<'m.room.message'>(
			{
				type: 'm.room.message',
				content: {
					msgtype: 'm.text',
					body: rawMessage,
					format: 'org.matrix.custom.html',
					formatted_body: formattedMessage,
					'm.relates_to': {
						rel_type: 'm.thread',
						event_id: threadRootEventId,
						'm.in_reply_to': {
							event_id: eventToReplyTo,
						},
					},
				},
				room_id: roomId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderUserId,
			},
			roomVersion,
		);

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
	): Promise<string> {
		const isTombstoned = await this.roomService.isRoomTombstoned(roomId);
		if (isTombstoned) {
			this.logger.warn(
				`Attempted to react to a message in a tombstoned room: ${roomId}`,
			);
			throw new ForbiddenError(
				'Cannot react to a message in a tombstoned room',
			);
		}

		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const reactionEvent = await this.stateService.buildEvent<'m.reaction'>(
			{
				type: 'm.reaction',
				content: {
					'm.relates_to': {
						rel_type: 'm.annotation',
						event_id: eventId,
						key: emoji,
					},
				},
				room_id: roomId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderUserId,
			},
			roomInfo.room_version,
		);

		await this.stateService.persistTimelineEvent(reactionEvent);

		void this.federationService.sendEventToAllServersInRoom(reactionEvent);

		return reactionEvent.eventId;
	}

	async unsetReaction(
		roomId: string,
		eventIdReactedTo: EventID,
		_emoji: string,
		senderUserId: string,
	): Promise<string> {
		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const redactionEvent =
			await this.stateService.buildEvent<'m.room.redaction'>(
				{
					type: 'm.room.redaction',
					content: {
						reason: 'Unsetting reaction',
					},
					redacts: eventIdReactedTo,
					room_id: roomId,
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: senderUserId,
				},
				roomInfo.room_version,
			);

		await this.stateService.persistTimelineEvent(redactionEvent);

		void this.federationService.sendEventToAllServersInRoom(redactionEvent);

		return redactionEvent.eventId;
	}

	async updateMessage(
		roomId: string,
		rawMessage: string,
		formattedMessage: string,
		senderUserId: string,
		eventIdToReplace: string,
	): Promise<string> {
		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const redactionEvent = await this.stateService.buildEvent<'m.room.message'>(
			{
				type: 'm.room.message',
				content: {
					msgtype: 'm.text',
					body: rawMessage,
					format: 'org.matrix.custom.html',
					formatted_body: formattedMessage,
					'm.new_content': {
						msgtype: 'm.text',
						body: rawMessage,
						format: 'org.matrix.custom.html',
						formatted_body: formattedMessage,
					},
					'm.relates_to': {
						rel_type: 'm.replace',
						event_id: eventIdToReplace,
					},
				},
				room_id: roomId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderUserId,
			},
			roomInfo.room_version,
		);

		await this.stateService.persistTimelineEvent(redactionEvent);

		void this.federationService.sendEventToAllServersInRoom(redactionEvent);

		return redactionEvent.eventId;
	}

	async redactMessage(
		roomId: string,
		eventIdToRedact: EventID,
	): Promise<string> {
		const isTombstoned = await this.roomService.isRoomTombstoned(roomId);
		if (isTombstoned) {
			this.logger.warn(
				`Attempted to delete a message in a tombstoned room: ${roomId}`,
			);
			throw new ForbiddenError('Cannot delete a message in a tombstoned room');
		}

		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const senderUserId = await this.eventService.getEventById(eventIdToRedact);
		if (!senderUserId?.event.sender) {
			throw new Error(`Sender user ID not found for event ${eventIdToRedact}`);
		}

		const redactionEvent =
			await this.stateService.buildEvent<'m.room.redaction'>(
				{
					type: 'm.room.redaction',
					content: {
						reason: `Deleting message: ${eventIdToRedact}`,
					},
					redacts: eventIdToRedact,
					room_id: roomId,
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: senderUserId.event.sender,
				},
				roomInfo.room_version,
			);

		await this.stateService.persistTimelineEvent(redactionEvent);

		void this.federationService.sendEventToAllServersInRoom(redactionEvent);

		return redactionEvent.eventId;
	}
}
