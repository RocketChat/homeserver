import type { V2Pdu } from "./events";

interface EventStore {
  //  what i need
  getEvent(eventId: string): Promise<V2Pdu | null>;
}

class 
