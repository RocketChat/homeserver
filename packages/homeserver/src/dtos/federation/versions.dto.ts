import { z } from 'zod';

export const GetVersionsResponseDto = z.object({
	server: z.object({
		name: z.string().describe('Server software name'),
		version: z.string().describe('Server software version'),
	}),
});

export type GetVersionsResponse = z.infer<typeof GetVersionsResponseDto>;