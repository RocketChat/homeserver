import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import type { EventBase } from '../../models/event.model';
import { EventService } from '../../services/event.service';

export const transactionsPlugin = (app: Elysia) => {
	const eventService = container.resolve(EventService);
	return app.put('/_matrix/federation/v1/send/:txnId', async ({ body }) => {
		const { pdus = [] } = body as { pdus: EventBase[] };
		if (pdus.length === 0) {
			return {
				pdus: {},
				edus: {},
			};
		}
		const processedPDUs = await eventService.processIncomingPDUs(pdus);
		return {
			pdus: processedPDUs,
			edus: {},
		};
	});
};
