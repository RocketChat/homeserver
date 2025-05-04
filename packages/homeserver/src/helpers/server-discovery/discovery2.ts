import { Resolver } from "node:dns/promises";
import { isIP, isIPv6 } from "node:net";
import assert from 'node:assert/strict';

const DEFAULT_PORT = 8448;

function getResolver() {
	const resolver = new Resolver();

	if (process.env.HOMESERVER_CONFIG_DNS_SERVERS) {
		const servers = process.env.HOMESERVER_CONFIG_DNS_SERVERS.split(",").map(
			(s) => s.trim(),
		);

		resolver.setServers(servers);
	}

	return resolver;
}

// SPEC: https://spec.matrix.org/v1.12/server-server-api/#resolving-server-names

/*
 * Server names are resolved to an IP address and port to connect to, and have various conditions affecting which certificates and Host headers to send.
 */

type Address = string;

type HostHeaders = { Host: Address };

export async function getHomeserverFinalAddress(
	hostname: string,
	port: string,
): Promise<[Address, HostHeaders]> {
	const _port = parseInt(port, 10);

	assert(_port >= 0 && _port <= 65535, "Port must be between 0 and 65535");

	/*
	 * 1. If the hostname is an IP literal, then that IP address should be used, together with the given port number, or 8448 if no port is given. The target server must present a valid certificate for the IP address. The Host header in the request should be set to the server name, including the port if the server name included one.
	 */

	if (isIP(hostname)) {
		const finalIp = isIPv6(hostname) ? `[${hostname}]` : hostname; // wrap in []
		const finalPort = port || DEFAULT_PORT;
		// "Target server must present a valid certificate for the IP address", i.e. always https
		const finalAddress = `https://${finalIp}:${finalPort}`;
		const hostHeader = { Host: `${hostname}${port ? `:${port}` : ""}` };

		return [finalAddress, hostHeader];
	}

	/*
	 * 2. If the hostname is not an IP literal, and the server name includes an explicit port, resolve the hostname to an IP address using CNAME, AAAA or A records. Requests are made to the resolved IP address and given port with a Host header of the original server name (with port). The target server must present a valid certificate for the hostname.
	 */

	// includes explicit port
	if (port) {
		const errors: Error[] = [];

		const hostHeaders = { Host: `${hostname}:${port}` };

		const resolver = getResolver();

		let finalAddress = "";

		// in order as in spec
		// CNAME, AAAA, A

		const [cnames, aaas, as] = await Promise.allSettled([
			resolver.resolveCname(hostname),
			resolver.resolve6(hostname),
			resolver.resolve4(hostname),
		]).then((results) => {
			return results.map((result) => {
				if (result.status === "fulfilled") {
					return result.value;
				}

				errors.push(result.reason);
				return [];
			});
		});

		if (cnames.length > 0) {
			finalAddress = cnames[0];
		} else if (aaas.length > 0) {
			finalAddress = `[${aaas[0]}]`;
		} else if (as.length > 0) {
			finalAddress = as[0];
		}

		if (!finalAddress) {
			throw errors.reduce((acc, e) => {
				acc.message += `\n${e.message}`;
				return acc;
			}, new Error("Failed to resolve hostname"));
		}

		return [`https://${finalAddress}:${port}`, hostHeaders];
	}

	/*
	 * 3. wellknown delegation
	 */

	// If the hostname is not an IP literal, a regular HTTPS request is made to https://<hostname>/.well-known/matrix/server,

	return ["", { Host: hostname }];
}

type WellKnownResponse = {
	"m.server": string;
};

async function fromWellKnownDelegation(host: string) {
	// If the hostname is not an IP literal, a regular HTTPS request is made to https://<hostname>/.well-known/matrix/server,

	const isWellKnownResponse = (
		response: any,
	): response is WellKnownResponse => {
		return (
			typeof response === "object" &&
			response &&
			typeof response["m.server"] === "string"
		);
	};

	const response = await fetch(`https://${host}/.well-known/matrix/server`, {
		headers: {
			Accept: "application/json",
		},
		redirect: "follow",
	});

	if (!response.ok) {
		throw new Error("Failed to fetch well-known response");
	}

	const data = await response.json();

	if (!isWellKnownResponse(data)) {
		throw new Error("Invalid well-known response");
	}

	const [address, port] = data["m.server"].split(":");
}
