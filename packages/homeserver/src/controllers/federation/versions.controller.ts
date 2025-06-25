import { container } from "tsyringe";
import type { RouteDefinition } from "../../types/route.types";
import { GetVersionsResponseDto } from "../../dtos/federation/versions.dto";
import { ConfigService } from "../../services/config.service";

export const versionsRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/_matrix/federation/v1/version',
    handler: async (ctx) => {
      const configService = container.resolve(ConfigService);
      const config = configService.getServerConfig();
      
      return {
        server: {
          name: config.name,
          version: config.version,
        },
      };
    },
    responses: {
      200: GetVersionsResponseDto,
    },
    metadata: {
      tags: ['Federation'],
      summary: 'Get versions',
      description: 'Get the versions of the server'
    }
  }
];
