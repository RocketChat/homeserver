import { PduTypeRoomAliases } from '../types/v1';
import { PersistentEventV3Base } from './v3';

export class PersistentEventV6 extends PersistentEventV3Base<'6'> {
	getAllowedContentKeys() {
		const resp = super.getAllowedContentKeys();

		// @ts-ignore
		delete resp[PduTypeRoomAliases];

		return resp;
	}
}
