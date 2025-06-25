import { z } from 'zod';

export const WellKnownServerResponseDto = z.object({
	'm.server': z.string()
		.describe('Matrix server address with port'),
}); 

export type WellKnownServerResponse = z.infer<typeof WellKnownServerResponseDto>;