import 'reflect-metadata';

import {
	ConfigService,
	type FederationContainerOptions,
	type HomeserverEventSignatures,
	createFederationContainer,
} from '@hs/federation-sdk';

import { swagger } from '@elysiajs/swagger';
import { convertSigningKeyToBase64 } from '@hs/core';
import type { Emitter } from '@rocket.chat/emitter';
import Elysia from 'elysia';
import { invitePlugin } from './controllers/federation/invite.controller';
import { profilesPlugin } from './controllers/federation/profiles.controller';
import { roomPlugin } from './controllers/federation/rooms.controller';
import { sendJoinPlugin } from './controllers/federation/send-join.controller';
import { transactionsPlugin } from './controllers/federation/transactions.controller';
import { versionsPlugin } from './controllers/federation/versions.controller';
import { internalInvitePlugin } from './controllers/internal/invite.controller';
import { internalMessagePlugin } from './controllers/internal/message.controller';
import { pingPlugin } from './controllers/internal/ping.controller';
import { internalRoomPlugin } from './controllers/internal/room.controller';
import { serverKeyPlugin } from './controllers/key/server.controller';
import { wellKnownPlugin } from './controllers/well-known/well-known.controller';

export type { HomeserverEventSignatures };
export interface HomeserverSetupOptions {
	emitter?: Emitter<HomeserverEventSignatures>;
	containerOptions?: FederationContainerOptions;
}

export async function setup(options?: HomeserverSetupOptions) {
	const config = new ConfigService();
	const matrixConfig = config.getMatrixConfig();
	const serverConfig = config.getServerConfig();
	const signingKeys = await config.getSigningKey();
	const signingKey = signingKeys[0];

	const containerOptions: FederationContainerOptions = {
		federationOptions: {
			serverName: matrixConfig.serverName,
			signingKey: convertSigningKeyToBase64(signingKey),
			timeout: 30000,
			baseUrl: serverConfig.baseUrl,
		},
		emitter: options?.emitter,
	};

	const container = await createFederationContainer(containerOptions);

	const app = new Elysia();

	app
		.use(
			// @ts-ignore - Elysia is not typed correctly
			swagger({
				documentation: {
					info: {
						title: 'Matrix Homeserver API',
						version: '1.0.0',
						description:
							'Matrix Protocol Implementation - Federation and Internal APIs',
					},
				},
			}),
		)
		.use(invitePlugin)
		.use(profilesPlugin)
		.use(sendJoinPlugin)
		.use(transactionsPlugin)
		.use(versionsPlugin)
		.use(internalInvitePlugin)
		.use(internalMessagePlugin)
		.use(pingPlugin)
		.use(internalRoomPlugin)
		.use(serverKeyPlugin)
		.use(wellKnownPlugin)
		.use(roomPlugin);

	return { app, container };
}

export const appPromise = setup().then(({ app }) => app);

// TODO: Register plugins/handlers for controllers here
// e.g. app.use(profilesPlugin)

// Export app for use in main entry point
