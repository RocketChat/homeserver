import type { Membership } from '@hs/core';
import { container } from 'tsyringe';
import { ConfigService } from './services/config.service';
import { EventService } from './services/event.service';
import { InviteService } from './services/invite.service';
import { MessageService } from './services/message.service';
import { ProfilesService } from './services/profiles.service';
import { RoomService } from './services/room.service';
import { SendJoinService } from './services/send-join.service';
import { ServerService } from './services/server.service';
import { StateService } from './services/state.service';
import { WellKnownService } from './services/well-known.service';

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
export { SignatureVerificationService } from './services/signature-verification.service';
export { WellKnownService } from './services/well-known.service';
export { ConfigService } from './services/config.service';
export type { AppConfig } from './services/config.service';
export { DatabaseConnectionService } from './services/database-connection.service';

export { ServerService } from './services/server.service';
export { EventAuthorizationService } from './services/event-authorization.service';
export { EventStateService } from './services/event-state.service';
export { MissingEventService } from './services/missing-event.service';
export { ProfilesService } from './services/profiles.service';
export { NotificationService } from './services/notification.service';
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
export { MissingEventListener } from './services/missing-event.listener';

// Repository interfaces and implementations

// Queue implementations
export { BaseQueue, type QueueHandler } from './queues/base.queue';
export {
	StagingAreaQueue,
	type StagingAreaEventType,
} from './queues/staging-area.queue';
export {
	MissingEventsQueue,
	type MissingEventType,
} from './queues/missing-event.queue';
export { QueueModule } from './queues/queue.module';

// Utility exports
export { getErrorMessage } from './utils/get-error-message';
export { USERNAME_REGEX, ROOM_ID_REGEX } from './utils/validation-regex';
export {
	eventSchemas,
	roomV10Schemas,
	type BaseEventType,
} from './utils/event-schemas';
export {
	LockManagerService,
	Lock,
	type LockOptions,
	type LockConfig,
	type MemoryLockConfig,
	type NatsLockConfig,
	type ExternalLockConfig,
	type ILockProvider,
} from './utils/lock.decorator';

// DTOs
export * from './dtos';

export { EventRepository } from './repositories/event.repository';
export { RoomRepository } from './repositories/room.repository';
export { StateEventRepository } from './repositories/state-event.repository';
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
}

export type HomeserverEventSignatures = {
	'homeserver.ping': {
		message: string;
	};
	'homeserver.matrix.message': {
		event_id: string;
		room_id: string;
		sender: string;
		origin_server_ts: number;
		content: {
			body: string;
			msgtype: string;
		};
	};
	'homeserver.matrix.accept-invite': {
		event_id: string;
		room_id: string;
		sender: string;
		origin_server_ts: number;
		content: {
			avatar_url: string | null;
			displayname: string;
			membership: Membership;
		};
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
	};
}

export { StagingAreaListener } from './listeners/staging-area.listener';

export {
	createFederationContainer,
	type FederationContainerOptions,
} from './container';

export { DependencyContainer } from 'tsyringe';
