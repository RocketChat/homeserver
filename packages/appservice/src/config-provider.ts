export interface AppServiceConfigProvider {
	readonly serverName: string;
	readonly xmpp?: { bridgeURL: string; hsToken: string; asToken: string };
}

export const APPSERVICE_CONFIG_PROVIDER = Symbol('AppServiceConfigProvider');
