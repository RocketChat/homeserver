import dts from 'rollup-plugin-dts';

// Defina o ponto de entrada (entry point) do seu pacote
const input = './packages/federation-sdk/dist/index.d.ts';

// Função para determinar se um módulo deve ser tratado como externo
const isExternal = (id) => {
	// Módulos Node.js nativos
	if (
		id.startsWith('node:') ||
		[
			'http',
			'https',
			'dns',
			'events',
			'net',
			'stream',
			'tls',
			'worker_threads',
		].includes(id)
	) {
		return true;
	}

	// Dependências de terceiros
	if (
		[
			'zod',
			'mongodb',
			'tsyringe',
			'pino',
			'pino-std-serializers',
			'sonic-boom',
			'tweetnacl',
		].includes(id)
	) {
		return true;
	}

	// Pacotes internos do monorepo - devem ser incluídos no bundle
	if (id.startsWith('@rocket.chat/') || id.startsWith('packages/')) {
		return ['@rocket.chat/emitter'].includes(id);
	}

	// Imports relativos - devem ser incluídos no bundle
	if (id.startsWith('.')) {
		return false;
	}

	if (id.startsWith('/')) {
		return false;
	}

	// Por padrão, trata como externo
	return true;
};

export default [
	// Configuração para o arquivo JS (você pode continuar usando esbuild, se preferir)
	// ...

	// Configuração para o arquivo DTS (definição de tipos)
	{
		input,
		output: {
			file: './federation-bundle/dist/index.d.ts',
			format: 'es', // Formato de saída para os tipos
		},
		plugins: [
			dts({
				includeExternal: [
					'@rocket.chat/federation-core',
					'@rocket.chat/federation-room',
					'@rocket.chat/federation-crypto',
				],
				respectExternal: true,
			}),
		],
		// Use a função isExternal para determinar quais módulos são externos
		external: isExternal,
	},
];
