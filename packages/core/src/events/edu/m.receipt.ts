import type { RoomID, UserID } from '@rocket.chat/federation-room';

import type { BaseEDU } from './base';

/**
 * Typing receipt EDU as defined in the Matrix specification
 *
 * @see https://spec.matrix.org/latest/server-server-api/#receipts
 */
export interface ReceiptEDU extends BaseEDU {
	edu_type: 'm.receipt';
	content: Record<
		RoomID,
		{
			'm.read': Record<
				UserID,
				{
					data: {
						thread_id?: string;
						ts: number;
					};
					event_ids: string[];
				}
			>;
		}
	>;
}

export const isReceiptEDU = (edu: BaseEDU): edu is ReceiptEDU => {
	return edu.edu_type === 'm.receipt';
};
