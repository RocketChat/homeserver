import { PipelineBaseError } from "./pipeline-base.error";

/**
 * The event is well-formed, but it's not allowed according to Matrix rules (authorization failure based on auth_events, prev_events, etc.).
 * Store the event in the DAG, but do not advance the current room state with it.
 */
export class SoftFailEventError extends PipelineBaseError {
  constructor(message: string) {
    super(message);
  }
}
