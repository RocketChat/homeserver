import type { BaseEDU } from './base';

/**
 * User presence states as defined by Matrix specification
 */
export type PresenceState = 'online' | 'offline' | 'unavailable';

export interface PresenceUpdate {
	user_id: string;
	presence: PresenceState;
	last_active_ago?: number;
	status_msg?: string;
	currently_active?: boolean;
}

/**
 * Presence update EDU as defined in the Matrix specification
 *
 * This EDU is sent to broadcast user presence changes across federation.
 * It contains one or more presence updates in a batch.
 *
 * @see https://spec.matrix.org/latest/client-server-api/#presence
 */
export interface PresenceEDU extends BaseEDU {
	edu_type: 'm.presence';
	content: {
		push: PresenceUpdate[];
	};
}

export const isPresenceEDU = (edu: BaseEDU): edu is PresenceEDU => {
	return edu.edu_type === 'm.presence';
};

export const createPresenceEDU = (
	presenceUpdates: PresenceUpdate[],
	origin?: string,
): PresenceEDU => ({
	edu_type: 'm.presence',
	content: {
		push: presenceUpdates,
	},
	...(origin && { origin }),
});

export const createPresenceUpdate = (
	userId: string,
	presence: PresenceState,
	options?: {
		lastActiveAgo?: number;
		statusMsg?: string;
		currentlyActive?: boolean;
	},
): PresenceUpdate => ({
	user_id: userId,
	presence,
	...(options?.lastActiveAgo !== undefined && {
		last_active_ago: options.lastActiveAgo,
	}),
	...(options?.statusMsg && { status_msg: options.statusMsg }),
	...(options?.currentlyActive !== undefined && {
		currently_active: options.currentlyActive,
	}),
});
