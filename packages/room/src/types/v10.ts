// SPEC: https://spec.matrix.org/v1.12/rooms/v10/#deprecated-event-content-schemas
// https://spec.matrix.org/v1.12/rooms/v10/#values-in-mroompower_levels-events-must-be-integers

import { z } from "zod";
import { getPduPowerLevelsEventContentSchema } from "./v1";

export const PduPowerLevelsEventV10ContentSchema =
	getPduPowerLevelsEventContentSchema<ReturnType<typeof z.number>>(10);

export type PduPowerLevelsEventV10Content = z.infer<
	typeof PduPowerLevelsEventV10ContentSchema
>;
