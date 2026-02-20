import type { BaseEDU } from './base';

/**
 * Typing notification EDU as defined in the Matrix specification
 *
 * This EDU is sent to indicate which user is currently typing in a room.
 * It's ephemeral and doesn't persist in room history.
 *
 * @see https://spec.matrix.org/latest/server-server-api/#typing-notifications
 */
export interface TypingEDU extends BaseEDU {
	edu_type: 'm.typing';
	content: {
		room_id: string;
		user_id: string;
		typing: boolean;
	};
}

export const isTypingEDU = (edu: BaseEDU): edu is TypingEDU => {
	return edu.edu_type === 'm.typing';
};

export const createTypingEDU = (roomId: string, userId: string, typing: boolean, origin?: string): TypingEDU => ({
	edu_type: 'm.typing',
	content: {
		room_id: roomId,
		user_id: userId,
		typing,
	},
	...(origin && { origin }),
});
