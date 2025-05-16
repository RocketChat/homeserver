import type { EventBase as CoreEventBase } from '@hs/core/src/events/eventBase';

export interface Event extends Partial<CoreEventBase> {
  event: {
    type: string;
    room_id: string;
    sender: string;
    content: Record<string, any>;
    origin_server_ts: number;
    [key: string]: any;
  }
}

export interface CanonicalizedEvent extends Event {
  canonicalizedEvent: {
    canonical: boolean;
    canonicalJson?: string;
  }
}

export interface AuthorizedEvent extends CanonicalizedEvent {
  authorizedEvent: {
    auth_events: string[];
    signatures: Record<string, Record<string, string>>;
    hashes: Record<string, string>;
    auth_event_objects?: Event[];
  }
}