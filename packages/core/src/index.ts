// Types
export { EncryptionValidAlgorithm } from './types';
export type { SignedEvent, SigningKey } from './types';

// Event utilities
export { signEvent } from './utils/signEvent';

// Authentication utilities
export { generateId } from './utils/generateId';
export { pruneEventDict } from './utils/pruneEventDict';
export { checkSignAndHashes } from './utils/checkSignAndHashes';
export {
	authorizationHeaders,
	computeAndMergeHash,
	computeHash,
	extractSignaturesFromHeader,
	signRequest,
	validateAuthorizationHeader,
	type HashedEvent,
} from './utils/authentication';

// Signing utilities
export type { ProtocolVersionKey, SignedJson } from './utils/signJson';
export {
	signJson,
	isValidAlgorithm,
	getSignaturesFromRemote,
	verifySignature,
	verifyJsonSignature,
	verifySignaturesFromRemote,
	encodeCanonicalJson,
	signText,
	signData,
} from './utils/signJson';

// Binary data utilities
export {
	toBinaryData,
	fromBinaryData,
	toUnpaddedBase64,
} from './utils/binaryData';

// Keys utilities
export * from './utils/keys';

// Event types and functions
export * from './events/eventBase';
export * from './events/m.room.create';
export * from './events/m.room.member';
export * from './events/m.room.message';
export * from './events/m.room.power_levels';
export * from './events/m.room.join_rules';
export * from './events/m.room.history_visibility';
export * from './events/m.room.guest_access';
export * from './events/m.room.tombstone';
export * from './events/m.room.name';
export * from './events/m.room.redaction';
export * from './events/m.room.third_party_invite';
export * from './events/m.reaction';
export * from './events/pdu';

export * from './events/edu';

export type { RoomMemberEvent, Membership } from './events/isRoomMemberEvent';

export { isRoomMemberEvent } from './events/isRoomMemberEvent';

// Event utilities
export * from './events/utils/createSignedEvent';

// Event models
export * from './models/event.model';

// Procedures
export { makeJoinEventBuilder } from './procedures/makeJoin';
export { makeGetMissingEventsProcedure } from './procedures/getMissingEvents';
export {
	makeGetPublicKeyFromServerProcedure,
	getPublicKeyFromRemoteServer,
} from './procedures/getPublicKeyFromServer';

export { createLogger, logger } from './utils/logger';

export * from './errors';
export * from './url';

export { makeUnsignedRequest } from './utils/makeRequest';

export type { FetchResponse } from './utils/fetch';

export { fetch } from './utils/fetch';
