import pino from 'pino';

const logger = pino({
	name: 'homeserver',
	level: process.env.LOG_LEVEL || 'info',
	transport:
		process.env.NODE_ENV === 'development'
			? {
					target: 'pino-pretty',
					options: { colorize: true },
				}
			: undefined,
});

export default logger;

export function createLogger(name: string) {
	return logger.child({ name });
}
