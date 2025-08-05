import {
	ErrorResponseDto,
	SendTransactionBodyDto,
	SendTransactionResponseDto,
} from '@hs/federation-sdk';
import { EventService } from '@hs/federation-sdk';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';

export const transactionsPlugin = (app: Elysia) => {
	const eventService = container.resolve(EventService);
	return app.put(
		'/_matrix/federation/v1/send/:txnId',
		async ({ body }) => {
			const { pdus = [], edus = [] } = body;

			// Process PDUs if present
			if (pdus.length > 0) {
				await eventService.processIncomingPDUs(pdus);
			}

			// Process EDUs if present
			if (edus.length > 0) {
				await eventService.processIncomingEDUs(edus);
			}

			return {
				pdus: {},
				edus: {},
			};
		},
		{
			body: SendTransactionBodyDto,
			response: {
				200: SendTransactionResponseDto,
				400: ErrorResponseDto,
			},
			detail: {
				tags: ['Federation'],
				summary: 'Send transaction',
				description: 'Send a transaction',
			},
		},
	);
};
