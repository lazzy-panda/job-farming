import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      response.status(status).json({
        statusCode: status,
        error:
          typeof res === 'string'
            ? res
            : (res as Record<string, unknown>).message ?? res,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    response.status(500).json({
      statusCode: 500,
      error: 'Internal Server Error',
      timestamp: new Date().toISOString(),
    });
  }
}

