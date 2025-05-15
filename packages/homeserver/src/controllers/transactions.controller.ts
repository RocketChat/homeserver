import { Controller, Put, Req, Res } from "@nestjs/common";
import { EventService } from "../services/event.service";

@Controller("/_matrix/federation/v1")
export class TransactionsController {
	constructor(private readonly eventService: EventService) {}

	@Put("/send/:txnId")
	async send(@Req() req: Request, @Res() res: Response) {
		try {
			const { pdus = [] } = req.body;

			const processedPDUs = await this.eventService.processIncomingPDUs(pdus);

			return {
				pdus: processedPDUs,
				edus: {},
			};
		} catch (error) {
			return Promise.reject({
				errcode: "M_UNKNOWN",
				error: "Failed to process transaction",
			});
		}
	}
}
