"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { TransactionPreviewModal } from "../transaction/TransactionPreviewModal";
import { useTransactionPreview } from "../../hooks/useTransactionPreview";
import { formatRemittanceSend } from "../../utils/transactionFormatter";
import { isValidStellarAddress } from "../../utils/stellar";
import { AlertCircle, Send, Loader } from "lucide-react";
import { useCreateRemittance } from "../../hooks/useApi";
import { truncateDecimals, getAssetPrecision } from "../../utils/precision";
import { toast } from "sonner";
import {
  buildAmountHelperText,
  getPrecisionError,
  parseAmount,
  sanitizeAmountInput,
  formatAmountOnBlur,
  getAssetDecimals,
} from "../../utils/amount";

interface RemittanceFormProps {
  onSuccess?: () => void;
}

export function RemittanceForm({ onSuccess }: RemittanceFormProps) {
  const t = useTranslations("RemittanceForm");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("USDC");
  const [memo, setMemo] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const txPreview = useTransactionPreview();
  const mutation = useCreateRemittance();
  const decimals = getAssetDecimals(token);
  const precisionError = getPrecisionError(amount, token);
  const helperText = buildAmountHelperText(amount, token, decimals);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!recipientAddress.trim()) {
      newErrors.recipientAddress = t("errors.recipientRequired");
    } else if (!isValidStellarAddress(recipientAddress)) {
      newErrors.recipientAddress = t("errors.recipientInvalid");
    }

    if (!amount) {
      newErrors.amount = t("errors.amountRequired");
    } else {
      const numAmount = parseAmount(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        newErrors.amount = t("errors.amountPositive");
      } else if (precisionError) {
        newErrors.amount = precisionError;
      }
    }

    if (memo && memo.length > 28) {
      newErrors.memo = t("errors.memoTooLong");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddressChange = (value: string) => {
    setRecipientAddress(value.trim());
    if (errors.recipientAddress) {
      setErrors({ ...errors, recipientAddress: "" });
    }
  };

  const handleAmountChange = (value: string) => {
    setAmount(sanitizeAmountInput(value));
    if (errors.amount) {
      setErrors({ ...errors, amount: "" });
    }
  };

  const handleAmountBlur = (value: string) => {
    const formatted = formatAmountOnBlur(value, token);
    if (formatted && formatted !== value) {
      setAmount(formatted);
    }
  };

  const handleMemoChange = (value: string) => {
    setMemo(value);
    if (errors.memo) {
      setErrors({ ...errors, memo: "" });
    }
  };

  const handleReviewTransaction = async () => {
    if (!validateForm()) {
      toast.error(t("toast.validationTitle"), {
        description: t("toast.validationDescription"),
      });
      return;
    }

    const numAmount = parseAmount(amount);

    const previewData = formatRemittanceSend({
      amount: numAmount,
      recipient: recipientAddress,
      token,
    });

    txPreview.show(previewData, async () => {
      await handleSubmitRemittance(numAmount);
    });
  };

  const handleSubmitRemittance = async (numAmount: number) => {
    try {
      await mutation.mutateAsync({
        amount: numAmount,
        fromCurrency: token,
        toCurrency: token,
        recipientAddress,
        memo: memo || undefined,
      });

      toast.success(t("toast.successTitle"), {
        description: t("toast.successDescription"),
      });

      // Reset form
      setRecipientAddress("");
      setAmount("");
      setMemo("");
      setErrors({});

      onSuccess?.();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t("toast.errorFallback");
      toast.error(t("toast.errorTitle"), {
        description: errorMessage,
      });
    }
  };

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Input
              id="recipientAddress"
              label={t("recipient.label")}
              placeholder={t("recipient.placeholder")}
              value={recipientAddress}
              onChange={(e) => handleAddressChange(e.target.value)}
              disabled={mutation.isPending}
              required
              error={errors.recipientAddress || undefined}
              helperText={t("recipient.helper")}
            />

            {/* Token Selection */}
            <div className="space-y-2">
              <label
                htmlFor="token"
                className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50"
              >
                {t("token.label")} <span className="text-red-600">*</span>
              </label>
              <select
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={mutation.isPending}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg bg-white dark:bg-zinc-900 dark:border-zinc-700 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-600 dark:focus:ring-indigo-400"
              >
                <option value="USDC">USDC</option>
                <option value="EURC">EURC</option>
                <option value="PHP">PHP</option>
              </select>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("token.helper")}</p>
            </div>

            <Input
              id="amount"
              label={t("amount.label")}
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              step={Math.pow(10, -decimals)}
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              onBlur={(e) => handleAmountBlur(e.target.value)}
              disabled={mutation.isPending}
              required
              min="0"
              error={errors.amount || undefined}
              helperText={helperText ?? t("amount.decimalsHelper", { decimals })}
              className={errors.amount ? "border-red-600" : ""}
            />

            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-2">
              <span className="text-red-600">*</span> {t("requiredField")}
            </p>

            {/* Memo (Optional) */}
            <div className="space-y-2">
              <label
                htmlFor="memo"
                className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50"
              >
                {t("memo.label")} <span className="text-zinc-400">{t("memo.optional")}</span>
              </label>
              <textarea
                id="memo"
                placeholder={t("memo.placeholder")}
                value={memo}
                onChange={(e) => handleMemoChange(e.target.value)}
                disabled={mutation.isPending}
                maxLength={28}
                rows={2}
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-600 dark:focus:ring-indigo-400 resize-none dark:border-zinc-700 ${
                  errors.memo ? "border-red-600" : "border-zinc-300"
                }`}
              />
              {errors.memo && (
                <div className="flex items-start gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{errors.memo}</span>
                </div>
              )}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("memo.counter", { count: memo.length })}
              </p>
            </div>

            {/* Warning Box */}
            <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <p className="font-semibold mb-1">{t("warning.title")}</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>{t("warning.checkAddress")}</li>
                    <li>{t("warning.reviewPreview")}</li>
                    <li>{t("warning.checkBalance")}</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleReviewTransaction}
                disabled={mutation.isPending || !recipientAddress || !amount || !!precisionError}
                className="flex-1"
              >
                {mutation.isPending ? (
                  <div role="status" className="flex items-center">
                    <Loader className="h-4 w-4 mr-2 animate-spin" />
                    {t("processing")}
                  </div>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    {t("reviewAndSend")}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Information Card */}
        <Card className="bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800">
          <CardContent className="pt-6">
            <h3 className="font-semibold text-indigo-900 dark:text-indigo-300 mb-3">
              {t("about.title")}
            </h3>
            <ul className="space-y-2 text-sm text-indigo-800 dark:text-indigo-400">
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                <span>{t("about.creditScore")}</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                <span>{t("about.secured")}</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                <span>{t("about.fast")}</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <TransactionPreviewModal
        isOpen={txPreview.isOpen}
        onClose={txPreview.close}
        onConfirm={txPreview.confirm}
        data={txPreview.data || { operations: [], balanceChanges: [], network: "Stellar Testnet" }}
        isLoading={mutation.isPending}
      />
    </>
  );
}
