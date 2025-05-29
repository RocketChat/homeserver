import { createEventBase, type EventBase } from "./eventBase";
import { createEventWithId } from "./utils/createSignedEvent";

declare module "./eventBase" {
    interface Events {
        "m.room.redaction": {
            content: {
                reason?: string;
            };
            unsigned: {
                age_ts: number;
            };
            redacts: string;
        };
    }
}

export type RedactionAuthEvents = {
    "m.room.create": string | undefined;
    "m.room.power_levels": string | undefined;
    "m.room.member"?: string | undefined;
}

export const isRedactionEvent = (
    event: EventBase,
): event is RedactionEvent => {
    return event.type === "m.room.redaction";
};

export interface RedactionEvent extends EventBase {
    type: "m.room.redaction";
    content: {
        reason?: string;
    };
    unsigned: {
        age_ts: number;
    };
    redacts: string;  // Required at top level only
}

const isTruthy = <T>(value: T | null | undefined | false | 0 | ''): value is T => {
    return Boolean(value);
};

// Redaction events must have 'redacts' at the top level only per Matrix spec,
// not in content as our old types suggested.
export const redactionEvent = ({
    roomId,
    sender,
    auth_events,
    prev_events,
    depth,
    content,
    origin,
    ts = Date.now(),
    unsigned,
}: {
    roomId: string;
    sender: string;
    auth_events: RedactionAuthEvents;
    prev_events: string[];
    depth: number;
    content: {
        redacts: string;  // We take redacts in content to maintain API compatibility
        reason?: string;
    };
    origin?: string;
    ts?: number;
    unsigned?: { age_ts?: number };
}): RedactionEvent => {
    // Extract redacts from content - it must be at top level only
    const { redacts } = content;
    const { reason } = content;

    const baseEvent = createEventBase("m.room.redaction", {
        roomId,
        sender,
        auth_events: [
            auth_events["m.room.create"],
            auth_events["m.room.power_levels"],
            auth_events["m.room.member"]
        ].filter(isTruthy),
        prev_events,
        depth,
        content: {
            ...(reason ? { reason } : {})  // Only include reason in content
        },
        origin_server_ts: ts,
        ts,
        origin,
        unsigned: { ...unsigned, age_ts: ts },
    }) as EventBase;

    // Add redacts at the top level for Matrix spec compliance
    return {
        ...baseEvent,
        redacts,
    } as RedactionEvent;
};

export const createRedactionEvent = createEventWithId(redactionEvent);
