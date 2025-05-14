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