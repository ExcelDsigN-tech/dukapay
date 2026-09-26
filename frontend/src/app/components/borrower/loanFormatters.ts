/**
 * Shared formatting utilities for borrower loan components.
 *
 * Pass the locale from `useLocale()` to produce locale-aware output.
 * Falls back to "en-US" when locale is omitted (e.g. in server-side/test
 * contexts where a React hook cannot be called).
 */
import { formatCurrency as _formatCurrency, formatDate as _formatDate } from "../../utils/formatLocale";

export function formatCurrency(amount: number, locale = "en-US"): string {
  return _formatCurrency(amount, locale);
}

export function formatDate(dateString: string, locale = "en-US"): string {
  return _formatDate(dateString, locale);
}

export function getDaysUntilDeadline(deadline: string): number {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
