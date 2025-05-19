import type { ValidationResult } from './ValidationResult';

/**
 * Base interface for all event validators
 */
export interface Validator<T = any, R = T> {
  validate(event: T, txnId: string, eventId: string): Promise<ValidationResult<R>>;
}

/**
 * Sequential validator that runs multiple validators in order
 */
export class Pipeline<T = any> implements Validator<T> {
  private steps: Validator<any, any>[] = [];

  constructor(steps: Validator<any, any>[] = []) {
    this.steps = steps;
  }

  add(validator: Validator<any, any>): this {
    this.steps.push(validator);
    return this;
  }

  async validate(event: T, txnId: string, eventId: string): Promise<ValidationResult> {
    let currentEvent = event;
    
    for (const validator of this.steps) {
      const result = await validator.validate(currentEvent, txnId, eventId);
      if (!result.success) {
        return result;
      }
      currentEvent = result.event;
    }
    
    return { success: true, event: currentEvent };
  }
}

/**
 * Runs multiple validators in parallel and combines their results
 */
export class ParallelValidation<T = any> implements Validator<T> {
  private validators: Validator<T, any>[] = [];
  
  constructor(validators: Validator<T, any>[] = []) {
    this.validators = validators;
  }

  add(validator: Validator<T, any>): this {
    this.validators.push(validator);
    return this;
  }

  async validate(event: T, txnId: string, eventId: string): Promise<ValidationResult<T>> {
    const results = await Promise.all(
      this.validators.map(validator => validator.validate(event, txnId, eventId))
    );
    
    const failure = results.find(result => !result.success);
    if (failure) {
      return failure;
    }
    
    return { success: true, event };
  }
}

/**
 * Utility to create a functional validator from a function
 */
export function createValidator<T = any, R = T>(
  fn: (this: any, event: T, txnId: string, eventId: string) => Promise<ValidationResult<R>>
): Validator<T, R> {
  const validator = { 
    validate: fn,
  };
  
  validator.validate = validator.validate.bind(validator);
  
  return validator;
} 