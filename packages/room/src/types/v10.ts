// SPEC: https://spec.matrix.org/v1.12/rooms/v10/#deprecated-event-content-schemas
// https://spec.matrix.org/v1.12/rooms/v10/#values-in-mroompower_levels-events-must-be-integers

import { z } from 'zod';
import {
	PduCanonicalAliasEventContentSchema,
	PduCreateEventContentSchema,
	PduJoinRuleEventContentSchema,
	PduMembershipEventContentSchema,
	PduPowerLevelsEventContentSchema,
	getPduPowerLevelsEventContentSchema,
} from './v1';
import { PduPowerLevelsEventV3ContentSchema, PduV3Schema } from './v3';

export const PduPowerLevelsEventV10ContentSchema =
	getPduPowerLevelsEventContentSchema<ReturnType<typeof z.number>>(10);

export type PduPowerLevelsEventV10Content = z.infer<
	typeof PduPowerLevelsEventV10ContentSchema
>;

export const PduV10Schema = PduV3Schema.extend({
	content: z.union([
		PduPowerLevelsEventV10ContentSchema,
		PduMembershipEventContentSchema,
		PduCreateEventContentSchema,
		PduJoinRuleEventContentSchema,
		PduCanonicalAliasEventContentSchema,
	]),
});

export type PduV10 = z.infer<typeof PduV10Schema>;

export type PduPowerLevelsEventV10 = PduV10 & {
	content: PduPowerLevelsEventV10Content;
};
