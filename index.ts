import 'reflect-metadata';

import { swagger } from '@elysiajs/swagger';
import Elysia from 'elysia';
import * as controllers from './packages/homeserver/src/controllers';
import logger from './packages/homeserver/src/utils/logger';
import { setup } from './packages/homeserver/src/homeserver.module';

if (process.argv.includes('--isolated-mode')) {
	logger.info('🚀 Isolated mode enabled');
	startElysiaServer();
} else {
	logger.info('🚀 Isolated mode disabled - you should get the exported routes and import them into your server');
}

async function startElysiaServer() {
	await setup();

	const app = new Elysia();

	app
		// @ts-ignore - Elysia is not typed correctly
		.use(swagger({
			documentation: {
				info: {
					title: 'Matrix Homeserver API',
					version: '1.0.0',
					description: 'Matrix Protocol Implementation - Federation and Internal APIs',
				},
			},
		}))

	app.use(controllers.invitePlugin);
	app.use(controllers.profilesPlugin);
	app.use(controllers.sendJoinPlugin);
	app.use(controllers.transactionsPlugin);
	app.use(controllers.versionsPlugin);
	app.use(controllers.internalInvitePlugin);
	app.use(controllers.internalMessagePlugin);
	app.use(controllers.pingPlugin);
	app.use(controllers.internalRoomPlugin);
	app.use(controllers.serverKeyPlugin);
	app.use(controllers.wellKnownPlugin);

	app.listen(8080, () => {
		logger.info('🚀 App running on http://localhost:8080');
	});
}