import type { EventAuthorizationService } from '@hs/federation-sdk';

const errCodes = {
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

interface ACLContext {
	params: { eventId: string };
	headers: Record<string, string | undefined>;
	request: Request;
	set: Record<string, unknown>;
}

export const canAccessEvent = (federationAuth: EventAuthorizationService) => {
	return async (context: ACLContext) => {
		const { params, headers, request, set } = context;
		const { eventId } = params;
		const authorizationHeader = headers.authorization || '';
		const method = request.method;
		const uri = new URL(request.url).pathname;

		const result = await federationAuth.canAccessEventFromAuthorizationHeader(
			eventId,
			authorizationHeader,
			method,
			uri,
		);

		if (!result.authorized) {
			set.status = errCodes[result.errorCode].status;
			return {
				errcode: errCodes[result.errorCode].errcode,
				error: errCodes[result.errorCode].error,
			};
		}
	};
};
