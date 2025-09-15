import type { EventAuthorizationService } from '@hs/federation-sdk';
import { errCodes } from '@hs/federation-sdk';
import Elysia from 'elysia';

export const canAccessEvent = (federationAuth: EventAuthorizationService) => {
	return new Elysia({
		name: 'homeserver/canAccessEvent',
	}).onBeforeHandle<{ params: { eventId: string } }>(async (req) => {
		const { params, headers, request, set } = req;
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
	});
};
