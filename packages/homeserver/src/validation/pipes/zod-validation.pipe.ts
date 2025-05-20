import type { PipeTransform } from '@nestjs/common';
import { Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
    constructor(private schema: ZodSchema) { }

    transform(value: unknown) {
        const result = this.schema.safeParse(value);

        if (!result.success) {
            const formattedError = result.error.format();
            throw new BadRequestException({
                message: 'Validation failed',
                errors: formattedError,
            });
        }

        return result.data;
    }
}
