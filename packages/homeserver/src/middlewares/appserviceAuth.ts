import type { CachedAppService } from '@rocket.chat/federation-sdk';
import { federationSDK } from '@rocket.chat/federation-sdk';

export interface AppServiceAuthResult {
	appservice: CachedAppService | undefined;
	actingUserId: string | undefined;
	timestampOverride: number | undefined;
	error?: { status: number; errcode: string; error: string };
}

/**
 * Resolve Application Service authentication from a request.
 * This is a utility function used by client-server API controllers.
 */
export function resolveAppServiceAuth(
	request: Request,
	headers: Record<string, string | undefined>,
	serverName: string,
): AppServiceAuthResult {
	let asToken: string | undefined;

	// Extract token from Authorization: Bearer <token>
	const authHeader = headers.authorization;
	if (authHeader?.startsWith('Bearer ')) {
		asToken = authHeader.slice(7);
	}

	// Fallback: legacy ?access_token= query param
	if (!asToken) {
		const url = new URL(request.url);
		asToken = url.searchParams.get('access_token') ?? undefined;
	}

	if (!asToken) {
		return { appservice: undefined, actingUserId: undefined, timestampOverride: undefined };
	}

	const appservice = federationSDK.getRegistrationByAsToken(asToken);

	if (!appservice) {
		return {
			appservice: undefined,
			actingUserId: undefined,
			timestampOverride: undefined,
			error: { status: 401, errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid application service token' },
		};
	}

	// Resolve acting user from ?user_id= param
	const url = new URL(request.url);
	const userIdParam = url.searchParams.get('user_id');
	let actingUserId = `@${appservice.registration.senderLocalpart}:${serverName}`;

	if (userIdParam) {
		const isInNamespace = federationSDK.isUserInAppServiceNamespace(userIdParam, appservice.registration._id);

		const senderUserId = `@${appservice.registration.senderLocalpart}:${serverName}`;
		if (!isInNamespace && userIdParam !== senderUserId) {
			return {
				appservice: undefined,
				actingUserId: undefined,
				timestampOverride: undefined,
				error: { status: 403, errcode: 'M_EXCLUSIVE', error: 'User is not within the appservice namespace' },
			};
		}

		actingUserId = userIdParam;
	}

	// Extract optional ?ts= for timestamp massaging
	const tsParam = url.searchParams.get('ts');
	const timestampOverride = tsParam ? Number.parseInt(tsParam, 10) : undefined;

	return {
		appservice,
		actingUserId,
		timestampOverride: timestampOverride && !Number.isNaN(timestampOverride) ? timestampOverride : undefined,
	};
}
