import { Elysia } from "elysia";
import { generateId } from "../authentication";
import { validateMatrixEvent } from "../validation/EventValidationPipeline";
import type { Event as MatrixEvent } from "../validation/validators/EventValidators";

async function processPDU(pdu: MatrixEvent["event"], pduResults: Record<string, { error?: string }>, txnId: string) {
    const eventId = generateId(pdu);

    try {
        const result = await validateMatrixEvent(pdu, txnId, eventId);
        if (!result.success && result.error) {
            pduResults[eventId] = { 
                error: `${result.error.code}: ${result.error.message}` 
            };
            console.error(`Validation failed for PDU ${eventId}: ${result.error.message}`);
        } else {
            console.debug(`Successfully validated PDU ${eventId}`);
            // TODO: Persist the event on LRU cache and database
            // TODO: Make this as part of the validation pipeline
        }
    } catch (error) {
        const errorMessage = error instanceof Error
            ? error.message
            : String(error);
        pduResults[eventId] = { error: errorMessage };
        console.error(`Error processing PDU: ${errorMessage}`);
    }

    return pduResults;
}

async function processPDUs(pdus: MatrixEvent["event"][], txnId: string): Promise<Record<string, { error?: string }>> {
    if (pdus.length === 0) {
        console.debug("No PDUs to process");
        return {};
    }

    const pduResults: Record<string, { error?: string }> = {};
    await Promise.all(pdus.map(pdu => processPDU(pdu, pduResults, txnId)));
    
    return pduResults;
}

export const sendTransactionRoute = new Elysia()
	.put("/send/:txnId", async ({ params, body, set }) => {
        const { txnId } = params;
        const { pdus = [], edus = [] } = body as { pdus?: MatrixEvent["event"][], edus?: any[] };

        const pduResults = await processPDUs(pdus, txnId);
        console.debug(`PDU results: ${JSON.stringify(pduResults)}`);
        
        set.status = 200;
        return {
            pdus: pduResults,
        }
    // }, SendTransactionDTO);
    });