import 'reflect-metadata';

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	ConfigService,
	type FederationContainerOptions,
	type HomeserverEventSignatures,
	createFederationContainer,
} from '@hs/federation-sdk';
import * as dotenv from 'dotenv';

import { swagger } from '@elysiajs/swagger';
import type { Emitter } from '@rocket.chat/emitter';
import Elysia from 'elysia';
import { invitePlugin } from './controllers/federation/invite.controller';
import { profilesPlugin } from './controllers/federation/profiles.controller';
import { roomPlugin } from './controllers/federation/rooms.controller';
import { sendJoinPlugin } from './controllers/federation/send-join.controller';
import { transactionsPlugin } from './controllers/federation/transactions.controller';
import { versionsPlugin } from './controllers/federation/versions.controller';
import { internalDirectMessagePlugin } from './controllers/internal/direct-message.controller';
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
	const envPath = path.resolve(process.cwd(), '.env');
	if (fs.existsSync(envPath)) {
		dotenv.config({ path: envPath });
	}

	const config = new ConfigService({
		serverName: process.env.SERVER_NAME || 'rc1',
		port: Number.parseInt(process.env.SERVER_PORT || '8080', 10),
		database: {
			uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/matrix',
			name: process.env.DATABASE_NAME || 'matrix',
			poolSize: Number.parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
		},
		matrixDomain: process.env.MATRIX_DOMAIN || 'rc1',
		keyRefreshInterval: Number.parseInt(
			process.env.MATRIX_KEY_REFRESH_INTERVAL || '60',
			10,
		),
		signingKeyPath: process.env.CONFIG_FOLDER || './rc1.signing.key',
		version: process.env.SERVER_VERSION || '1.0',
	});

	const containerOptions: FederationContainerOptions = {
		emitter: options?.emitter,
	};

	const container = createFederationContainer(containerOptions, config);

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
		.use(internalDirectMessagePlugin)
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
