import { Elysia } from "elysia";
import { Logger } from "./logger";
// import { SendTransactionDTO } from "./sendTransactionDTO";
import { validateMatrixEvent } from "../../validation/EventValidationPipeline";
import { Event as MatrixEvent } from "../../validation/validators/EventValidators";
import { generateId } from "../../authentication";
import { routerWithMutex } from "../../plugins/mutex";

const logger = new Logger("SendTransactionRoute");

async function processPDU(pdu: MatrixEvent["event"], pduResults: Record<string, { error?: string }>, txnId: string, context: any) {
    const eventId = generateId(pdu);

    try {
        const result = await validateMatrixEvent(pdu, txnId, eventId, context);
        if (!result.success && result.error) {
            pduResults[eventId] = { 
                error: `${result.error.code}: ${result.error.message}` 
            };
            logger.error(`Validation failed for PDU ${eventId}: ${result.error.message}`);
        } else {
            logger.debug(`Successfully validated PDU ${eventId}`);
            // TODO: Persist the event on LRU cache and database
            // TODO: Make this as part of the validation pipeline
        }
    } catch (error) {
        const errorMessage = error instanceof Error
            ? error.message
            : String(error);
        pduResults[eventId] = { error: errorMessage };
        logger.error(`Error processing PDU: ${errorMessage}`);
    }

    return pduResults;
}

async function processPDUs(pdus: MatrixEvent["event"][], txnId: string, context: any): Promise<Record<string, { error?: string }>> {
    if (pdus.length === 0) {
        logger.debug("No PDUs to process");
        return {};
    }

    const pduResults: Record<string, { error?: string }> = {};
    await Promise.all(pdus.map(pdu => processPDU(pdu, pduResults, txnId, context)));
    
    return pduResults;
}

export const sendTransactionRoute = new Elysia()
    .use(routerWithMutex)
	.put("/send/:txnId", async ({ params, body, ...context }) => {
        const { txnId } = params;
        const { pdus = [], edus = [] } = body as { pdus?: MatrixEvent["event"][], edus?: MatrixEvent["event"][] };

        const pduResults = await processPDUs(pdus, txnId, context);
        logger.debug(`PDU results: ${JSON.stringify(pduResults)}`);
        
        context.set.status = 200;
        return {
            pdus: pduResults,
        }
    // }, SendTransactionDTO);
    });