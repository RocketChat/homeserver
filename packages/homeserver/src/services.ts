import { container } from 'tsyringe';
import { RoomService } from './services/room.service';
import { MessageService } from '@hs/federation-sdk/src/services/message.service';
import { EventService } from '@hs/federation-sdk/src/services/event.service';
import { InviteService } from '@hs/federation-sdk/src/services/invite.service';
import { WellKnownService } from '@hs/federation-sdk/src/services/well-known.service';
import { ProfilesService } from '@hs/federation-sdk/src/services/profiles.service';

export interface HomeserverServices {
	room: RoomService;
	message: MessageService;
	event: EventService;
	invite: InviteService;
	wellKnown: WellKnownService;
	profile: ProfilesService;
}

export function getAllServices(): HomeserverServices {
	return {
		room: container.resolve(RoomService),
		message: container.resolve(MessageService),
		event: container.resolve(EventService),
		invite: container.resolve(InviteService),
		wellKnown: container.resolve(WellKnownService),
		profile: container.resolve(ProfilesService),
	};
}
