import { lookup, Resolver } from "node:dns/promises";

// no caching, depends on system
class _Resolver extends Resolver {
	constructor() {
		super();

		if (process.env.HOMESERVER_CONFIG_DNS_SERVERS) {
			const servers = process.env.HOMESERVER_CONFIG_DNS_SERVERS.split(",").map(
				(s) => s.trim(),
			);

			this.setServers(servers);
		}
	}

	// The implementation uses an operating system facility that can associate names with addresses and vice versa
	// ^^ reason for this
	async resolve4And6(hostname: string) {
		console.log("resolve4And6", hostname);
		const result = await lookup(hostname, {
			all: true,
			family: 0,
			order: "ipv6first",
		});

		return result.map((r) => r.address);
	}
}

export const resolver = new _Resolver();
