import { PipelineBaseError } from "./pipeline-base.error";

/**
 * The event is well-formed, but it's not allowed according to Matrix rules (authorization failure based on auth_events, prev_events, etc.).
 * Do not apply the event to the room, but store it as rejected — and return an error in the /send response.
 */
export class RejectEventError extends PipelineBaseError {
  constructor(message: string) {
    super(message);
  }
}