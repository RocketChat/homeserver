import type { RouteDefinition } from '../../types/route.types';
import { InternalPingResponseDto } from '../../dtos/internal/ping.dto';
import { container } from 'tsyringe';
import { EventEmitterService } from '../../services/event-emitter.service';

export const pingRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/internal/ping',
    handler: async () => {
      const eventEmitterService = container.resolve(EventEmitterService);
      eventEmitterService.emit('homeserver.ping', {
        message: 'PONG!',
      });
      return 'PONG!';
    },
    responses: {
      200: InternalPingResponseDto,
    },
    metadata: {
      tags: ['Internal'],
      summary: 'Health check endpoint',
      description: 'Simple ping endpoint to check if the server is running'
    }
  }
];
