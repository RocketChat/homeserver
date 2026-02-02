/**
 * Extracts the origin server domain from a Matrix room ID.
 * @example extractOriginFromMatrixRoomId('!room:matrix.org') // 'matrix.org'
 */
export function extractOriginFromMatrixRoomId(roomId: string): string {
	return roomId.split(':').pop() || 'unknown';
}

/**
 * Extracts the origin server domain from a Matrix user ID.
 * @example extractOriginFromMatrixUserId('@user:matrix.org') // 'matrix.org'
 */
export function extractOriginFromMatrixUserId(userId: string): string {
	return userId.split(':').pop() || 'unknown';
}

// File types for message type detection
const fileTypes = ['m.image', 'm.video', 'm.audio', 'm.file'];

/**
 * Determines the message type from a Matrix event for metrics labeling.
 * @returns 'text' | 'file' | 'encrypted'
 */
export function determineMessageType(event: {
	type?: string;
	content?: { msgtype?: string };
}): 'text' | 'file' | 'encrypted' {
	if (event.type === 'm.room.encrypted') {
		return 'encrypted';
	}

	const msgtype = event.content?.msgtype;
	if (msgtype && fileTypes.includes(msgtype)) {
		return 'file';
	}

	return 'text';
}

/**
 * Bucketizes PDU count for metrics labeling to avoid high cardinality.
 * Groups counts into buckets: 0, 1, 2-5, 6-10, 11-50, 51+
 */
export function bucketizePduCount(count: number): string {
	if (count === 0) return '0';
	if (count === 1) return '1';
	if (count <= 5) return '2-5';
	if (count <= 10) return '6-10';
	if (count <= 50) return '11-50';
	return '51+';
}

/**
 * Bucketizes EDU count for metrics labeling to avoid high cardinality.
 * Groups counts into buckets: 0, 1, 2-5, 6-10, 11+
 */
export function bucketizeEduCount(count: number): string {
	if (count === 0) return '0';
	if (count === 1) return '1';
	if (count <= 5) return '2-5';
	if (count <= 10) return '6-10';
	return '11+';
}

/**
 * Maps event emitter event types to simplified event_type labels for metrics.
 */
export function getEventTypeLabel(event: string): string {
	// Map homeserver.matrix.* events to simplified labels
	const mapping: Record<string, string> = {
		'homeserver.matrix.message': 'message',
		'homeserver.matrix.encrypted': 'message',
		'homeserver.matrix.membership': 'membership',
		'homeserver.matrix.redaction': 'redaction',
		'homeserver.matrix.reaction': 'reaction',
		'homeserver.matrix.typing': 'typing',
		'homeserver.matrix.presence': 'presence',
		'homeserver.matrix.room.create': 'room_create',
		'homeserver.matrix.room.name': 'room_update',
		'homeserver.matrix.room.topic': 'room_update',
		'homeserver.matrix.room.power_levels': 'room_update',
		'homeserver.matrix.room.server_acl': 'room_update',
		'homeserver.matrix.room.role': 'role_change',
		'homeserver.matrix.encryption': 'encryption',
	};
	return mapping[event] || event.replace('homeserver.matrix.', '');
}
