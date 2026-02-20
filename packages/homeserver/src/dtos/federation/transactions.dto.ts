import { type Static, t } from 'elysia';

import { EventBaseDto } from '../common/event.dto';

export const SendTransactionParamsDto = t.Object({
	txnId: t.String({ description: 'Transaction ID' }),
});

export const SendTransactionBodyDto = t.Object({
	origin: t.String({ description: 'Origin of the transaction' }),
	origin_server_ts: t.Number({ description: 'Origin server timestamp' }),
	pdus: t.Array(EventBaseDto, {
		description: 'Persistent data units (PDUs) to process',
		default: [],
	}),
	edus: t.Optional(
		t.Array(t.Any(), {
			description: 'Ephemeral data units (EDUs)',
			default: [],
		}),
	),
});

export const SendTransactionResponseDto = t.Object({
	pdus: t.Record(t.String(), t.Any(), {
		description: 'Processing results for each PDU',
	}),
	edus: t.Record(t.String(), t.Any(), {
		description: 'Processing results for each EDU',
	}),
});

export const GetEventParamsDto = t.Object({
	eventId: t.String({ description: 'Event ID' }),
});

export const GetEventResponseDto = t.Object({
	origin_server_ts: t.Number({ description: 'Origin server timestamp' }),
	origin: t.String({ description: 'Origin server' }),
	pdus: t.Array(EventBaseDto, {
		description: 'An array containing a single PDU',
	}),
});

export const GetEventErrorResponseDto = t.Object({
	errcode: t.String({ description: 'Error code' }),
	error: t.String({ description: 'Error message' }),
});

export type SendTransactionParams = Static<typeof SendTransactionParamsDto>;
export type SendTransactionBody = Static<typeof SendTransactionBodyDto>;
export type SendTransactionResponse = Static<typeof SendTransactionResponseDto>;
export type GetEventParams = Static<typeof GetEventParamsDto>;
export type GetEventResponse = Static<typeof GetEventResponseDto>;
