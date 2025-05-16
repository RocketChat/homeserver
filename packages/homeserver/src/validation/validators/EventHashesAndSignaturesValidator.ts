import { MatrixError } from '../../errors';
import { getPublicKeyFromRemoteServer, makeGetPublicKeyFromServerProcedure } from '../../procedures/getPublicKeyFromServer';
import { checkSignAndHashes } from '../../utils/checkSignAndHashes';
import { Validator } from '../decorators/validator.decorator';
import type { EventTypeArray, IPipeline } from '../pipelines';

@Validator()
export class EventHashesAndSignaturesValidator implements IPipeline<EventTypeArray> {
  async validate(events: EventTypeArray, context: any): Promise<EventTypeArray> {
    const response: EventTypeArray = [];

    for (const event of events) {
      const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
        context.mongo.getValidPublicKeyFromLocal,
        (origin, key) => getPublicKeyFromRemoteServer(origin, context.config.name, key),
        context.mongo.storePublicKey,
      );

      const eventId = event.eventId;

      try{
        await checkSignAndHashes(event.event, event.event.origin, getPublicKeyFromServer);
        response.push({ eventId, event: event.event });
      } catch (error: any) {
        console.error(error);
        response.push({
          eventId,
          error: {
            errcode: error instanceof MatrixError ? error.errcode : 'M_UNKNOWN',
            error: error.message
          },
          event: event.event
        });
      }
    }

    return response;
  }
}