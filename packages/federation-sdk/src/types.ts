export type FederationModuleOptions = {
	serverName: string;
	signingKey: string; // base64 encoded whole key "algorithm version base64-encoded-seed"
	timeout?: number;
	baseUrl?: string;
};

export type FederationModuleAsyncOptions = {
	useFactory: (
		...args: any[]
	) => Promise<FederationModuleOptions> | FederationModuleOptions;
	inject?: any[];
	imports?: any[];
};
