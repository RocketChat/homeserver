export interface ValidationResult<T = any> {
  success: boolean;
  event?: T;
  error?: {
    code: string;
    message: string;
  };
}

export function success<T>(event: T): ValidationResult<T> {
  return { success: true, event };
}

export function failure(code: string, message: string): ValidationResult {
  return { success: false, error: { code, message } };
} 

export interface Validator<T = any, R = T> {
  validate(event: T, txnId: string, eventId: string, context: any): Promise<ValidationResult<R>>;
}

export class SequentialPipeline<T = any> implements Validator<T> {
  private steps: Validator<any, any>[] = [];

  constructor(steps: Validator<any, any>[] = []) {
    this.steps = steps;
  }

  add(validator: Validator<any, any>): this {
    this.steps.push(validator);
    return this;
  }

  async validate(event: T, txnId: string, eventId: string, context: any): Promise<ValidationResult> {
    let currentEvent = event;
    
    for (const validator of this.steps) {
      const result = await validator.validate(currentEvent, txnId, eventId, context);
      if (!result.success) {
        return result;
      }
      currentEvent = result.event;
    }
    
    return { success: true, event: currentEvent };
  }
}

export class ParallelPipeline<T = any> implements Validator<T> {
  private validators: Validator<T, any>[] = [];
  
  constructor(validators: Validator<T, any>[] = []) {
    this.validators = validators;
  }

  add(validator: Validator<T, any>): this {
    this.validators.push(validator);
    return this;
  }

  async validate(event: T, txnId: string, eventId: string, context: any): Promise<ValidationResult<T>> {
    const results = await Promise.all(
      this.validators.map(validator => validator.validate(event, txnId, eventId, context))
    );
    
    const failure = results.find(result => !result.success);
    if (failure) {
      return failure;
    }
    
    return { success: true, event };
  }
}

export function createValidator<T = any, R = T>(
  fn: (this: any, event: T, txnId: string, eventId: string, context: any) => Promise<ValidationResult<R>>
): Validator<T, R> {
  const validator = { 
    validate: fn,
  };
  
  validator.validate = validator.validate.bind(validator);
  
  return validator;
} 