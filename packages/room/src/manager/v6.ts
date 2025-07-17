import { PduTypeRoomAliases } from '../types/v3-11';
import { PersistentEventV3 } from './v3';

export class PersistentEventV6 extends PersistentEventV3 {
	getAllowedContentKeys() {
		const resp = super.getAllowedContentKeys();

		// @ts-ignore
		delete resp[PduTypeRoomAliases];

		return resp;
	}
}
