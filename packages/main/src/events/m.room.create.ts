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
		// hashes: { sha256: "XFkxvgXOT9pGz5Hbdo7tLlVN2SmWhQ9ifgsbLio/FEo" },
		// signatures: {
		// 	hs1: {
		// 		"ed25519:a_HDhg":
		// 			"rmnvsWlTL+JP8Sk9767UR0svF4IrzC9zhUPbT+y4u31r/qtIaF9OtT1FP8tD/yFGD92qoTcRb4Oo8DRbLRXcAg",
		// 	},
		// },
		unsigned: { age_ts: ts },
	};
};
