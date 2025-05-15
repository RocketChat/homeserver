import { Injectable } from '@nestjs/common';
import { LoggerService } from './logger.service';

@Injectable()
export class ExampleService {
  private readonly logger: LoggerService;

  constructor(loggerService: LoggerService) {
    this.logger = loggerService.setContext('ExampleService');
  }

  async performOperation() {
    this.logger.debug('Starting operation');
    
    try {
      // Some operation logic
      this.logger.log('Operation completed successfully');
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error('Operation failed', error.stack);
      } else {
        this.logger.error('Operation failed', String(error));
      }
      throw error;
    }
  }

  handleWarning() {
    this.logger.warn('This is a warning message');
  }

  logVerbose() {
    this.logger.verbose('This is a verbose log message with extra details');
  }
} 