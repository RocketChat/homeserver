import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class HttpLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, body, headers, ip } = req;
    const userAgent = headers['user-agent'] || 'unknown';
    
    this.logger.log(
      `Request: ${method} ${url} - IP: ${ip} - User-Agent: ${userAgent} - Body: ${JSON.stringify(body)}`
    );

    const startTime = Date.now();
    
    return next.handle().pipe(
      tap(data => {
        const endTime = Date.now();
        const latency = endTime - startTime;
        const res = context.switchToHttp().getResponse();
        const { statusCode } = res;
        
        this.logger.log(
          `Response: ${method} ${url} - Status: ${statusCode} - Latency: ${latency}ms - Response: ${
            typeof data === 'object' ? JSON.stringify(data) : data
          }`
        );
      })
    );
  }
} 