import type { RoomVersion10And11 } from './type';
import { PersistentEventV3Base } from './v3';

export class PersistentEventV10 extends PersistentEventV3Base<RoomVersion10And11> {
	// all are numbers
	transformPowerLevelEventData(data: number): number {
		return data;
	}
}
