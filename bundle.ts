import Bun, { $ } from 'bun';

const inputDir = './packages/federation-sdk';
const outputDir = './federation-bundle';

// get dependencies from all packages
function getAllDependencies() {
	const packages = ['core', 'crypto', 'federation-sdk', 'room'];

	const allDependencies = new Set<string>();

	for (const pkg of packages) {
		const packageJson = require(`./packages/${pkg}/package.json`);

		const dependencies = packageJson.dependencies
			? Object.keys(packageJson.dependencies)
			: [];

		for (const dep of dependencies) {
			allDependencies.add(dep);
		}
	}

	return Array.from(allDependencies);
}

async function main() {
	await $`rm -rf ${outputDir}/dist`;
	await $`mkdir -p ${outputDir}/dist`;
	await $`touch ${outputDir}/yarn.lock`;

	const dependencies = getAllDependencies();

	await Bun.build({
		entrypoints: [`${inputDir}/src/index.ts`],
		outdir: `${outputDir}/dist`,
		target: 'node',
		format: 'cjs',
		external: dependencies,
		env: 'disable',
		define: {
			'process.env.NODE_ENV': '"production"',
		},
		minify: true,
		sourcemap: true,
	});

	const packageJson = JSON.parse(
		await Bun.file(`${inputDir}/package.json`).text(),
	);

	const filterWorkspace = (deps: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(deps || {}).filter(
				([, value]) =>
					typeof value === 'string' && !value.startsWith('workspace:'),
			),
		);

	packageJson.dependencies = filterWorkspace(packageJson.dependencies);
	packageJson.devDependencies = filterWorkspace(packageJson.devDependencies);
	packageJson.peerDependencies = filterWorkspace(packageJson.peerDependencies);

	await Bun.file(`${outputDir}/package.json`).write(
		`${JSON.stringify(packageJson, null, 2)}\n`,
	);

	await $`tsc --emitDeclarationOnly -p tsconfig.sdk.types.json`;

	console.log('Bundle complete!');
}

await main();

/*
bun build ./packages/federation-sdk/src/index.ts \
 --outdir ./packages/federation-bundle/dist-cli \
 --target node \
 --format=cjs \
 -e pino \
 -e mongodb \
 -e zod \
 -e pino-pretty \
 -e @rocket.chat/emitter \
 -e reflect-metadata \
 -e tsyringe \
 -e tweetnacl \
 --production \
 --sourcemap=inline
*/
