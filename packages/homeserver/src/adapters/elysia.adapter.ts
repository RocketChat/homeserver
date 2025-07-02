import { Elysia } from 'elysia';
import type { FrameworkAdapter, RouteDefinition, RouteContext } from '../types/route.types';
import logger from '../utils/logger';

export class ElysiaAdapter implements FrameworkAdapter {
  applyRoutes(app: Elysia, routes: RouteDefinition[]): void {
    for (const route of routes) {
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';
      
      // Build the route configuration
      const routeConfig: any = {
        detail: route.metadata ? {
          tags: route.metadata.tags,
          summary: route.metadata.summary,
          description: route.metadata.description,
        } : undefined,
      };


      // Register the route
      app[method](route.path, async (context) => {
        // Transform Elysia context to RouteContext
        const routeContext: RouteContext = {
          params: context.params || {},
          query: context.query || {},
          body: context.body || {},
          headers: context.headers as Record<string, string>,
          setStatus: (code: number) => {
            context.set.status = code;
          },
          setHeader: (key: string, value: string) => {
            context.set.headers[key] = value;
          },
        };

        // Validate inputs if schemas are provided
        if (route.validation) {
          try {
            if (route.validation.params) {
              routeContext.params = route.validation.params.parse(context.params);
            }
            if (route.validation.query) {
              routeContext.query = route.validation.query.parse(context.query);
            }
            if (route.validation.body) {
              routeContext.body = route.validation.body.parse(context.body);
            }
          } catch (error) {
            context.set.status = 400;
            return { error: 'Validation failed', details: error };
          }
        }

        // Call the handler
        let result: any;
        try {
          result = await route.handler(routeContext);
        } catch (error) {
          logger.error('Route handler error:', {
            method: route.method,
            path: route.path,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          context.set.status = 500;
          return {
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' 
              ? (error instanceof Error ? error.message : String(error))
              : 'An unexpected error occurred',
          };
        }
        
        // Validate response if schema is provided
        const statusCode = context.set.status || 200;
        if (route.responses && statusCode in route.responses) {
          try {
            const responseSchema = route.responses[statusCode as keyof typeof route.responses];
            return responseSchema.parse(result);
          } catch (validationError) {
            // Response validation failure is a critical error - our handler returned invalid data
            logger.error('Response validation failed:', {
              method: route.method,
              path: route.path,
              statusCode,
              error: validationError,
              invalidResponse: process.env.NODE_ENV === 'development' ? result : undefined,
            });
            
            // In production, don't expose the invalid response to the client
            context.set.status = 500;
            return {
              error: 'Internal server error',
              message: process.env.NODE_ENV === 'development'
                ? 'Response validation failed'
                : 'An unexpected error occurred',
            };
          }
        }
        
        return result;
      }, routeConfig);
    }
  }
}