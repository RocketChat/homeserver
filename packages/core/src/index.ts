// Core authentication and crypto
export {
	generateId,
	authorizationHeaders,
	computeAndMergeHash,
	extractSignaturesFromHeader,
	signRequest,
	validateAuthorizationHeader,
	computeHash,
} from './authentication';
export type { HashedEvent } from './authentication';

export {
	generateKeyPairs,
	generateKeyPairsFromString,
	getKeyPair,
} from './keys';
export type { SigningKey } from './keys';

export { signEvent } from './signEvent';
export type { SignedEvent } from './signEvent';

export {
	encodeCanonicalJson,
	signJson,
	signText,
	verifySignaturesFromRemote,
	verifyJsonSignature,
	getSignaturesFromRemote,
	EncryptionValidAlgorithm,
} from './signJson';
export type {
	SignedJson,
	ProtocolVersionKey,
} from './signJson';

export { pruneEventDict } from './pruneEventDict';

export { makeRequest, makeUnsignedRequest } from './makeRequest';

// Errors
export {
	MatrixError,
	ForbiddenError,
	HttpException,
	HttpStatus,
	NotFoundError,
	IncompatibleRoomVersionError,
} from './errors';

// Event types
export type { EventBase } from './events/eventBase';

// Room events
export { createRoomCreateEvent, roomCreateEvent } from './events/m.room.create';
export type { RoomCreateEvent } from './events/m.room.create';

export { createRoomMemberEvent, roomMemberEvent } from './events/m.room.member';
export type { RoomMemberEvent, AuthEvents } from './events/m.room.member';

export { createRoomNameEvent, roomNameEvent } from './events/m.room.name';
export type { RoomNameEvent, RoomNameAuthEvents } from './events/m.room.name';

export {
	createRoomPowerLevelsEvent,
	roomPowerLevelsEvent,
	isRoomPowerLevelsEvent,
} from './events/m.room.power_levels';
export type { RoomPowerLevelsEvent } from './events/m.room.power_levels';

export {
	createRoomTombstoneEvent,
	roomTombstoneEvent,
} from './events/m.room.tombstone';
export type {
	RoomTombstoneEvent,
	TombstoneAuthEvents,
} from './events/m.room.tombstone';

export {
	createRoomJoinRulesEvent,
	roomJoinRulesEvent,
} from './events/m.room.join_rules';
export type { RoomJoinRulesEvent } from './events/m.room.join_rules';

export {
	createRoomGuestAccessEvent,
	roomGuestAccessEvent,
} from './events/m.room.guest_access';
export type { RoomGuestAccessEvent } from './events/m.room.guest_access';

export {
	createRoomHistoryVisibilityEvent,
	roomHistoryVisibilityEvent,
} from './events/m.room.history_visibility';
export type { RoomHistoryVisibilityEvent } from './events/m.room.history_visibility';

export {
	createRedactionEvent,
	redactionEvent,
} from './events/m.room.redaction';
export type {
	RedactionEvent,
	RedactionAuthEvents,
} from './events/m.room.redaction';

export {
	createRoomMessageEvent,
	roomMessageEvent,
} from './events/m.room.message';
export type {
	RoomMessageEvent,
	MessageAuthEvents,
} from './events/m.room.message';

export { createReactionEvent, reactionEvent } from './events/m.reaction';
export type { ReactionEvent, ReactionAuthEvents } from './events/m.reaction';

// Event utilities
export {
	createSignedEvent,
	createEventWithId,
} from './events/utils/createSignedEvent';

// PDU types
export type { MatrixPDU } from './events/pdu';
export { isFederationEventWithPDUs } from './events/pdu';

// Server types
export type { ServerKey } from './server';

// Helper functions
export { extractURIfromURL } from './helpers/url';

// Procedures
export { createRoom } from './procedures/createRoom';
export { makeJoinEventBuilder } from './procedures/makeJoin';
export { getPublicKeyFromRemoteServer } from './procedures/getPublicKeyFromServer';

// Models
export type { EventStore } from './models/event.model';
