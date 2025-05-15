import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    
    const status = 
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    
    const message = 
      exception instanceof HttpException
        ? exception.message
        : exception?.message || 'Internal server error';

    const errorResponse = {
      data: null,
      status,
      success: false,
      error: {
        message,
        ...(process.env.NODE_ENV !== 'production' && { stack: exception.stack })
      },
      timestamp: Date.now()
    };

    response.status(status).json(errorResponse);
  }
} 