import { z } from 'zod';
import { EventBaseDto } from '../common/event.dto';

export const SendTransactionParamsDto = z.object({
	txnId: z.string().describe('Transaction ID'),
});

export const SendTransactionBodyDto = z.object({
	pdus: z.array(EventBaseDto)
		.describe('Persistent data units (PDUs) to process')
		.default([]),
	edus: z.array(z.any())
		.describe('Ephemeral data units (EDUs)')
		.default([])
		.optional(),
});

export const SendTransactionResponseDto = z.object({
	pdus: z.record(z.string(), z.any())
		.describe('Processing results for each PDU'),
	edus: z.record(z.string(), z.any())
		.describe('Processing results for each EDU'),
}); 

export type SendTransactionParams = z.infer<typeof SendTransactionParamsDto>;
export type SendTransactionBody = z.infer<typeof SendTransactionBodyDto>;
export type SendTransactionResponse = z.infer<typeof SendTransactionResponseDto>;