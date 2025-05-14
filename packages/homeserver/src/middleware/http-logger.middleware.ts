import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, ip, headers, body } = req;
    const userAgent = headers['user-agent'] || 'unknown';
    
    this.logger.log(
      `[Middleware] ${method} ${originalUrl} - IP: ${ip} - User-Agent: ${userAgent} - Body: ${JSON.stringify(body)}`
    );

    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      const statusCode = res.statusCode;
      
      this.logger.log(
        `[Middleware] ${method} ${originalUrl} - Status: ${statusCode} - Duration: ${duration}ms`
      );
    });

    next();
  }
} 