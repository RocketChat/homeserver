import { type RoomMemberEvent, isRoomMemberEvent } from '@hs/core';
import { inject, singleton } from 'tsyringe';
import type { ConfigService } from './config.service';
import { EventEmitterService } from './event-emitter.service';
import type { EventService } from './event.service';

@singleton()
export class SendJoinService {
	constructor(
		@inject('EventService') private readonly eventService: EventService,
		@inject('ConfigService') private readonly configService: ConfigService,
		@inject(EventEmitterService)
		private readonly emitterService: EventEmitterService,
	) {}

	async sendJoin(roomId: string, stateKey: string, event: RoomMemberEvent) {
		const records = await this.eventService.findEvents(
			{ 'event.room_id': roomId },
			{ sort: { 'event.depth': 1 } },
		);
		const events = records.map((event) => event.event);
		const lastInviteEvent = records.find(
			(record) =>
				isRoomMemberEvent(record.event) &&
				record.event.content.membership === 'invite',
		);
		const eventToSave = {
			...event,
			origin: event.origin || this.configService.getServerConfig().name,
		};
		const result = {
			event: {
				...event,
				unsigned: lastInviteEvent
					? {
							replaces_state: lastInviteEvent._id,
							prev_content: lastInviteEvent.event.content,
							prev_sender: lastInviteEvent.event.sender,
						}
					: undefined,
			},
			state: events.map((event) => ({ ...event })),
			auth_chain: events
				.filter((event) => event.depth && event.depth <= 4)
				.map((event) => ({ ...event })),
			members_omitted: false,
			origin: this.configService.getServerConfig().name,
		};
		let eventId = stateKey;
		if ((await this.eventService.findEvents({ _id: stateKey })).length === 0) {
			eventId = await this.eventService.insertEvent(eventToSave, stateKey);
		}

		this.emitterService.emit('homeserver.matrix.accept-invite', {
			event_id: eventId,
			room_id: roomId,
			sender: eventToSave.sender,
			origin_server_ts: eventToSave.origin_server_ts,
			content: {
				avatar_url: eventToSave.content.avatar_url || null,
				displayname: eventToSave.content.displayname || '',
				membership: eventToSave.content.membership || 'join',
			},
		});

		return result;
	}
}
