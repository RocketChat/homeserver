// (
// 	destination=domain,
// 	edu_type=EduTypes.TYPING,
// 	content={
// 		"room_id": member.room_id,
// 		"user_id": member.user_id,
// 		"typing": typing,
// 	},
// 	key=member,
// )

// rc1  | receive send -> {
// rc1  |   txnId: "1733946113259",
// rc1  | }
// rc1  | body -> {
// rc1  |   edus: [
// rc1  |     {
// rc1  |       content: {
// rc1  |         room_id: "!JOQWtMhsTYVzpvWKfT:hs1",
// rc1  |         typing: true,
// rc1  |         user_id: "@admin:hs1",
// rc1  |       },
// rc1  |       edu_type: "m.typing",
// rc1  |     }
// rc1  |   ],
// rc1  |   origin: "hs1",
// rc1  |   origin_server_ts: 1733946457918,
// rc1  |   pdus: [],
// rc1  | }

export type TypingEvent = {
	edu_type: "m.typing";
	content: {
		room_id: string;
		user_id: string;
		typing: boolean;
	};
};

export function createTypingEvent({ roomId, sender, typing }: { roomId: string; sender: string; typing: boolean; }): TypingEvent {
	return {
		edu_type: "m.typing",
		content: {
			room_id: roomId,
			user_id: sender,
			typing,
		},
	};
}
