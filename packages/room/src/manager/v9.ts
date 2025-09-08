import {} from '../types/v3-11';
import { PersistentEventV8 } from './v8';

export class PersistentEventV9 extends PersistentEventV8 {
	getAllowedContentKeys() {
		const resp = super.getAllowedContentKeys();

		(resp['m.room.member'] as string[]).push(
			'join_authorised_via_users_server',
		);

		return resp;
	}
}
