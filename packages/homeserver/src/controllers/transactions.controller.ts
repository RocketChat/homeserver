import {
	Body,
	Controller,
	HttpStatus,
	Inject,
	Injectable,
	Param,
	Put,
	Res,
} from "@nestjs/common";
import type { Response } from "express";
import { EventService } from "../services/event.service";
import { Logger } from "../utils/logger";

const logger = new Logger("SendTransactionRoute");

@Controller("/_matrix/federation/v1")
@Injectable()
export class TransactionsController {
	constructor(@Inject(EventService) private readonly eventService: EventService) {}

	@Put("/send/:txnId")
	async send(
		@Param('txnId') txnId: string,
		@Body() body: any,
		@Res() res: Response,
	) {
		try {
			logger.info(`Received transaction ${txnId}`);

			const { pdus = [] } = body as { pdus: roomV10Type[] };

			if (!this.eventService) {
				logger.warn("EventService is null, transaction processing skipped");
				res.status(HttpStatus.OK).json({ pdus: {}, edus: {} });
				return;
			}

			const processedPDUs = await this.eventService.processIncomingPDUs(pdus);

			res.status(HttpStatus.OK).json({
				pdus: processedPDUs,
				edus: {},
			});
		} catch (error) {
			logger.error(`Error processing transaction: ${error}`);
			res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
				errcode: "M_UNKNOWN",
				error: "Failed to process transaction",
			});
		}
	}
}
