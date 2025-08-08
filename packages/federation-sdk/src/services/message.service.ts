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
import { signEvent } from '@hs/core';
import {
	type PersistentEventBase,
	PersistentEventFactory,
	type RoomVersion,
} from '@hs/room';
import { inject } from 'tsyringe';
import { singleton } from 'tsyringe';
import type { EventRepository } from '../repositories/event.repository';
import type { ConfigService } from './config.service';
import { EventService, EventType } from './event.service';
import { FederationService } from './federation.service';
import type { RoomService } from './room.service';
import type { StateService } from './state.service';

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
		@inject('EventRepository')
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

		const event = PersistentEventFactory.newRichTextMessageEvent(
			roomId,
			senderUserId,
			rawMessage,
			formattedMessage,
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

		const event = PersistentEventFactory.newRichTextThreadMessageEvent(
			roomId,
			senderUserId,
			rawMessage,
			formattedMessage,
			threadRootEventId,
			latestThreadEventId,
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

		const reactionEvent = PersistentEventFactory.newReactionEvent(
			roomId,
			senderUserId,
			eventId,
			emoji,
			roomInfo.room_version as RoomVersion,
		);

		await this.stateService.addAuthEvents(reactionEvent);

		await this.stateService.addPrevEvents(reactionEvent);

		await this.stateService.signEvent(reactionEvent);

		await this.stateService.persistTimelineEvent(reactionEvent);

		void this.federationService.sendEventToAllServersInRoom(reactionEvent);

		return reactionEvent.eventId;
	}

	async unsetReaction(
		roomId: string,
		eventIdReactedTo: string,
		_emoji: string,
		senderUserId: string,
	): Promise<string> {
		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const redactionEvent = PersistentEventFactory.newRedactionEvent(
			roomId,
			senderUserId,
			eventIdReactedTo,
			'Unsetting reaction',
			roomInfo.room_version as RoomVersion,
		);

		await this.stateService.addAuthEvents(redactionEvent);

		await this.stateService.addPrevEvents(redactionEvent);

		await this.stateService.signEvent(redactionEvent);

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

		const redactionEvent = PersistentEventFactory.newRichTextMessageUpdateEvent(
			roomId,
			senderUserId,
			rawMessage,
			formattedMessage,
			eventIdToReplace,
			roomInfo.room_version as RoomVersion,
		);

		await this.stateService.addAuthEvents(redactionEvent);

		await this.stateService.addPrevEvents(redactionEvent);

		await this.stateService.signEvent(redactionEvent);

		await this.stateService.persistTimelineEvent(redactionEvent);

		void this.federationService.sendEventToAllServersInRoom(redactionEvent);

		return redactionEvent.eventId;
	}

	async redactMessage(
		roomId: string,
		eventIdToRedact: string,
		senderUserId: string,
	): Promise<string> {
		const isTombstoned = await this.roomService.isRoomTombstoned(roomId);
		if (isTombstoned) {
			this.logger.warn(
				`Attempted to delete a message in a tombstoned room: ${roomId}`,
			);
			throw new ForbiddenError('Cannot delete a message in a tombstoned room');
		}

		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const redactionEvent = PersistentEventFactory.newRedactionEvent(
			roomId,
			senderUserId,
			eventIdToRedact,
			`Deleting message: ${eventIdToRedact}`,
			roomInfo.room_version as RoomVersion,
		);

		await this.stateService.addAuthEvents(redactionEvent);

		await this.stateService.addPrevEvents(redactionEvent);

		await this.stateService.signEvent(redactionEvent);

		await this.stateService.persistTimelineEvent(redactionEvent);

		void this.federationService.sendEventToAllServersInRoom(redactionEvent);

		return redactionEvent.eventId;
	}
}
