import { z } from 'zod';

export interface RouteDefinition {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
	path: string;
	handler: (ctx: RouteContext) => Promise<any>;
	validation?: {
		params?: any;
		query?: any;
		body?: any;
	};
	metadata?: {
		auth?: boolean;
		rateLimit?: boolean;
		tags?: string[];
		summary?: string;
		description?: string;
	};
	responses?: Record<number, any>;
}

export interface RouteContext {
	params: any;
	query: any;
	body: any;
	headers: Record<string, string>;
	setStatus: (code: number) => void;
	setHeader: (key: string, value: string) => void;
}

export interface FrameworkAdapter {
	applyRoutes(app: any, routes: RouteDefinition[]): void;
}
