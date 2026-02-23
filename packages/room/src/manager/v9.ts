import { PersistentEventV8 } from './v8';
import type { PduType } from '../types/v3-11';

export class PersistentEventV9<Type extends PduType = PduType> extends PersistentEventV8<Type> {
	getAllowedContentKeys() {
		const resp = super.getAllowedContentKeys();

		(resp['m.room.member'] as string[]).push('join_authorised_via_users_server');

		return resp;
	}
}
