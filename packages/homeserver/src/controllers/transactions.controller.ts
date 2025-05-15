import { Controller, HttpStatus, Put, Req, Res } from "@nestjs/common";
import type { EventService } from "../services/event.service";

@Controller("/_matrix/federation/v1")
export class TransactionsController {
	constructor(private readonly eventService: EventService) {
		console.log("\n\n\n");
		console.log(this.eventService);
		console.log("\n\n\n");
	}

	@Put("/send/:txnId")
	async send(@Req() req: Request, @Res() res: Response) {
		try {
			const { pdus = [] } = req.body;

			const processedPDUs = await this.eventService.processIncomingPDUs(pdus);

			res.status(HttpStatus.OK).json({
				pdus: processedPDUs,
				edus: {},
			});
		} catch (error) {
			res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
				errcode: "M_UNKNOWN",
				error: "Failed to process transaction",
			});
		}
	}
}
