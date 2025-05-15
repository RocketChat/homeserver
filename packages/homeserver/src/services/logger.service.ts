import { Injectable, Scope } from '@nestjs/common';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  LOG = 2,
  DEBUG = 3,
  VERBOSE = 4
}

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService {
  private readonly context: string;
  private static logLevel: LogLevel = LogLevel.DEBUG; // Default log level

  constructor() {
    this.context = 'Application';
  }

  static setLogLevel(level: LogLevel): void {
    LoggerService.logLevel = level;
  }

  setContext(context: string) {
    return new LoggerService(context);
  }

  log(message: any) {
    if (LoggerService.logLevel >= LogLevel.LOG) {
      console.log(`[${new Date().toISOString()}] [INFO] [${this.context}] ${typeof message === 'object' ? JSON.stringify(message) : message}`);
    }
  }

  error(message: any, trace?: string) {
    if (LoggerService.logLevel >= LogLevel.ERROR) {
      if (message instanceof Error) {
        console.error(`[${new Date().toISOString()}] [ERROR] [${this.context}] ${message.stack}`);
      } else if (trace) {
        console.error(`[${new Date().toISOString()}] [ERROR] [${this.context}] ${message}\n${trace}`);
      } else {
        console.error(`[${new Date().toISOString()}] [ERROR] [${this.context}] ${typeof message === 'object' ? JSON.stringify(message) : message}`);
      }
    }
  }

  warn(message: any) {
    if (LoggerService.logLevel >= LogLevel.WARN) {
      console.warn(`[${new Date().toISOString()}] [WARN] [${this.context}] ${typeof message === 'object' ? JSON.stringify(message) : message}`);
    }
  }

  debug(message: any) {
    if (LoggerService.logLevel >= LogLevel.DEBUG) {
      console.debug(`[${new Date().toISOString()}] [DEBUG] [${this.context}] ${typeof message === 'object' ? JSON.stringify(message) : message}`);
    }
  }

  verbose(message: any) {
    if (LoggerService.logLevel >= LogLevel.VERBOSE) {
      console.debug(`[${new Date().toISOString()}] [VERBOSE] [${this.context}] ${typeof message === 'object' ? JSON.stringify(message) : message}`);
    }
  }
} 