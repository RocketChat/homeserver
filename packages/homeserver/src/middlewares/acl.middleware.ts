import type { EventAuthorizationService } from '@hs/federation-sdk';

const errCodes = {
	M_UNAUTHORIZED: {
		errcode: 'M_UNAUTHORIZED',
		error: 'Invalid or missing signature',
	},
	M_FORBIDDEN: {
		errcode: 'M_FORBIDDEN',
		error: 'Access denied',
	},
	M_UNKNOWN: {
		errcode: 'M_UNKNOWN',
		error: 'Internal server error while processing request',
	},
};

export const aclMiddleware = (federationAuth: EventAuthorizationService) => {
	return async (context: any) => {
		const { params, set, request, headers } = context;
		const { eventId } = params as { eventId: string };

		try {
			const headerObj: Record<string, string> = {};
			if (headers && typeof headers === 'object') {
				for (const [key, value] of Object.entries(headers)) {
					if (value !== undefined) {
						headerObj[key] = String(value);
					}
				}
			}

			const verificationResult = await federationAuth.verifyRequestSignature({
				method: request.method,
				uri: request.url,
				headers: headerObj,
				body: undefined, // GET requests don't have body
			});

			if (!verificationResult.valid) {
				set.status = 401;
				return errCodes.M_UNAUTHORIZED;
			}

			const authResult = await federationAuth.canAccessEvent(
				eventId,
				verificationResult.serverName,
			);
			if (!authResult.authorized) {
				set.status = 403;
				return errCodes.M_FORBIDDEN;
			}

			return;
		} catch (error) {
			console.error('ACL middleware error:', error);
			set.status = 500;
			return errCodes.M_UNKNOWN;
		}
	};
};

export const federationEventMiddleware = aclMiddleware;
