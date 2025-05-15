import { Logger } from "../utils/logger";
import { stagingArea, StagingEvent } from "./stagingArea";

const logger = new Logger("MatrixEventHandler");

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
    logger.info(`Processing ${events.length} incoming Matrix events`);
    
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
    
    // Log the results
    const successCount = results.filter(r => r.success).length;
    logger.info(`Successfully processed ${successCount} of ${results.length} events`);
    
    // Return the processing results
    return {
      success: true,
      processed_count: results.length,
      successful_count: successCount,
      failed_count: results.length - successCount,
      results
    };
  } catch (error) {
    logger.error(`Error handling Matrix events: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Example of how to use the handleMatrixEvents function
 */
export async function processMatrixEventsExample(events: unknown[], serverName: string, context: unknown) {
  // Set up context with necessary configuration and services
  const processingContext = {
    ...context,
    config: {
      name: serverName,
      // Add other necessary config
    },
    // Add necessary services like database access
  };
  
  // Process the events
  const result = await handleMatrixEvents(events, processingContext);
  
  if (result.success) {
    logger.info(`Successfully processed ${result.successful_count} events`);
    
    // Handle any failed events if needed
    if (result.failed_count && result.failed_count > 0) {
      logger.warn(`Failed to process ${result.failed_count} events`);
    }
  } else {
    logger.error(`Failed to process events: ${result.error}`);
  }
  
  return result;
} 