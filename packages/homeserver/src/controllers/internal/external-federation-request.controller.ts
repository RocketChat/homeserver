import { FederationRequestService } from '@rocket.chat/federation-sdk';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';

export const internalRequestPlugin = (app: Elysia) => {
	const requester = container.resolve(FederationRequestService);
	return app.post(
		'/internal/request',
		async ({ body }) => {
			const { method, body: requestBody, uri, serverName, query } = body;
			console.log(query);
			const response = await requester.makeSignedRequest({
				domain: serverName,
				uri,
				method,
				body: requestBody,
				queryString: query ? new URLSearchParams(query).toString() : undefined,
			});

			return response;
		},
		{
			body: t.Object({
				serverName: t.String({
					description: 'where the request will go to, like matrix.org',
				}),
				uri: t.String({
					description: 'the endpoint uri, roomid user id and all',
				}),
				body: t.Optional(t.Any({ description: 'the body to send, if any' })),
				method: t.Union(
					[t.Literal('GET'), t.Literal('POST'), t.Literal('PUT')],
					{
						description: 'the method to use',
					},
				),
				query: t.Optional(
					t.Record(t.String(), t.String(), {
						description: 'query parameters to append to the url',
						default: {},
					}),
				),
			}),
		},
	);
};
