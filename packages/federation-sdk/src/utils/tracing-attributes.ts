import type { EventID, RoomID, UserID } from '@rocket.chat/federation-room';
import type { Pdu, PersistentEventBase } from '@rocket.chat/federation-room';
import type { FileMessageContent } from '../services/message.service';
import type { ITraceInstanceMethodsOptions } from './tracing';

/**
 * Attribute extractors for MessageService methods.
 * These extract relevant debugging info from method arguments to add to trace spans.
 */
export const messageServiceAttributeExtractors: ITraceInstanceMethodsOptions['attributeExtractors'] =
	{
		sendMessage: (args) => {
			const [roomId, rawMessage, _formattedMessage, senderUserId, reply] =
				args as [RoomID, string, string, UserID, unknown];
			return {
				roomId,
				senderUserId,
				hasReply: Boolean(reply),
				messageLength: rawMessage?.length,
			};
		},

		sendReplyToMessage: (args) => {
			const [
				roomId,
				rawMessage,
				_formattedMessage,
				eventToReplyTo,
				senderUserId,
			] = args as [RoomID, string, string, EventID, UserID];
			return {
				roomId,
				senderUserId,
				eventToReplyTo,
				messageLength: rawMessage?.length,
			};
		},

		sendFileMessage: (args) => {
			const [roomId, content, senderUserId, reply] = args as [
				RoomID,
				FileMessageContent,
				UserID,
				unknown,
			];
			return {
				roomId,
				senderUserId,
				hasReply: Boolean(reply),
				msgtype: content?.msgtype,
				mimetype: content?.info?.mimetype,
			};
		},

		sendThreadMessage: (args) => {
			const [
				roomId,
				rawMessage,
				_formattedMessage,
				senderUserId,
				threadRootEventId,
			] = args as [RoomID, string, string, UserID, EventID];
			return {
				roomId,
				senderUserId,
				threadRootEventId,
				messageLength: rawMessage?.length,
			};
		},

		sendReplyToInsideThreadMessage: (args) => {
			const [
				roomId,
				rawMessage,
				_formattedMessage,
				senderUserId,
				threadRootEventId,
				eventToReplyTo,
			] = args as [RoomID, string, string, UserID, EventID, EventID];
			return {
				roomId,
				senderUserId,
				threadRootEventId,
				eventToReplyTo,
				messageLength: rawMessage?.length,
			};
		},

		sendReaction: (args) => {
			const [roomId, eventId, emoji, senderUserId] = args as [
				RoomID,
				EventID,
				string,
				UserID,
			];
			return {
				roomId,
				eventId,
				emoji,
				senderUserId,
			};
		},

		unsetReaction: (args) => {
			const [roomId, eventIdReactedTo, emoji, senderUserId] = args as [
				RoomID,
				EventID,
				string,
				UserID,
			];
			return {
				roomId,
				eventIdReactedTo,
				emoji,
				senderUserId,
			};
		},

		updateMessage: (args) => {
			const [
				roomId,
				rawMessage,
				_formattedMessage,
				senderUserId,
				eventIdToReplace,
			] = args as [RoomID, string, string, UserID, EventID];
			return {
				roomId,
				senderUserId,
				eventIdToReplace,
				messageLength: rawMessage?.length,
			};
		},

		redactMessage: (args) => {
			const [roomId, eventIdToRedact] = args as [RoomID, EventID];
			return {
				roomId,
				eventIdToRedact,
			};
		},
	};

/**
 * Attribute extractors for RoomService methods.
 */
export const roomServiceAttributeExtractors: ITraceInstanceMethodsOptions['attributeExtractors'] =
	{
		upsertRoom: (args) => {
			const [roomId, state] = args as [string, unknown[]];
			return {
				roomId,
				stateEventCount: state?.length,
			};
		},

		createRoom: (args) => {
			const [roomName, creatorUserId, visibility] = args as [
				string,
				UserID,
				string,
			];
			return {
				roomName,
				creatorUserId,
				visibility,
			};
		},

		changeUserPowerLevel: (args) => {
			const [roomId, senderId, targetUserId, newPowerLevel] = args as [
				RoomID,
				UserID,
				UserID,
				number,
			];
			return {
				roomId,
				senderId,
				targetUserId,
				newPowerLevel,
			};
		},

		leaveRoom: (args) => {
			const [roomId, userId] = args as [RoomID, UserID];
			return {
				roomId,
				userId,
			};
		},

		kickUser: (args) => {
			const [roomId, senderId, targetUserId] = args as [RoomID, UserID, UserID];
			return {
				roomId,
				senderId,
				targetUserId,
			};
		},

		banUser: (args) => {
			const [roomId, senderId, targetUserId, reason] = args as [
				RoomID,
				UserID,
				UserID,
				string,
			];
			return {
				roomId,
				senderId,
				targetUserId,
				reason,
			};
		},

		unbanUser: (args) => {
			const [roomId, senderId, targetUserId] = args as [RoomID, UserID, UserID];
			return {
				roomId,
				senderId,
				targetUserId,
			};
		},

		updateRoomName: (args) => {
			const [roomId, newName, senderUserId] = args as [RoomID, string, UserID];
			return {
				roomId,
				newName,
				senderUserId,
			};
		},

		updateRoomTopic: (args) => {
			const [roomId, newTopic, senderUserId] = args as [RoomID, string, UserID];
			return {
				roomId,
				senderUserId,
				topicLength: newTopic?.length,
			};
		},

		isRoomTombstoned: (args) => {
			const [roomId] = args as [RoomID];
			return { roomId };
		},
	};

/**
 * Attribute extractors for EventService methods.
 */
export const eventServiceAttributeExtractors: ITraceInstanceMethodsOptions['attributeExtractors'] =
	{
		getEventById: (args) => {
			const [eventId, type] = args as [EventID, string];
			return {
				eventId,
				eventType: type,
			};
		},

		checkIfEventsExists: (args) => {
			const [eventIds] = args as [EventID[]];
			return {
				eventCount: eventIds?.length,
			};
		},

		processIncomingTransaction: (args) => {
			const [params] = args as [
				{ origin: string; pdus: Pdu[]; edus?: unknown[] },
			];
			return {
				origin: params?.origin,
				pduCount: params?.pdus?.length,
				eduCount: params?.edus?.length,
			};
		},

		processIncomingPDUs: (args) => {
			const [origin, pdus] = args as [string, Pdu[]];
			return {
				origin,
				pduCount: pdus?.length,
			};
		},

		processIncomingEDUs: (args) => {
			const [edus] = args as [unknown[]];
			return {
				eduCount: edus?.length,
			};
		},

		emitEventByType: (args) => {
			const [event] = args as [PersistentEventBase];
			return {
				eventId: event?.eventId,
				eventType: event?.type,
				roomId: event?.roomId,
			};
		},
	};

/**
 * Attribute extractors for StateService methods.
 */
export const stateServiceAttributeExtractors: ITraceInstanceMethodsOptions['attributeExtractors'] =
	{
		getRoomInformation: (args) => {
			const [roomId] = args as [string];
			return { roomId };
		},

		getRoomVersion: (args) => {
			const [roomId] = args as [RoomID];
			return { roomId };
		},

		getLatestRoomState: (args) => {
			const [roomId] = args as [RoomID];
			return { roomId };
		},

		getStrippedRoomState: (args) => {
			const [roomId] = args as [RoomID];
			return { roomId };
		},

		buildEvent: (args) => {
			const [params, roomVersion] = args as [
				{ type: string; room_id: string; sender: string },
				string,
			];
			return {
				eventType: params?.type,
				roomId: params?.room_id,
				sender: params?.sender,
				roomVersion,
			};
		},

		handlePdu: (args) => {
			const [event] = args as [PersistentEventBase];
			return {
				eventId: event?.eventId,
				eventType: event?.type,
				roomId: event?.roomId,
			};
		},

		getServersInRoom: (args) => {
			const [roomId] = args as [RoomID];
			return { roomId };
		},

		getServerSetInRoom: (args) => {
			const [roomId] = args as [RoomID];
			return { roomId };
		},

		signEvent: (args) => {
			const [event] = args as [PersistentEventBase];
			return {
				eventId: event?.eventId,
				eventType: event?.type,
			};
		},
	};

/**
 * Attribute extractors for FederationService methods.
 */
export const federationServiceAttributeExtractors: ITraceInstanceMethodsOptions['attributeExtractors'] =
	{
		makeJoin: (args) => {
			const [domain, roomId, userId, version] = args as [
				string,
				string,
				string,
				string,
			];
			return {
				targetDomain: domain,
				roomId,
				userId,
				version,
			};
		},

		sendJoin: (args) => {
			const [joinEvent, omitMembers] = args as [PersistentEventBase, boolean];
			return {
				eventId: joinEvent?.eventId,
				roomId: joinEvent?.roomId,
				omitMembers,
			};
		},

		makeLeave: (args) => {
			const [domain, roomId, userId] = args as [string, string, string];
			return {
				targetDomain: domain,
				roomId,
				userId,
			};
		},

		sendLeave: (args) => {
			const [leaveEvent] = args as [PersistentEventBase];
			return {
				eventId: leaveEvent?.eventId,
				roomId: leaveEvent?.roomId,
			};
		},

		sendTransaction: (args) => {
			const [domain, transaction] = args as [
				string,
				{ pdus?: unknown[]; edus?: unknown[] },
			];
			return {
				targetDomain: domain,
				pduCount: transaction?.pdus?.length,
				eduCount: transaction?.edus?.length,
			};
		},

		sendEvent: (args) => {
			const [domain, event] = args as [string, Pdu];
			return {
				targetDomain: domain,
				eventType: event?.type,
				roomId: event?.room_id,
			};
		},

		getEvent: (args) => {
			const [domain, eventId] = args as [string, string];
			return {
				targetDomain: domain,
				eventId,
			};
		},

		getMissingEvents: (args) => {
			const [domain, roomId, earliestEvents, latestEvents, limit] = args as [
				string,
				string,
				EventID[],
				EventID[],
				number,
			];
			return {
				targetDomain: domain,
				roomId,
				earliestEventCount: earliestEvents?.length,
				latestEventCount: latestEvents?.length,
				limit,
			};
		},

		getState: (args) => {
			const [domain, roomId, eventId] = args as [string, string, string];
			return {
				targetDomain: domain,
				roomId,
				eventId,
			};
		},

		getStateIds: (args) => {
			const [domain, roomId] = args as [string, string];
			return {
				targetDomain: domain,
				roomId,
			};
		},

		getVersion: (args) => {
			const [domain] = args as [string];
			return {
				targetDomain: domain,
			};
		},

		inviteUser: (args) => {
			const [inviteEvent, roomVersion] = args as [PersistentEventBase, string];
			return {
				eventId: inviteEvent?.eventId,
				roomId: inviteEvent?.roomId,
				targetUser: inviteEvent?.stateKey,
				roomVersion,
			};
		},

		sendEventToAllServersInRoom: (args) => {
			const [event] = args as [PersistentEventBase];
			return {
				eventId: event?.eventId,
				eventType: event?.type,
				roomId: event?.roomId,
			};
		},

		sendEDUToServers: (args) => {
			const [edus, servers] = args as [unknown[], string[]];
			return {
				eduCount: edus?.length,
				serverCount: servers?.length,
			};
		},
	};

/**
 * Attribute extractors for InviteService methods.
 */
export const inviteServiceAttributeExtractors: ITraceInstanceMethodsOptions['attributeExtractors'] =
	{
		inviteUserToRoom: (args) => {
			const [userId, roomId, sender, isDirectMessage] = args as [
				UserID,
				RoomID,
				UserID,
				boolean,
			];
			return {
				userId,
				roomId,
				sender,
				isDirectMessage,
			};
		},

		processRemoteInviteRequest: (args) => {
			const [roomId, eventId, _inviteEvent, roomVersion] = args as [
				string,
				string,
				unknown,
				string,
			];
			return {
				roomId,
				eventId,
				roomVersion,
			};
		},

		acceptInvite: (args) => {
			const [roomId, userId] = args as [RoomID, UserID];
			return {
				roomId,
				userId,
			};
		},

		rejectInvite: (args) => {
			const [roomId, userId] = args as [RoomID, UserID];
			return {
				roomId,
				userId,
			};
		},
	};

/**
 * Attribute extractors for MediaService methods.
 */
export const mediaServiceAttributeExtractors: ITraceInstanceMethodsOptions['attributeExtractors'] =
	{
		downloadFromRemoteServer: (args) => {
			const [serverName, mediaId] = args as [string, string];
			return {
				serverName,
				mediaId,
			};
		},
	};

/**
 * Attribute extractors for EduService methods.
 */
export const eduServiceAttributeExtractors: ITraceInstanceMethodsOptions['attributeExtractors'] =
	{
		sendTypingNotification: (args) => {
			const [roomId, userId, typing] = args as [RoomID, string, boolean];
			return {
				roomId,
				userId,
				typing,
			};
		},

		sendPresenceUpdateToRooms: (args) => {
			const [presenceUpdates, roomIds] = args as [unknown[], RoomID[]];
			return {
				presenceUpdateCount: presenceUpdates?.length,
				roomCount: roomIds?.length,
			};
		},
	};

/**
 * Extract attributes from event emitter event data based on event type.
 * This function extracts relevant debugging information from event payloads
 * to add as span attributes when events are emitted.
 *
 * @param eventType - The event type being emitted (e.g., 'homeserver.matrix.message')
 * @param data - The event data payload
 * @returns Record of attributes to add to the span
 */
export function extractEventEmitterAttributes(
	eventType: string,
	data: unknown,
): Record<string, string | number | boolean | undefined> {
	const attributes: Record<string, string | number | boolean | undefined> = {
		'event.type': eventType,
	};

	if (!data || typeof data !== 'object') {
		return attributes;
	}

	const eventData = data as Record<string, unknown>;

	// Extract common fields that appear in most events
	if ('event_id' in eventData && typeof eventData.event_id === 'string') {
		attributes['event.id'] = eventData.event_id;
	}

	if ('room_id' in eventData && typeof eventData.room_id === 'string') {
		attributes['room.id'] = eventData.room_id;
	}

	if ('user_id' in eventData && typeof eventData.user_id === 'string') {
		attributes['user.id'] = eventData.user_id;
	}

	if ('sender_id' in eventData && typeof eventData.sender_id === 'string') {
		attributes['sender.id'] = eventData.sender_id;
	}

	// Extract nested event data if present
	if (
		'event' in eventData &&
		typeof eventData.event === 'object' &&
		eventData.event !== null
	) {
		const nestedEvent = eventData.event as Record<string, unknown>;

		if ('room_id' in nestedEvent && typeof nestedEvent.room_id === 'string') {
			attributes['room.id'] = nestedEvent.room_id;
		}

		if ('sender' in nestedEvent && typeof nestedEvent.sender === 'string') {
			attributes['sender.id'] = nestedEvent.sender;
		}

		if ('type' in nestedEvent && typeof nestedEvent.type === 'string') {
			attributes['matrix.event.type'] = nestedEvent.type;
		}

		if (
			'state_key' in nestedEvent &&
			typeof nestedEvent.state_key === 'string'
		) {
			attributes['state.key'] = nestedEvent.state_key;
		}
	}

	// Event-specific attribute extraction
	switch (eventType) {
		case 'homeserver.matrix.typing':
			if ('typing' in eventData && typeof eventData.typing === 'boolean') {
				attributes.typing = eventData.typing;
			}
			if ('origin' in eventData && typeof eventData.origin === 'string') {
				attributes.origin = eventData.origin;
			}
			break;

		case 'homeserver.matrix.presence':
			if ('presence' in eventData && typeof eventData.presence === 'string') {
				attributes['presence.state'] = eventData.presence;
			}
			if (
				'last_active_ago' in eventData &&
				typeof eventData.last_active_ago === 'number'
			) {
				attributes['presence.last_active_ago'] = eventData.last_active_ago;
			}
			if ('origin' in eventData && typeof eventData.origin === 'string') {
				attributes.origin = eventData.origin;
			}
			break;

		case 'homeserver.matrix.room.role':
			if ('role' in eventData && typeof eventData.role === 'string') {
				attributes.role = eventData.role;
			}
			break;

		case 'homeserver.ping':
			if ('message' in eventData && typeof eventData.message === 'string') {
				attributes['ping.message'] = eventData.message;
			}
			break;
	}

	return attributes;
}
