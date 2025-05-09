export class Logger {
    private readonly service: string;

    constructor(service: string) {
        this.service = service;
    }

    info(message: string | object | unknown) {
        console.log(`[${new Date().toISOString()}] [INFO] [${this.service}] ${typeof message === 'object' ? JSON.stringify(message) : message}`);
    }

    error(message: string | object | unknown) {
        if (message instanceof Error) {
            console.error(`[${new Date().toISOString()}] [ERROR] [${this.service}] ${message.stack}`);
        } else {
            console.error(`[${new Date().toISOString()}] [ERROR] [${this.service}] ${typeof message === 'object' ? JSON.stringify(message) : message}`);
        }
    }

    warn(message: string | object | unknown) {
        console.warn(`[${new Date().toISOString()}] [WARN] [${this.service}] ${typeof message === 'object' ? JSON.stringify(message) : message}`);
    }

    debug(message: string | object | unknown) {
        console.debug(`[${new Date().toISOString()}] [DEBUG] [${this.service}] ${typeof message === 'object' ? JSON.stringify(message) : message}`);
    }
}