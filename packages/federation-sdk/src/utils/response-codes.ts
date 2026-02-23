export const errCodes: Record<string, { errcode: string; error: string; status: 401 | 403 | 500 }> = {
	M_UNAUTHORIZED: {
		errcode: 'M_UNAUTHORIZED',
		error: 'Invalid or missing signature',
		status: 401,
	},
	M_FORBIDDEN: {
		errcode: 'M_FORBIDDEN',
		error: 'Access denied',
		status: 403,
	},
	M_UNKNOWN: {
		errcode: 'M_UNKNOWN',
		error: 'Internal server error while processing request',
		status: 500,
	},
};
