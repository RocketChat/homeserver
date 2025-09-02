import {} from '../types/v3-11';
import { PersistentEventV3 } from './v3';

export class PersistentEventV6 extends PersistentEventV3 {
	getAllowedContentKeys() {
		const resp = super.getAllowedContentKeys();

		// biome-ignore lint/performance/noDelete: <explanation>
		delete resp['m.room.aliases'];

		return resp;
	}
}
