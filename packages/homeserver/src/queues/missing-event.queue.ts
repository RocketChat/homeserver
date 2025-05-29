import { BaseQueue } from './base.queue';

export type MissingEventType = {
	eventId: string;
	roomId: string;
	origin: string;
};

export class MissingEventsQueue extends BaseQueue<MissingEventType> {}
