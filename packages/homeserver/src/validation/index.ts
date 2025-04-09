import { 
  validateMatrixEvent, 
  createEventValidationPipeline,
  initializeValidationPipeline 
} from './EventValidationPipeline';

export { 
  validateMatrixEvent, 
  createEventValidationPipeline,
  initializeValidationPipeline 
};

export const initializeEventValidation = () => initializeValidationPipeline();