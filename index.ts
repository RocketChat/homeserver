import 'reflect-metadata';

import { swagger } from '@elysiajs/swagger';
import Elysia from 'elysia';
import * as controllers from './packages/homeserver/src/controllers';
import logger from './packages/homeserver/src/utils/logger';
import { setup } from './packages/homeserver/src/homeserver.module';
import { ElysiaAdapter } from './packages/homeserver/src/adapters/elysia.adapter';
import { getAllRoutes } from './packages/homeserver/src/routes';

const isStandaloneMode = process.argv.includes('--isolated-mode');
if (isStandaloneMode) {
	logger.info('🚀 Starting homeserver in standalone mode');
	startElysiaServer();
} else {
	logger.info(
		'🚀 Homeserver running in embedded mode - routes exported for Rocket.Chat',
	);
}

export { getAllRoutes, setup as setupHomeserver };
export { getAllServices } from './packages/homeserver/src/services';
export type { HomeserverServices } from './packages/homeserver/src/services';
export type { HomeserverSetupOptions } from './packages/homeserver/src/homeserver.module';
logger.info(
	'🚀 Isolated mode disabled - you should get the exported routes and import them into your server',
);
}
export type { RouteDefinition } from './packages/homeserver/src/types/route.types';
export type { HomeserverEventSignatures } from './packages/homeserver/src/types/events';
export type {
	RouteDefinition,
	RouteContext,
} from './packages/homeserver/src/types/route.types';

async function startElysiaServer() {
	await setup();

	const app = new Elysia();

	app
		.use(swagger({
			documentation: {
				info: {
					title: 'Matrix Homeserver API',
					version: '1.0.0',
					description: 'Matrix Protocol Implementation - Federation and Internal APIs',
				},
			}),
		);

	const adapter = new ElysiaAdapter();
	const routes = getAllRoutes();
	adapter.applyRoutes(app, routes);

	app.onAfterResponse(({ request, set, response }) => {
		const responseLength =
			response instanceof Response
				? response.headers.get('content-length') || 'unknown'
				: JSON.stringify(response).length;

		logger.info(
			`${request.method} ${request.url} ${set.status || 200} ${responseLength}`,
		);
	});

	app.listen(8080, () => {
		logger.info('🚀 App running on http://localhost:8080');
	});
}
