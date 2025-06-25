import { z } from "zod";

export const ErrorResponseDto = z.object({
	error: z.string(),
	details: z.any(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseDto>;