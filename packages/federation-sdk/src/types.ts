export type FederationModuleOptions = {
	serverName: string;
	signingKey: string; // base64 encoded private key
	signingKeyId?: string;
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
