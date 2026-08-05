import { REDACT_ALLOW_ALL_KEYS } from './event-wrapper';
import { PersistentEventV9 } from './v9';
import { type PduType } from '../types/v3-11';
import { RoomID } from '../types/_common';
import { PersistentEventV11 } from './v11';

export class PersistentEventV12<Type extends PduType = PduType> extends PersistentEventV11<Type> {
	get roomId(): RoomID {
		const eid = this.eventId;
		// SPEC: Note: The room ID is the event ID of the event with sigil ! instead of $.
		return eid.replace(/^\$/, '!') as RoomID;
	}
}
