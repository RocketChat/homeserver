import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
    constructor(private schema: ZodSchema) { }

    transform(value: any, metadata: ArgumentMetadata) {
        if (metadata.type !== 'body') {
            return value;
        }

        try {
            return this.schema.parse(value);
        } catch (error: any) {
            // Format the error for better readability
            const formattedErrors = error.format ? error.format() : error.errors;
            throw new BadRequestException({
                message: 'Validation failed',
                error: 'Bad Request',
                statusCode: 400,
                details: formattedErrors,
            });
        }
    }
}
