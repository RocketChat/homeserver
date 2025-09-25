import Bun, { $ } from 'bun';

const inputDir = './packages/federation-sdk';
const outputDir = './federation-bundle';

function getLocalPackages(packages: string[]) {
	const localPackages = new Set();
	for (const pkg of packages) {
		const packageJson = require(`./packages/${pkg}/package.json`);
		localPackages.add(packageJson.name);
	}
	return localPackages;
}

const getDependencies = (
	pkg: string,
	type: 'dependencies' | 'devDependencies' | 'peerDependencies',
) => {
	const packageJson = require(`./packages/${pkg}/package.json`);
	return packageJson[type] ?? {};
};

const getDependenciesFromPackages = (
	packages: string[],
	type: 'dependencies' | 'devDependencies' | 'peerDependencies',
) => {
	return packages.reduce((acc, name) => {
		// biome-ignore lint/performance/noAccumulatingSpread: <explanation>
		return { ...acc, ...getDependencies(name, type) };
	}, {});
};

const filterWorkspace = (deps: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(deps || {}).filter(
			([, value]) =>
				typeof value === 'string' && !value.startsWith('workspace:'),
		),
	);

// TODO get list of packages programmatically
const packages = ['core', 'crypto', 'federation-sdk', 'room'];

const localPackagesNames = getLocalPackages(packages);

const packageJson = JSON.parse(
	await Bun.file(`${inputDir}/package.json`).text(),
);

async function main() {
	await $`rm -rf ${outputDir}/dist`;
	await $`mkdir -p ${outputDir}/dist`;
	await $`cp LICENSE ${outputDir}/dist`;
	await $`touch ${outputDir}/yarn.lock`;

	const dependencies = getDependenciesFromPackages(packages, 'dependencies');
	const devDependencies = getDependenciesFromPackages(
		packages,
		'devDependencies',
	);
	const peerDependencies = getDependenciesFromPackages(
		packages,
		'peerDependencies',
	);

	await Bun.build({
		entrypoints: [`${inputDir}/src/index.ts`],
		outdir: `${outputDir}/dist`,
		target: 'node',
		format: 'cjs',
		external: Object.keys(dependencies).filter(
			(dep) => !localPackagesNames.has(dep),
		),
		env: 'disable',
		define: {
			'process.env.NODE_ENV': '"production"',
		},
		// minify: true,
		// sourcemap: true,
	});

	packageJson.dependencies = filterWorkspace({
		...packageJson.dependencies,
		...dependencies,
	});
	packageJson.devDependencies = filterWorkspace({
		...packageJson.devDependencies,
		...devDependencies,
	});
	packageJson.peerDependencies = filterWorkspace({
		...packageJson.peerDependencies,
		...peerDependencies,
	});

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
