import { PersistentEventV9 } from './v9';

export class PersistentEventV10 extends PersistentEventV9 {
	// all are numbers
	transformPowerLevelEventData(data: number): number {
		return data;
	}
}
