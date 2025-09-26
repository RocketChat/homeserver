import { PduType } from '../types/v3-11';
import { PersistentEventV6 } from './v6';

export class PersistentEventV8<
	Type extends PduType = PduType,
> extends PersistentEventV6<Type> {
	getAllowedContentKeys() {
		const resp = super.getAllowedContentKeys();

		(resp['m.room.join_rules'] as string[]).push('allow');

		return resp;
	}
}
