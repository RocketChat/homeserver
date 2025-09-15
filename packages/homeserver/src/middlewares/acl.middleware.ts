import type { EventAuthorizationService } from '@hs/federation-sdk';
import { errCodes } from '@hs/federation-sdk';

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
