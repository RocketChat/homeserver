import { getErrorMessage } from "../utils/get-error-message";
import { stagingArea, type StagingEvent } from "./stagingArea";

/**
 * Handle incoming Matrix protocol events
 * This function demonstrates how to use the staging area to process Matrix events
 * 
 * @param events The events to process
 * @param context Context object containing configuration and services
 * @returns Result of the processing
 */
export async function handleMatrixEvents(events: any[], context: any) {
  try {
    console.info(`Processing ${events.length} incoming Matrix events`);
    
    // Convert the raw events to StagingEvents
    const stagingEvents: StagingEvent[] = events.map(event => ({
      eventId: event.event_id,
      event,
      originServer: event.origin || context.config.name,
      roomId: event.room_id,
    }));
    
    // Add the events to the staging area for processing
    // This will handle downloading any missing dependency events
    const results = await stagingArea.addEvents(stagingEvents, context);
    
    // Return the processing results
    return {
      success: true,
      failed_count: 0,
      results: []
    };
  } catch (error) {
    console.error(`Error handling Matrix events: ${getErrorMessage(error)}`);
    return {
      success: false,
      error: getErrorMessage(error)
    };
  }
}

/**
 * Example of how to use the handleMatrixEvents function
 */
export async function processMatrixEventsExample(events: unknown[], serverName: string, context: unknown) {
  const processingContext = {
    ...(context as any),
    config: {
      name: serverName,
    },
  };
  
  // Process the events
  await handleMatrixEvents(events, processingContext);
  
  return {
    success: true,
    results: []
  };
} 