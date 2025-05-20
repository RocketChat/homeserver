export interface EventBase {
  event_id?: string;
  room_id: string;
  type: string;
  sender: string;
  content?: any;
  origin_server_ts: number;
  origin: string;
  state_key?: string;
  depth: number;
  prev_events: string[];
  auth_events: string[];
  signatures?: Record<string, Record<string, string>>;
	unsigned?: Record<string, any> | undefined;
}

export interface EventStore {
  _id: string;
  event: EventBase;
  staged?: boolean;
  outlier?: boolean;
}

export interface StateEvent extends EventBase {
  state_key: string;
}

export interface MessageEvent extends EventBase {
  content: {
    msgtype: string;
    body: string;
    [key: string]: any;
  };
}

export interface FetchedEvents {
  events: { eventId: string; event: EventBase }[];
  missingEventIds: string[];
} 