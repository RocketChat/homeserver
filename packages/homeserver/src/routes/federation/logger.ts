export class Logger {
    private readonly service: string;

    constructor(service: string) {
        this.service = service;
    }

    info(message: string) {
        console.log(`[${new Date().toISOString()}] [INFO] [${this.service}] ${message}`);
    }

    error(message: string) {
        console.error(`[${new Date().toISOString()}] [ERROR] [${this.service}] ${message}`);
    }

    warn(message: string) {
        console.warn(`[${new Date().toISOString()}] [WARN] [${this.service}] ${message}`);
    }

    debug(message: string) {
        console.debug(`[${new Date().toISOString()}] [DEBUG] [${this.service}] ${message}`);
    }
}