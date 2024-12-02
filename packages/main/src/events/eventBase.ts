export const createEventBase = <TContent extends Object, TUnsigned extends Object>({
    roomId,
    sender,
    auth_events,
    prev_events,
    depth,
    type,
    content,
    state_key,
    origin_server_ts,
    unsigned,
    ts = Date.now(),
}: {
    roomId: string;
    sender: string;
    auth_events: string[];
    prev_events: string[];
    depth: number;
    type: string;
    content: TContent;
    state_key: string;
    origin_server_ts: number;
    unsigned: TUnsigned;
    ts?: number;
}) => {
    if (!sender.includes(":") || !sender.includes("@")) {
        throw new Error("Invalid sender");
    }
    if (!roomId.includes(":") || !roomId.includes("!")) {
        throw new Error("Invalid room Id");
    }
    return {
        auth_events,
        prev_events,
        type,
        room_id: roomId,
        sender,
        content,
        depth,
        state_key,
        origin: sender.split(":").pop(),
        origin_server_ts,
        unsigned: { age_ts: ts, ...unsigned },
    }
};
