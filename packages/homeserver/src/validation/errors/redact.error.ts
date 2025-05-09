import { PipelineBaseError } from "./pipeline-base.error";

/**
 * The event fails hash validation, meaning its content may be tampered with.
 * Should redact the event (keep only allowed fields like type, room_id, sender, etc.), but still process it.
 */
export class RedactEventError extends PipelineBaseError {
  constructor(message: string) {
    super(message);
  }
}