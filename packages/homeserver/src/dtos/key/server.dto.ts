import { z } from 'zod';
import { ServerNameDto, TimestampDto } from '../common/validation.dto';

export const ServerKeyResponseDto = z.object({
	old_verify_keys: z.record(z.string(), z.any())
		.describe('Old verification keys'),
	server_name: ServerNameDto,
	signatures: z.record(z.string(), z.any())
		.describe('Server signatures'),
	valid_until_ts: TimestampDto,
	verify_keys: z.record(
		z.string(),
		z.object({
			key: z.string().describe('Base64-encoded public key')
		})
	).describe('Current verification keys'),
}); 

export type ServerKeyResponse = z.infer<typeof ServerKeyResponseDto>;