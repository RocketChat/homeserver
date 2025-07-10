import { PduTypeRoomJoinRules } from '../types/v3-11';
import { PersistentEventV6 } from './v6';

export class PersistentEventV8 extends PersistentEventV6 {
	getAllowedContentKeys() {
		const resp = super.getAllowedContentKeys();

		(resp[PduTypeRoomJoinRules] as string[]).push('allow');

		return resp;
	}
}
