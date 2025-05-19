import { PipelineBaseError } from "./pipeline-base.error";

/**
 * The event is fundamentally broken and should not be stored, not propagated, and not processed at all.
 * Should be ignored completely — like it never arrived.
 */
export class DropEventError extends PipelineBaseError {}
