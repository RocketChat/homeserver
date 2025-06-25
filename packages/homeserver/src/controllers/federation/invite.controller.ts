import { container } from 'tsyringe';
import type { RouteDefinition } from '../../types/route.types';
import { ProcessInviteBodyDto, ProcessInviteParamsDto, ProcessInviteResponseDto } from '../../dtos/federation/invite.dto';
import { InviteService } from '../../services/invite.service';

export const inviteRoutes: RouteDefinition[] = [
  {
    method: 'PUT',
    path: '/_matrix/federation/v2/invite/:roomId/:eventId',
    handler: async (ctx) => {
      const inviteService = container.resolve(InviteService);
      return inviteService.processInvite(ctx.body.event, ctx.params.roomId, ctx.params.eventId);
    },
    validation: {
      params: ProcessInviteParamsDto,
      body: ProcessInviteBodyDto,
    },
    responses: {
      200: ProcessInviteResponseDto,
    },
    metadata: {
      tags: ['Federation'],
      summary: 'Process room invite',
      description: 'Process an invite event from another Matrix server'
    }
  }
];
