import type { Membership, MessageType } from '@rocket.chat/federation-core';
import type { EventID, PduForType } from '@rocket.chat/federation-room';
import { container } from 'tsyringe';
import { ConfigService } from './services/config.service';
import { EduService } from './services/edu.service';
import { EventAuthorizationService } from './services/event-authorization.service';
import { EventService } from './services/event.service';
import { FederationRequestService } from './services/federation-request.service';
import { InviteService } from './services/invite.service';
import { MediaService } from './services/media.service';
import { MessageService } from './services/message.service';
import { ProfilesService } from './services/profiles.service';
import { RoomService } from './services/room.service';
import { SendJoinService } from './services/send-join.service';
import { ServerService } from './services/server.service';
import { StateService } from './services/state.service';
import { WellKnownService } from './services/well-known.service';

export type {
	Pdu,
	PduForType,
	PduMembershipEventContent,
	PduType,
	PersistentEventBase,
	RoomVersion,
	EventID,
	UserID,
	RoomID,
} from '@rocket.chat/federation-room';
export type {
	EventStore,
	FileMessageType,
	PresenceState,
	FileMessageContent,
	MessageType,
	Membership,
} from '@rocket.chat/federation-core';
export { generateEd25519RandomSecretKey } from '@rocket.chat/federation-crypto';

export { FederationEndpoints } from './specs/federation-api';
export type {
	MakeJoinResponse,
	SendJoinResponse,
	SendTransactionResponse,
	State,
	StateIds,
	Transaction,
	Version,
} from './specs/federation-api';

export { FederationModule } from './federation.module';

export { FederationRequestService } from './services/federation-request.service';
export { FederationService } from './services/federation.service';
export { WellKnownService } from './services/well-known.service';
export { ConfigService } from './services/config.service';
export type { AppConfig } from './services/config.service';
export { DatabaseConnectionService } from './services/database-connection.service';
export { EduService } from './services/edu.service';

export { ServerService } from './services/server.service';
export { EventAuthorizationService } from './services/event-authorization.service';
export { MissingEventService } from './services/missing-event.service';
export { ProfilesService } from './services/profiles.service';
export { EventFetcherService } from './services/event-fetcher.service';
export type { FetchedEvents } from './services/event-fetcher.service';
export { InviteService } from './services/invite.service';
export type { ProcessInviteEvent } from './services/invite.service';
export { MessageService } from './services/message.service';
export { EventService } from './services/event.service';
export { RoomService } from './services/room.service';
export { StateService } from './services/state.service';
export { StagingAreaService } from './services/staging-area.service';
export { SendJoinService } from './services/send-join.service';
export { EventEmitterService } from './services/event-emitter.service';
export { MediaService } from './services/media.service';
// Repository interfaces and implementations

// Queue implementations
export { BaseQueue, type QueueHandler } from './queues/base.queue';
export { StagingAreaQueue } from './queues/staging-area.queue';

// Utility exports
export { getErrorMessage } from './utils/get-error-message';
export { USERNAME_REGEX, ROOM_ID_REGEX } from './utils/validation-regex';
export {
	eventSchemas,
	roomV10Schemas,
	type BaseEventType,
} from './utils/event-schemas';
export { errCodes } from './utils/response-codes';

export { EventRepository } from './repositories/event.repository';
export { RoomRepository } from './repositories/room.repository';
export { ServerRepository } from './repositories/server.repository';
export { KeyRepository } from './repositories/key.repository';
export { StateRepository } from './repositories/state.repository';

export interface HomeserverServices {
	room: RoomService;
	message: MessageService;
	event: EventService;
	invite: InviteService;
	wellKnown: WellKnownService;
	profile: ProfilesService;
	state: StateService;
	sendJoin: SendJoinService;
	server: ServerService;
	config: ConfigService;
	edu: EduService;
	media: MediaService;
	request: FederationRequestService;
	federationAuth: EventAuthorizationService;
}

export type HomeserverEventSignatures = {
	'homeserver.ping': {
		message: string;
	};
	'homeserver.matrix.typing': {
		room_id: string;
		user_id: string;
		typing: boolean;
		origin?: string;
	};
	'homeserver.matrix.presence': {
		user_id: string;
		presence: 'online' | 'offline' | 'unavailable';
		last_active_ago?: number;
		origin?: string;
	};
	'homeserver.matrix.message': {
		event_id: EventID;
		event: PduForType<'m.room.message'>;

		room_id: string;
		sender: string;
		origin_server_ts: number;
		content: {
			body: string;
			msgtype: MessageType;
			url?: string;
			'm.relates_to'?:
				| {
						rel_type: 'm.replace';
						event_id: EventID;
				  }
				| {
						rel_type: 'm.annotation';
						event_id: EventID;
						key: string;
				  }
				| {
						rel_type: 'm.thread';
						event_id: EventID;
						'm.in_reply_to'?: {
							event_id: EventID;
							room_id: string;
							sender: string;
							origin_server_ts: number;
						};
						is_falling_back?: boolean;
				  }
				| {
						// SPEC: Though rich replies form a relationship to another event, they do not use rel_type to create this relationship.
						// Instead, a subkey named m.in_reply_to is used to describe the reply’s relationship,

						// rich {"body":"quote","m.mentions":{},"m.relates_to":{"is_falling_back":false,"m.in_reply_to":{"event_id":"$0vkvf2Ha_FdWe3zVaoDw3X15VCyZIZRYrHQXuoZDURQ"}},"msgtype":"m.text"}

						'm.in_reply_to': {
							event_id: EventID;
						};
						is_falling_back?: boolean;
				  };
			'm.new_content'?: {
				body: string;
				msgtype: MessageType;
				'm.mentions'?: Record<string, string>;
			};
			formatted_body?: string;
			info?: {
				mimetype?: string;
				w?: number;
				h?: number;
				size?: number;
				thumbnail_file?: {
					hashes: {
						sha256: string;
					};
					iv: string;
					key: {
						alg: string;
						ext: boolean;
						k: string;
						key_ops: ['encrypt' | 'decrypt'];
						kty: string;
					};
					url: string;
					v: 'v2';
				};
				thumbnail_info?: {
					w?: number;
					h?: number;
					size?: number;
					mimetype?: string;
				};
			};
		};
	};
	'homeserver.matrix.reaction': {
		event_id: EventID;
		event: PduForType<'m.reaction'>;

		room_id: string;
		sender: string;
		origin_server_ts: number;
		content: {
			'm.relates_to': {
				rel_type: 'm.annotation';
				event_id: EventID;
				key: string;
			};
		};
	};
	'homeserver.matrix.redaction': {
		event_id: EventID;
		event: PduForType<'m.room.redaction'>;

		room_id: string;
		sender: string;
		origin_server_ts: number;
		redacts: EventID;
		content: {
			reason?: string;
		};
	};
	'homeserver.matrix.membership': {
		event_id: EventID;
		event: PduForType<'m.room.member'>;

		room_id: string;
		sender: string;
		state_key: string;
		origin_server_ts: number;
		content: {
			membership: Membership;
			displayname?: string;
			avatar_url?: string;
			reason?: string;
		};
	};
	'homeserver.matrix.room.name': {
		event_id: EventID;
		event: PduForType<'m.room.name'>;
		room_id: string; // name of the room being changed
		user_id: string; // user who changed the name
		name: string; // new name of the room
	};
	'homeserver.matrix.room.topic': {
		event_id: EventID;
		event: PduForType<'m.room.topic'>;

		room_id: string; // topic of the room being changed
		user_id: string; // user who changed the topic
		topic: string; // new topic of the room
	};
	'homeserver.matrix.room.power_levels': {
		event_id: EventID;
		event: PduForType<'m.room.power_levels'>;
	};
	'homeserver.matrix.room.role': {
		sender_id: string; // who changed
		user_id: string; // whose changed
		room_id: string; // room where the change happened
		role: 'moderator' | 'owner' | 'user'; // 50, 100, 0
	};
};

export function getAllServices(): HomeserverServices {
	return {
		room: container.resolve(RoomService),
		message: container.resolve(MessageService),
		event: container.resolve(EventService),
		invite: container.resolve(InviteService),
		wellKnown: container.resolve(WellKnownService),
		profile: container.resolve(ProfilesService),
		state: container.resolve(StateService),
		sendJoin: container.resolve(SendJoinService),
		server: container.resolve(ServerService),
		config: container.resolve(ConfigService),
		edu: container.resolve(EduService),
		media: container.resolve(MediaService),
		request: container.resolve(FederationRequestService),
		federationAuth: container.resolve(EventAuthorizationService),
	};
}

export { StagingAreaListener } from './listeners/staging-area.listener';

export {
	createFederationContainer,
	type FederationContainerOptions,
} from './container';

export { DependencyContainer } from 'tsyringe';

export {
	roomIdSchema,
	userIdSchema,
	eventIdSchema,
} from '@rocket.chat/federation-room';
