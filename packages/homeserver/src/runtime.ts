import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';

declare global {
	var Bun: any;
}

const isBun = typeof globalThis.Bun !== 'undefined';

export const runtime = {
	async fileExists(path: string): Promise<boolean> {
		if (isBun) {
			return Bun.file(path).exists();
		}
		try {
			await fsPromises.access(path);
			return true;
		} catch {
			return false;
		}
	},

	async readFile(path: string): Promise<string> {
		if (isBun) {
			return Bun.file(path).text();
		}
		return fsPromises.readFile(path, 'utf-8');
	},

	async writeFile(path: string, content: string): Promise<void> {
		if (isBun) {
			return Bun.write(path, content);
		}
		return fsPromises.writeFile(path, content, 'utf-8');
	},

	fileExistsSync(path: string): boolean {
		if (isBun) {
			throw new Error('Sync operations not supported in Bun runtime abstraction');
		}
		return fs.existsSync(path);
	},

	readFileSync(path: string): string {
		if (isBun) {
			throw new Error('Sync operations not supported in Bun runtime abstraction');
		}
		return fs.readFileSync(path, 'utf-8');
	},

	writeFileSync(path: string, content: string): void {
		if (isBun) {
			throw new Error('Sync operations not supported in Bun runtime abstraction');
		}
		fs.writeFileSync(path, content, 'utf-8');
	},

	async unlink(path: string): Promise<void> {
		if (isBun && Bun.fs) {
			return Bun.fs.unlink(path);
		}
		return fsPromises.unlink(path);
	}
};