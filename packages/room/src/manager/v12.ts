import type { RoomVersion, RoomVersionCapabilities } from './type';
import { PersistentEventV11 } from './v11';
import type { UserID } from '../types/_common';
import type { PduCreateEventContent, PduType } from '../types/v3-11';

// v12 keeps v11's event format and redaction rules, what changes is room identity and authority:
// the room id is the create event's hash, and every room creator outranks any power level
export class PersistentEventV12<Type extends PduType = PduType> extends PersistentEventV11<Type> {
	static readonly capabilities: RoomVersionCapabilities = {
		...PersistentEventV11.capabilities,
		roomIdFormat: 'create-event-hash',
		createEventInAuthEvents: false,
		privilegedCreators: true,
		stateResolution: 'v2.1',
	};

	static newCreateEventContent(_creator: UserID, roomVersion: RoomVersion, additionalCreators?: UserID[]): PduCreateEventContent {
		if (additionalCreators?.length) {
			return { room_version: roomVersion, additional_creators: additionalCreators };
		}

		return { room_version: roomVersion };
	}

	protected resolveCreators(): Set<UserID> {
		const creators = new Set<UserID>([this.sender as UserID]);

		const additionalCreators = (this.getContent() as PduCreateEventContent).additional_creators;
		if (Array.isArray(additionalCreators)) {
			for (const creator of additionalCreators) {
				creators.add(creator as UserID);
			}
		}

		return creators;
	}
}
