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
export type {
	FederationModuleAsyncOptions,
	FederationModuleOptions,
} from './federation.module';

export { FederationConfigService } from './services/federation-config.service';
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

// Utility exports
export {
	toBinaryData,
	fromBinaryData,
	toUnpaddedBase64,
} from './utils/binaryData';
export {
	EncryptionValidAlgorithm,
	signJson,
	signText,
	encodeCanonicalJson,
	verifySignature,
	verifyJsonSignature,
	verifySignaturesFromRemote,
	getSignaturesFromRemote,
	isValidAlgorithm,
	type SignedJson,
} from './utils/signJson';
export {
	generateKeyPairs,
	generateKeyPairsFromString,
	getKeyPair,
	type SigningKey,
} from './utils/keys';

// Authentication utilities
export {
	authorizationHeaders,
	computeAndMergeHash,
	computeHash,
	extractSignaturesFromHeader,
	signRequest,
	validateAuthorizationHeader,
	type HashedEvent,
} from './utils/authentication';

// URL utilities
export { extractURIfromURL } from './utils/url';
