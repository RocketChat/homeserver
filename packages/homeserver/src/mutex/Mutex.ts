export class Mutex {
	private map: Map<string, boolean> = new Map();
	public async request(scope: string) {
		if (this.map.has(scope)) {
			return false;
		}

		const lock = new Lock(this, scope, () => this.map.delete(scope));
		this.map.set(scope, true);
		return lock;
	}
}

export class Lock {
	constructor(
		protected m: Mutex,
		public scope: string,
		private unlock: () => void,
	) {}
	public async release() {
		this.unlock();
	}
}
