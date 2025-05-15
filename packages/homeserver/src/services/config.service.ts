import { Injectable } from "@nestjs/common";
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { getKeyPair } from "../keys";

const CONFIG_FOLDER = process.env.CONFIG_FOLDER || ".";

export interface AppConfig {
	server: {
		name: string;
		version: string;
		port: number;
		baseUrl: string;
		host: string;
	};

	database: {
		uri: string;
		name: string;
		poolSize: number;
	};

	matrix: {
		serverName: string;
		domain: string;
		keyRefreshInterval: number;
	};
}

@Injectable()
export class ConfigService {
	private config: AppConfig;

	constructor() {
		this.loadEnvFiles();
		this.config = this.initializeConfig();
	}

	getConfig(): AppConfig {
		return this.config;
	}

	getServerConfig(): AppConfig["server"] {
		return this.config.server;
	}

	getDatabaseConfig(): AppConfig["database"] {
		return this.config.database;
	}

	getMatrixConfig(): AppConfig["matrix"] {
		return this.config.matrix;
	}

	async getSigningKey() {
		return this.loadSigningKey();
	}

	private loadEnvFiles(): void {
		const env = process.env.NODE_ENV || "development";

		const envPath = path.resolve(process.cwd(), `.env.${env}`);
		if (fs.existsSync(envPath)) {
			dotenv.config({ path: envPath });
		}
	}

	async loadSigningKey() {
		const signingKeyPath = `${CONFIG_FOLDER}/${this.config.server.name}.signing.key`;
		return getKeyPair({ signingKeyPath });
	}

	private initializeConfig(): AppConfig {
		return {
			server: {
				name: process.env.SERVER_NAME || "rc1",
				version: process.env.SERVER_VERSION || "1.0",
				port: Number(process.env.SERVER_PORT) || 8080,
				baseUrl: process.env.SERVER_BASE_URL || "http://localhost:8080",
				host: process.env.SERVER_HOST || "0.0.0.0",
			},
			database: {
				uri: process.env.MONGODB_URI || "mongodb://localhost:27017/matrix",
				name: process.env.DATABASE_NAME || "matrix",
				poolSize: Number(process.env.DATABASE_POOL_SIZE) || 10,
			},
			matrix: {
				serverName: process.env.MATRIX_SERVER_NAME || "localhost",
				domain: process.env.MATRIX_DOMAIN || "localhost",
				keyRefreshInterval: Number(process.env.MATRIX_KEY_REFRESH_INTERVAL) || 60,
			},
		};
	}
}
