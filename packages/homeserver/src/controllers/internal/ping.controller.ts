import { Elysia } from 'elysia';
import logger from '../../utils/logger';

export const pingPlugin = (app: Elysia) =>
	app.get('/internal/ping', () => {
		logger.debug('Ping endpoint called');
		return 'PONG!';
	});
