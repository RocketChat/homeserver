export interface AppServiceConfigProvider {
	readonly serverName: string;
}

export const APPSERVICE_CONFIG_PROVIDER = Symbol('AppServiceConfigProvider');
