import { z } from 'zod';

// Schema for GET /history/:userId
export const getRemittanceHistorySchema = z.object({
  params: z.object({
    userId: z.string().min(1, 'User ID is required').max(100, 'User ID is too long'),
  }),
});

// Schema for POST /simulate — userId is derived from the JWT, not the request body
export const simulatePaymentSchema = z.object({
  body: z.object({
    amount: z
      .number()
      .positive('Amount must be positive')
      .max(1000000, 'Amount exceeds maximum limit'),
  }),
});

// Schema for POST /simulate/transaction — pre-execution validation
export const simulateTransactionSchema = z.object({
  body: z.object({
    contractId: z.string().min(1, 'Contract ID is required'),
    function: z.string().min(1, 'Function name is required').max(100),
    args: z
      .array(
        z.object({
          type: z.enum([
            'address',
            'u32',
            'i32',
            'u64',
            'i64',
            'u128',
            'i128',
            'bool',
            'string',
            'symbol',
            'bytes',
            'bytesN',
            'option',
            'void',
          ]),
          value: z.unknown(),
        }),
      )
      .optional()
      .default([]),
    sourceAccount: z.string().min(1, 'Source account is required'),
  }),
});

// Export types for TypeScript
export type GetRemittanceHistoryInput = z.infer<typeof getRemittanceHistorySchema>;
export type SimulatePaymentInput = z.infer<typeof simulatePaymentSchema>;
export type SimulateTransactionInput = z.infer<typeof simulateTransactionSchema>;
