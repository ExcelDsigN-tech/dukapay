import { z } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';

const MAX_SIMULATION_ARGS = 20;
const MAX_STRING_ARG_LENGTH = 1024;
const MAX_BYTES_ARG_LENGTH = 4096;
const CONTRACT_FUNCTION_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

const integerBounds = {
  u32: { min: 0n, max: 4_294_967_295n },
  i32: { min: -2_147_483_648n, max: 2_147_483_647n },
  u64: { min: 0n, max: 18_446_744_073_709_551_615n },
  i64: { min: -9_223_372_036_854_775_808n, max: 9_223_372_036_854_775_807n },
  u128: { min: 0n, max: 340_282_366_920_938_463_463_374_607_431_768_211_455n },
  i128: {
    min: -170_141_183_460_469_231_731_687_303_715_884_105_728n,
    max: 170_141_183_460_469_231_731_687_303_715_884_105_727n,
  },
} as const;

type IntegerType = keyof typeof integerBounds;

function parseIntegerArg(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function isIntegerInRange(type: IntegerType, value: unknown): boolean {
  const parsed = parseIntegerArg(value);
  if (parsed === null) return false;
  const bounds = integerBounds[type];
  return parsed >= bounds.min && parsed <= bounds.max;
}

function isBoundedString(value: unknown, maxLength = MAX_STRING_ARG_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isHexOrBase64Bytes(value: unknown): boolean {
  if (!isBoundedString(value, MAX_BYTES_ARG_LENGTH)) return false;
  return /^(?:0x)?[0-9a-fA-F]+$/.test(value) || /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function validateSimulationArg(arg: { type: string; value: unknown }, ctx: z.RefinementCtx): void {
  const path = ['value'];
  switch (arg.type) {
    case 'address':
      if (
        typeof arg.value !== 'string' ||
        (!StrKey.isValidEd25519PublicKey(arg.value) && !StrKey.isValidContract(arg.value))
      ) {
        ctx.addIssue({ code: 'custom', path, message: 'Address must be a valid Stellar address' });
      }
      return;
    case 'u32':
    case 'i32':
    case 'u64':
    case 'i64':
    case 'u128':
    case 'i128':
      if (!isIntegerInRange(arg.type, arg.value)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `${arg.type} value must be an integer within range`,
        });
      }
      return;
    case 'bool':
      if (typeof arg.value !== 'boolean') {
        ctx.addIssue({ code: 'custom', path, message: 'Boolean value must be true or false' });
      }
      return;
    case 'string':
    case 'symbol':
      if (!isBoundedString(arg.value)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `${arg.type} value must be a non-empty string under ${MAX_STRING_ARG_LENGTH} characters`,
        });
      }
      return;
    case 'bytes':
    case 'bytesN':
      if (!isHexOrBase64Bytes(arg.value)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `${arg.type} value must be bounded hex or base64 data`,
        });
      }
      return;
    case 'option':
      return;
    case 'void':
      if (arg.value !== undefined && arg.value !== null) {
        ctx.addIssue({ code: 'custom', path, message: 'void arguments must not include a value' });
      }
      return;
  }
}

const simulationArgSchema = z
  .object({
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
  })
  .strict()
  .superRefine(validateSimulationArg);

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
    contractId: z
      .string()
      .min(1, 'Contract ID is required')
      .refine(
        (value) => StrKey.isValidContract(value),
        'Contract ID must be a valid Stellar contract address',
      ),
    function: z
      .string()
      .min(1, 'Function name is required')
      .max(100)
      .regex(CONTRACT_FUNCTION_PATTERN, 'Function name must be a valid Soroban symbol'),
    args: z
      .array(simulationArgSchema)
      .max(MAX_SIMULATION_ARGS, `Cannot simulate more than ${MAX_SIMULATION_ARGS} arguments`)
      .optional()
      .default([]),
    sourceAccount: z
      .string()
      .min(1, 'Source account is required')
      .refine(
        (value) => StrKey.isValidEd25519PublicKey(value),
        'Source account must be a valid Stellar public key',
      ),
  }),
});

// Export types for TypeScript
export type GetRemittanceHistoryInput = z.infer<typeof getRemittanceHistorySchema>;
export type SimulatePaymentInput = z.infer<typeof simulatePaymentSchema>;
export type SimulateTransactionInput = z.infer<typeof simulateTransactionSchema>;
