import { container } from "tsyringe";
import type { RouteDefinition } from "../../types/route.types";
import { WellKnownServerResponseDto } from "../../dtos";
import { WellKnownService } from "../../services/well-known.service";

export const wellKnownRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/.well-known/matrix/server",
    handler: async (_ctx) => {
      const wellKnownService = container.resolve(WellKnownService);
      const responseData = wellKnownService.getWellKnownHostData();
      // const etag = new Bun.CryptoHasher('md5')
      //   .update(JSON.stringify(responseData))
      //   .digest('hex');
      // ctx.setHeader('ETag', etag);
      // ctx.setHeader('Content-Type', 'application/json');
      return responseData;
    },
    responses: {
      200: WellKnownServerResponseDto,
    },
    metadata: {
      tags: ["Well-Known"],
      summary: "Get well-known host data",
      description: "Get the well-known host data",
    },
  },
];
