import type { LookupAllOptions } from 'node:dns';
import { Resolver, lookup } from 'node:dns/promises';

// no caching, depends on system
class _Resolver extends Resolver {
	private lookupOrder: LookupAllOptions['order'] = 'ipv6first';

	constructor() {
		super();

		if (process.env.HOMESERVER_CONFIG_DNS_SERVERS) {
			const servers = process.env.HOMESERVER_CONFIG_DNS_SERVERS.split(',').map(
				(s) => s.trim(),
			);

			this.setServers(servers);
		}

		// spec says v6 first, but there shouldn't be a case where a and aaaa records point to different services. if does, not an application problem.
		// for systems with no v6 support this still lets allow a fallback to v4 first. without needing to add system level dns filter.
		// as long as the name has an a record, should be able to communicate.
		const order = process.env
			.HOMESERVER_CONFIG_DNS_LOOKUP_ORDER as typeof this.lookupOrder;
		if (
			order === 'ipv4first' ||
			order === 'ipv6first' ||
			order === 'verbatim'
		) {
			this.lookupOrder = order;
		}
	}

	// The implementation uses an operating system facility that can associate names with addresses and vice versa
	// ^^ reason for this
	async resolve4And6(hostname: string) {
		const result = await lookup(hostname, {
			all: true,
			family: 0,
			order: this.lookupOrder,
		});

		return result.map((r) => r.address);
	}
}

export const resolver = new _Resolver();
