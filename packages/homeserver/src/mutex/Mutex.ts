export class Mutex {
	private map: Map<string, boolean> = new Map();

	public async request(scope: string, fail: true): Promise<Lock>;

	public async request(scope: string): Promise<Lock | false>;
	public async request(scope: string, fail?: true) {
		if (this.map.has(scope)) {
			if (fail) {
				throw new Error("Mutex already locked");
			}
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

	[Symbol.dispose]() {
		this.release();
	}
}
