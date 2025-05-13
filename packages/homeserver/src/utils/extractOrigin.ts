export const extractOrigin = (matrixId: string): string => {
  return matrixId.split(':').pop() as string;
}; 