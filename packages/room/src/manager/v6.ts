import { PduType } from '../types/v3-11';
import { PersistentEventV3 } from './v3';

export class PersistentEventV6<
	Type extends PduType = PduType,
> extends PersistentEventV3<Type> {
	getAllowedContentKeys() {
		const resp = super.getAllowedContentKeys();

		delete resp['m.room.aliases'];

		return resp;
	}
}
