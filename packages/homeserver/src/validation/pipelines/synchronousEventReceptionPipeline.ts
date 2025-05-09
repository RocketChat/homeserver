import type { IPipeline } from ".";
import { SequentialPipeline } from ".";
import { Pipeline } from "../decorators/pipeline.decorator";
import type { roomV10Type } from "../schemas/room-v10.type";
import {
  EventFormatValidator,
  EventHashesAndSignaturesValidator,
  EventTypeSpecificValidator
} from "../validators";

export type EventType = {
  eventId: string;
  event: roomV10Type;
  error?: {
    errcode: string;
    error: string;
  }
}

export type EventTypeArray = EventType[];

@Pipeline()
export class SynchronousEventReceptionPipeline implements IPipeline<EventTypeArray> {
    private pipeline: IPipeline<EventTypeArray>;

    constructor() {
      this.pipeline = this.createPipeline();
    }
  
    private createPipeline(): IPipeline<EventTypeArray> {
      return new SequentialPipeline<EventTypeArray>()
        .add(new EventFormatValidator())
        .add(new EventTypeSpecificValidator())
        .add(new EventHashesAndSignaturesValidator())
        // .add(new OutlierDetectionValidator()); // TODO: Think there's a better place for this
    }

    async validate(events: EventTypeArray, context: any): Promise<EventTypeArray> {
        return await this.pipeline.validate(events, context);
    }
}