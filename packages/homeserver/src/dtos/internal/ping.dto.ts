import { z } from 'zod';

export const InternalPingResponseDto = z.string()
	.describe('Simple ping response');

export type InternalPingResponse = z.infer<typeof InternalPingResponseDto>;