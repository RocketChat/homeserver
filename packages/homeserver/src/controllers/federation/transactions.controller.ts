import { Body, Controller, Logger, Put } from '@nestjs/common';
import type { EventBase } from '../../models/event.model';
import { EventService } from '../../services/event.service';

@Controller('/_matrix/federation/v1')
export class TransactionsController {
	private readonly logger = new Logger(TransactionsController.name);

	constructor(private readonly eventService: EventService) {}

	@Put('/send/:txnId')
	async send(@Body() body: { pdus: EventBase[] }) {
		const { pdus = [] } = body;

		if (pdus.length === 0) {
			return {
				pdus: {},
				edus: {},
			};
		}

		const processedPDUs = await this.eventService.processIncomingPDUs(pdus);

		return {
			pdus: processedPDUs,
			edus: {},
		};
	}
}
