export * from './base';

export * from './m.typing';
export * from './m.presence';

import type { BaseEDU } from './base';
import type { PresenceEDU } from './m.presence';
import type { TypingEDU } from './m.typing';

export type MatrixEDUTypes = TypingEDU | PresenceEDU | BaseEDU;
