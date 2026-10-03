import {
	DEFAULT_HS_URL,
	logOutbound,
	matrixCreateRoom,
	matrixResolveAlias,
	matrixSendMessage,
} from './shared';

function parseCliArgs(argv: string[]) {
	const args: Record<string, string | true> = {};
	for (let i = 0; i < argv.length; i += 1) {
		const item = argv[i];
		if (!item.startsWith('--')) continue;
		const key = item.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			args[key] = true;
			continue;
		}
		args[key] = next;
		i += 1;
	}
	return args;
}

function requireStringArg(
	args: Record<string, string | true>,
	name: string,
): string {
	const val = args[name];
	if (typeof val === 'string' && val.trim()) return val;
	throw new Error(`missing required --${name}`);
}

function printCliHelp() {
	const help = [
		'Mock Bridge CLI',
		'',
		'Commands:',
		'  bun run cli create-room --user-id @mock_alice:example.org [--hs-url http://localhost:8008] [--name "Room"] [--alias "#mock_test:example.org"]',
		'  bun run cli send --user-id @mock_alice:example.org (--room-id !id:server | --alias "#mock_test:example.org") --text "hello" [--hs-url http://localhost:8008]',
		'',
		'Env:',
		`  MOCK_BRIDGE_HS_URL (default: ${DEFAULT_HS_URL})`,
	].join('\n');
	console.log(help);
}

async function main() {
	const argv = process.argv.slice(2);
	const sub = argv[0];
	if (!sub || sub === '--help' || sub === '-h') {
		printCliHelp();
		return;
	}

	const args = parseCliArgs(argv.slice(1));
	const hsUrl =
		typeof args['hs-url'] === 'string'
			? (args['hs-url'] as string)
			: DEFAULT_HS_URL;

	if (sub === 'create-room') {
		const userId = requireStringArg(args, 'user-id');
		const name =
			typeof args.name === 'string' ? (args.name as string) : undefined;
		const topic =
			typeof args.topic === 'string' ? (args.topic as string) : undefined;
		const alias =
			typeof args.alias === 'string' ? (args.alias as string) : undefined;

		const result = await matrixCreateRoom({
			hsUrl,
			userId,
			name,
			topic,
			alias,
		});
		logOutbound(
			`createRoom userId=${userId} room_id=${result.room_id} alias=${result.alias ?? '-'}`,
		);
		console.log(JSON.stringify(result));
		return;
	}

	if (sub === 'send') {
		const userId = requireStringArg(args, 'user-id');
		const text = requireStringArg(args, 'text');
		const msgtype =
			typeof args.msgtype === 'string' ? (args.msgtype as string) : undefined;

		const roomIdArg =
			typeof args['room-id'] === 'string' ? (args['room-id'] as string) : null;
		const aliasArg =
			typeof args.alias === 'string' ? (args.alias as string) : null;

		let roomId: string | null = roomIdArg;
		if (!roomId && aliasArg) {
			roomId = await matrixResolveAlias({ hsUrl, userId, alias: aliasArg });
			if (!roomId)
				throw new Error(
					`unknown alias: ${aliasArg}. Create it first or pass --room-id.`,
				);
		}
		if (!roomId) throw new Error('missing --room-id or --alias');

		const result = await matrixSendMessage({
			hsUrl,
			userId,
			roomId,
			text,
			msgtype,
		});
		logOutbound(
			`send userId=${userId} room_id=${roomId} event_id=${result.event_id ?? '-'} txn_id=${result.txn_id}`,
		);
		console.log(JSON.stringify({ room_id: roomId, ...result }));
		return;
	}

	throw new Error(`unknown cli subcommand: ${sub}`);
}

main().catch((err) => {
	console.error('❌ fatal', err);
	process.exitCode = 1;
});
