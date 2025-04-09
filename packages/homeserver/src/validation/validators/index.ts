import { EventBase as CoreEventBase } from '@hs/core/src/events/eventBase';

export * from './EventHashValidator';
export * from './EventSignatureValidator';
export * from './RoomRulesValidator';
export * from './AuthChainValidator';
export * from './CanonicalizeEvent';
export * from './AuthEventsValidator'; 

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
    incomplete_chain?: boolean;
  }
}