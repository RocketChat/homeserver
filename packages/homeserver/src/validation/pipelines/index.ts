export interface IPipeline<T> {
  validate(events: T, context: any): Promise<T>;
}

export class SequentialPipeline<T> implements IPipeline<T> {
  private steps: IPipeline<T>[] = [];
  
  constructor(steps: IPipeline<T>[] = []) {
    this.steps = steps;
  }
  
  add(validator: IPipeline<T>) {
    this.steps.push(validator);
    return this;
  }
  
  async validate(events: T, context: any): Promise<T> {
    let result: T = events;
    
    for await (const validator of this.steps) {
      try {
        result = await validator.validate(result, context);
      } catch (error: unknown) {
        console.error(error);
        throw error;
      }
    }

    return result;
  }
}

export { StagingAreaPipeline } from './stagingAreaPipeline';
export { SynchronousEventReceptionPipeline } from './synchronousEventReceptionPipeline';
export type { EventType, EventTypeArray } from './synchronousEventReceptionPipeline';

