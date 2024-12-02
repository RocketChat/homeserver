export const roomCreateEvent = ({
	roomId,
	sender,
	ts = Date.now(),
}: {
	roomId: string;
	sender: string;
	ts?: number;
}) => {
	return {
		auth_events: [],
		prev_events: [],
		type: "m.room.create",
		room_id: roomId,
		sender: sender,
		content: {
			room_version: "10",
			creator: sender,
		},
		depth: 1,
		state_key: "",
		origin: sender.split(":").pop(),
		origin_server_ts: ts,
		unsigned: { age_ts: ts },
	};
};
