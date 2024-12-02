export const roomMemberEvent = ({
    roomId,
    sender,
    auth_events,
    prev_events,
    depth,
    ts = Date.now(),
}: {
    roomId: string;
    sender: string;
    auth_events: string[];
    prev_events: string[];
    depth: number;
    ts?: number;
}) => {
    return {
        auth_events,
        prev_events,
        type: "m.room.member",
        room_id: roomId,
        sender,
        content: {
            displayname: sender.split(":").shift()?.replaceAll('@', ''),
            membership: "join",
        },
        depth,
        state_key: sender,
        origin: sender.split(":").pop(),
        origin_server_ts: ts,
        unsigned: { age_ts: ts },
    };
};
