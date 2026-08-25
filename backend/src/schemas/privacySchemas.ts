import { z } from 'zod';

// Schema for POST /privacy/dsar/access — request data access (DSAR)
export const dsarAccessSchema = z.object({
  body: z.object({
    publicKey: z.string().min(1, 'Wallet public key is required'),
    reason: z
      .string()
      .min(10, 'Reason must be at least 10 characters')
      .max(1000, 'Reason is too long'),
  }),
});

// Schema for POST /privacy/dsar/delete — request account deletion
export const dsarDeleteSchema = z.object({
  body: z.object({
    publicKey: z.string().min(1, 'Wallet public key is required'),
    reason: z
      .string()
      .min(10, 'Reason must be at least 10 characters')
      .max(1000, 'Reason is too long'),
    confirmDeletion: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm deletion by setting confirmDeletion to true' }),
    }),
  }),
});

// Schema for POST /privacy/anonymize — anonymize user data for analytics
export const anonymizeSchema = z.object({
  body: z.object({
    publicKey: z.string().min(1, 'Wallet public key is required'),
    reason: z
      .string()
      .min(10, 'Reason must be at least 10 characters')
      .max(1000, 'Reason is too long'),
  }),
});

// Schema for GET /privacy/export/:publicKey — export user data
export const exportDataSchema = z.object({
  params: z.object({
    publicKey: z.string().min(1, 'Wallet public key is required'),
  }),
});

export type DsarAccessInput = z.infer<typeof dsarAccessSchema>;
export type DsarDeleteInput = z.infer<typeof dsarDeleteSchema>;
export type AnonymizeInput = z.infer<typeof anonymizeSchema>;
export type ExportDataInput = z.infer<typeof exportDataSchema>;
