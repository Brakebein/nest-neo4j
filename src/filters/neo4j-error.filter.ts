import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { Neo4jError } from 'neo4j-driver';

@Catch(Neo4jError)
export class Neo4jErrorFilter implements ExceptionFilter {
  catch(exception: Neo4jError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string[] = [];

    // Neo.ClientError.Schema.ConstraintValidationFailed
    // Node(54776) already exists with label `User` and property `email` = 'duplicate@email.com'
    if (exception.message.includes('already exists with')) {
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'Bad Request';

      const matches = exception.message.match(/`([a-z0-9]+)`/gi);
      message = [`${matches[1].replace(/`/g, '')} already taken`];
    }
    // Neo.ClientError.Schema.ConstraintValidationFailed
    // Node(54778) with label `Test` must have the property `mustExist`
    else if (exception.message.includes('must have the property')) {
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'Bad Request';

      const matches = exception.message.match(/`([a-z0-9]+)`/gi);
      message = [`${matches[1].replace(/`/g, '')} should not be empty`];
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
    });
  }
}
