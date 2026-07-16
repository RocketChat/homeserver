import type { PresenceEDU, ReceiptEDU, TypingEDU } from '@rocket.chat/federation-core';

import type { AppServiceEphemeralEvent } from '../models/appservice.model';

type ReceiptUser = { ts: number; thread_id?: string };
type ReceiptRoomContent = Record<string, { 'm.read': Record<string, ReceiptUser> }>;

const isTyping = (e: TypingEDU | ReceiptEDU | PresenceEDU): e is TypingEDU => e.edu_type === 'm.typing';
const isReceipt = (e: TypingEDU | ReceiptEDU | PresenceEDU): e is ReceiptEDU => e.edu_type === 'm.receipt';
const isPresence = (e: TypingEDU | ReceiptEDU | PresenceEDU): e is PresenceEDU => e.edu_type === 'm.presence';

export function eduBatchToAppServiceEphemeral(edus: (TypingEDU | ReceiptEDU | PresenceEDU)[]): AppServiceEphemeralEvent[] {
	const out: AppServiceEphemeralEvent[] = [];

	out.push(...transformTyping(edus.filter(isTyping)));
	out.push(...transformReceipts(edus.filter(isReceipt)));
	out.push(...transformPresence(edus.filter(isPresence)));

	return out;
}

// Coalesces typing EDUs per room: within a batch, the final user_ids list for
// a room is the set of users whose last seen state in the batch was typing=true.
// A user who appears only as typing=false is removed from user_ids.
function transformTyping(edus: TypingEDU[]): AppServiceEphemeralEvent[] {
	const perRoom = new Map<string, Map<string, boolean>>();

	for (const edu of edus) {
		const { room_id, user_id, typing } = edu.content;
		let users = perRoom.get(room_id);
		if (!users) {
			users = new Map();
			perRoom.set(room_id, users);
		}
		users.set(user_id, typing);
	}

	const events: AppServiceEphemeralEvent[] = [];
	for (const [room_id, users] of perRoom) {
		const user_ids = Array.from(users.entries())
			.filter(([, typing]) => typing)
			.map(([user_id]) => user_id);
		events.push({ type: 'm.typing', room_id, content: { user_ids } });
	}
	return events;
}

// Re-keys federation receipts (room -> user -> {data, event_ids}) into the
// client-server shape (event_id -> "m.read" -> user -> {ts, thread_id?}),
// emitting one m.receipt event per room. Multiple receipt EDUs for the same
// room within a batch are merged.
function transformReceipts(edus: ReceiptEDU[]): AppServiceEphemeralEvent[] {
	const perRoom = new Map<string, ReceiptRoomContent>();

	for (const edu of edus) {
		for (const [room_id, roomContent] of Object.entries(edu.content)) {
			const readMap = roomContent['m.read'] ?? {};
			let acc = perRoom.get(room_id);
			if (!acc) {
				acc = {};
				perRoom.set(room_id, acc);
			}
			for (const [user_id, userReceipt] of Object.entries(readMap)) {
				for (const event_id of userReceipt.event_ids) {
					if (!acc[event_id]) {
						acc[event_id] = { 'm.read': {} };
					}

					const userEntry: ReceiptUser = { ts: userReceipt.data.ts };

					if (userReceipt.data.thread_id) {
						userEntry.thread_id = userReceipt.data.thread_id;
					}

					acc[event_id]['m.read'][user_id] = userEntry;
				}
			}
		}
	}

	const events: AppServiceEphemeralEvent[] = [];
	for (const [room_id, content] of perRoom) {
		events.push({ type: 'm.receipt', room_id, content });
	}
	return events;
}

// Fans out federation presence (content.push[]) into one m.presence event per
// update, hoisting user_id to top-level sender and stripping it from content.
function transformPresence(edus: PresenceEDU[]): AppServiceEphemeralEvent[] {
	const events: AppServiceEphemeralEvent[] = [];
	for (const edu of edus) {
		for (const update of edu.content.push) {
			const { user_id, ...rest } = update;
			events.push({ type: 'm.presence', sender: user_id, content: rest });
		}
	}
	return events;
}
