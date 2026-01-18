import { ForbiddenError } from '@rocket.chat/federation-core';
import { createLogger } from '@rocket.chat/federation-core';
import {
	type EventID,
	type PersistentEventBase,
	type RoomID,
	type UserID,
} from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';
import { addSpanAttributes, traced, tracedClass } from '../utils/tracing';
import { EventService } from './event.service';
import { FederationService } from './federation.service';
import { RoomService } from './room.service';
import { StateService } from './state.service';

type Reply =
	| {
			threadEventId: EventID;
			replyToEventId: EventID;
			showInMainChat?: boolean;
	  }
	| {
			threadEventId: EventID;
			latestThreadEventId: EventID;
			showInMainChat?: boolean;
	  }
	| {
			replyToEventId: EventID;
	  };

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

@tracedClass({ type: 'service', className: 'MessageService' })
@singleton()
export class MessageService {
	private readonly logger = createLogger('MessageService');

	constructor(
		private readonly eventService: EventService,
		private readonly federationService: FederationService,
		private readonly roomService: RoomService,
		private readonly stateService: StateService,
	) {}

	private buildReplyContent(reply: Reply) {
		if (
			'replyToEventId' in reply &&
			reply?.replyToEventId &&
			'threadEventId' in reply &&
			reply?.threadEventId
		) {
			return {
				'm.relates_to': {
					...(!reply.showInMainChat && { rel_type: 'm.thread' as const }),
					is_falling_back: false,
					event_id: reply.threadEventId,
					'm.in_reply_to': { event_id: reply.replyToEventId },
				},
			} as const;
		}

		if (
			'threadEventId' in reply &&
			reply?.threadEventId &&
			'latestThreadEventId' in reply &&
			reply?.latestThreadEventId
		) {
			return {
				'm.relates_to': {
					...(!reply.showInMainChat && { rel_type: 'm.thread' as const }),
					event_id: reply.threadEventId,
					is_falling_back: true,
					'm.in_reply_to': { event_id: reply.latestThreadEventId },
				},
			} as const;
		}

		if ('replyToEventId' in reply && reply?.replyToEventId) {
			return {
				'm.relates_to': {
					'm.in_reply_to': {
						event_id: reply.replyToEventId,
					},
				},
			} as const;
		}
	}

	@traced(
		(
			roomId: RoomID,
			rawMessage: string,
			_formattedMessage: string,
			senderUserId: UserID,
			reply?: Reply,
		) => ({
			roomId,
			senderUserId,
			hasReply: Boolean(reply),
			messageLength: rawMessage?.length,
		}),
	)
	async sendMessage(
		roomId: RoomID,
		rawMessage: string,
		formattedMessage: string,
		senderUserId: UserID,
		reply?: Reply,
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
					...(reply && this.buildReplyContent(reply)),
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

		// Add runtime attributes after event is created
		addSpanAttributes({
			eventId: event.eventId,
			roomVersion,
		});

		await this.stateService.handlePdu(event);
		if (event.rejected) {
			throw new Error(event.rejectReason);
		}

		void this.federationService.sendEventToAllServersInRoom(event);

		return event;
	}

	/**
	 *
	 * @deprecated Use sendMessage and replyToEventId instead
	 */
	@traced(
		(
			roomId: RoomID,
			rawMessage: string,
			_formattedMessage: string,
			eventToReplyTo: EventID,
			senderUserId: UserID,
		) => ({
			roomId,
			senderUserId,
			eventToReplyTo,
			messageLength: rawMessage?.length,
		}),
	)
	async sendReplyToMessage(
		roomId: RoomID,
		rawMessage: string,
		formattedMessage: string,
		eventToReplyTo: EventID,
		senderUserId: UserID,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(
				`Room version not found for room ${roomId} white trying to send message`,
			);
		}

		return this.sendMessage(
			roomId,
			rawMessage,
			formattedMessage,
			senderUserId,
			{
				replyToEventId: eventToReplyTo,
			},
		);
	}

	@traced(
		(
			roomId: RoomID,
			content: FileMessageContent,
			senderUserId: UserID,
			reply?: Reply,
		) => ({
			roomId,
			senderUserId,
			hasReply: Boolean(reply),
			msgtype: content?.msgtype,
			mimetype: content?.info?.mimetype,
		}),
	)
	async sendFileMessage(
		roomId: RoomID,
		content: FileMessageContent,
		senderUserId: UserID,
		reply?: Reply,
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
				content: {
					...content,
					...(reply && this.buildReplyContent(reply)),
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

		// Add runtime attributes after event is created
		addSpanAttributes({
			eventId: event.eventId,
			roomVersion,
		});

		await this.stateService.handlePdu(event);
		if (event.rejected) {
			throw new Error(event.rejectReason);
		}

		void this.federationService.sendEventToAllServersInRoom(event);

		return event;
	}

	/**
	 * @deprecated Use sendMessage and threadEventId/replyToEventId instead
	 */
	@traced(
		(
			roomId: RoomID,
			rawMessage: string,
			_formattedMessage: string,
			senderUserId: UserID,
			threadRootEventId: EventID,
		) => ({
			roomId,
			senderUserId,
			threadRootEventId,
			messageLength: rawMessage?.length,
		}),
	)
	async sendThreadMessage(
		roomId: RoomID,
		rawMessage: string,
		formattedMessage: string,
		senderUserId: UserID,
		threadRootEventId: EventID,
		latestThreadEventId?: EventID,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(
				`Room version not found for room ${roomId} while trying to send thread message`,
			);
		}

		return this.sendMessage(
			roomId,
			rawMessage,
			formattedMessage,
			senderUserId,
			{
				threadEventId: threadRootEventId,
				latestThreadEventId: latestThreadEventId ?? threadRootEventId,
			},
		);
	}

	/**
	 * @deprecated Use sendMessage and threadEventId/replyToEventId instead
	 */
	@traced(
		(
			roomId: RoomID,
			rawMessage: string,
			_formattedMessage: string,
			senderUserId: UserID,
			threadRootEventId: EventID,
			eventToReplyTo: EventID,
		) => ({
			roomId,
			senderUserId,
			threadRootEventId,
			eventToReplyTo,
			messageLength: rawMessage?.length,
		}),
	)
	async sendReplyToInsideThreadMessage(
		roomId: RoomID,
		rawMessage: string,
		formattedMessage: string,
		senderUserId: UserID,
		threadRootEventId: EventID,
		eventToReplyTo: EventID,
	): Promise<PersistentEventBase> {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error(
				`Room version not found for room ${roomId} while trying to send thread message`,
			);
		}

		return this.sendMessage(
			roomId,
			rawMessage,
			formattedMessage,
			senderUserId,
			{
				threadEventId: threadRootEventId,
				replyToEventId: eventToReplyTo,
			},
		);
	}

	@traced(
		(roomId: RoomID, eventId: EventID, emoji: string, senderUserId: UserID) => ({
			roomId,
			eventId,
			emoji,
			senderUserId,
		}),
	)
	async sendReaction(
		roomId: RoomID,
		eventId: EventID,
		emoji: string,
		senderUserId: UserID,
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

		// Add runtime attributes after event is created
		addSpanAttributes({
			reactionEventId: reactionEvent.eventId,
			roomVersion: roomInfo.room_version,
		});

		await this.stateService.handlePdu(reactionEvent);

		void this.federationService.sendEventToAllServersInRoom(reactionEvent);

		return reactionEvent.eventId;
	}

	@traced(
		(
			roomId: RoomID,
			eventIdReactedTo: EventID,
			emoji: string,
			senderUserId: UserID,
		) => ({
			roomId,
			eventIdReactedTo,
			emoji,
			senderUserId,
		}),
	)
	async unsetReaction(
		roomId: RoomID,
		eventIdReactedTo: EventID,
		_emoji: string,
		senderUserId: UserID,
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

		// Add runtime attributes after event is created
		addSpanAttributes({
			redactionEventId: redactionEvent.eventId,
			roomVersion: roomInfo.room_version,
		});

		await this.stateService.handlePdu(redactionEvent);

		void this.federationService.sendEventToAllServersInRoom(redactionEvent);

		return redactionEvent.eventId;
	}

	@traced(
		(
			roomId: RoomID,
			rawMessage: string,
			_formattedMessage: string,
			senderUserId: UserID,
			eventIdToReplace: EventID,
		) => ({
			roomId,
			senderUserId,
			eventIdToReplace,
			messageLength: rawMessage?.length,
		}),
	)
	async updateMessage(
		roomId: RoomID,
		rawMessage: string,
		formattedMessage: string,
		senderUserId: UserID,
		eventIdToReplace: EventID,
	): Promise<string> {
		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const updateEvent = await this.stateService.buildEvent<'m.room.message'>(
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

		// Add runtime attributes after event is created
		addSpanAttributes({
			updateEventId: updateEvent.eventId,
			roomVersion: roomInfo.room_version,
		});

		await this.stateService.handlePdu(updateEvent);

		void this.federationService.sendEventToAllServersInRoom(updateEvent);

		return updateEvent.eventId;
	}

	@traced((roomId: RoomID, eventIdToRedact: EventID) => ({
		roomId,
		eventIdToRedact,
	}))
	async redactMessage(
		roomId: RoomID,
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

		// Add runtime attributes after event is created
		addSpanAttributes({
			redactionEventId: redactionEvent.eventId,
			roomVersion: roomInfo.room_version,
			originalSender: senderUserId.event.sender,
		});

		await this.stateService.handlePdu(redactionEvent);

		void this.federationService.sendEventToAllServersInRoom(redactionEvent);

		return redactionEvent.eventId;
	}
}
