"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signTransaction } from "@stellar/freighter-api";
import { submitLoanTransaction } from "../../../hooks/useApi";
import { Button } from "../../../components/ui/Button";
import {
  TransactionStatusTracker,
  type TransactionStatusState,
} from "../../../components/ui/TransactionStatusTracker";
import {
  mapTransactionError,
  type TransactionErrorDetails,
} from "../../../utils/transactionErrors";
import {
  selectIsWalletConnected,
  selectWalletAddress,
  useWalletStore,
} from "../../../stores/useWalletStore";
import { useContractToast } from "../../../hooks/useContractToast";
import { TransactionPreviewModal } from "../../../components/transaction/TransactionPreviewModal";
import { useTransactionPreview } from "../../../hooks/useTransactionPreview";
import {
  buildAmountHelperText,
  getPrecisionError,
  sanitizeAmountInput,
  formatAmountOnBlur,
  getAssetDecimals,
} from "../../../utils/amount";

export default function RepayLoanPage() {
  const t = useTranslations("RepayLoan");
  const params = useParams<{ loanId: string }>();
  const loanId = params?.loanId ?? "unknown";
  const router = useRouter();

  const walletAddress = useWalletStore(selectWalletAddress);
  const isWalletConnected = useWalletStore(selectIsWalletConnected);
  const toast = useContractToast();
  const txPreview = useTransactionPreview();

  const [amount, setAmount] = useState("250");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [trackerState, setTrackerState] = useState<TransactionStatusState>("idle");
  const [trackerTitle, setTrackerTitle] = useState(() => t("tracker.idleTitle"));
  const [trackerMessage, setTrackerMessage] = useState("");
  const [trackerGuidance, setTrackerGuidance] = useState<string | undefined>(undefined);
  const [trackerTxHash, setTrackerTxHash] = useState<string | null>(null);
  const [lastError, setLastError] = useState<TransactionErrorDetails | null>(null);

  const amountNumber = useMemo(() => Number(amount || "0"), [amount]);
  const decimals = getAssetDecimals("USDC");
  const precisionError = getPrecisionError(amount, "USDC");
  const helperText = buildAmountHelperText(amount, "USDC", decimals);

  const cancelFlow = () => {
    setTrackerState("cancelled");
    setTrackerTitle(t("tracker.cancelledTitle"));
    setTrackerMessage(t("tracker.cancelledMessage"));
    setTrackerGuidance(t("tracker.cancelledGuidance"));
    setIsSubmitting(false);
  };

  const handleRepayClick = async (event: FormEvent) => {
    event.preventDefault();
    if (!isWalletConnected || !walletAddress) {
      toast.error(t("toast.walletTitle"), t("toast.walletMessage"));
      return;
    }
    if (!amount || Number.isNaN(amountNumber) || amountNumber <= 0) {
      toast.error(t("toast.amountTitle"), t("toast.amountMessage"));
      return;
    }
    if (precisionError) {
      toast.error(t("toast.precisionTitle"), precisionError);
      return;
    }

    try {
      setIsSubmitting(true);

      const contractId = process.env.NEXT_PUBLIC_LOAN_MANAGER_CONTRACT_ID;
      if (!contractId) {
        throw new Error("Contract configuration missing");
      }

      const { buildUnsignedRepaymentXdr } = await import("../../../utils/soroban");
      const xdr = await buildUnsignedRepaymentXdr({
        borrower: walletAddress,
        loanId,
        amount: amountNumber,
        contractId,
      });

      txPreview.show(
        {
          operations: [
            {
              type: t("preview.operation"),
              description: t("preview.description", { amount: amountNumber, id: loanId }),
              amount: amountNumber.toString(),
              token: "USDC", // Assuming USDC for now
            },
          ],
          balanceChanges: [
            {
              token: "USDC",
              change: `-${amountNumber}`,
              isPositive: false,
            },
          ],
          estimatedGasFee: "0.01",
          network: "Stellar Testnet",
          contractAddress: contractId,
        },
        async () => {
          await executeRepayment(xdr);
        },
      );
    } catch (error) {
      const mapped = mapTransactionError(error);
      setLastError(mapped);
      toast.error(mapped.title, mapped.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const executeRepayment = async (unsignedXdr: string) => {
    let toastId: string | number | null = null;
    try {
      setTrackerState("signing");
      setTrackerTitle(t("tracker.signingTitle"));
      setTrackerMessage(t("tracker.signingMessage"));

      const signResult = await signTransaction(unsignedXdr, {
        networkPassphrase: "Test SDF Network ; September 2015",
      });
      if (signResult.error) {
        throw new Error(
          typeof signResult.error === "string" ? signResult.error : "Failed to sign transaction",
        );
      }

      setTrackerState("submitting");
      setTrackerTitle(t("tracker.submittingTitle"));
      setTrackerMessage(t("tracker.submittingMessage"));
      toastId = toast.showPending(t("toast.pending"));

      const result = await submitLoanTransaction(signResult.signedTxXdr);

      if (result.status === "SUCCESS") {
        setTrackerTxHash(result.txHash);
        setTrackerState("success");
        setTrackerTitle(t("tracker.successTitle"));
        setTrackerMessage(t("tracker.successMessage"));

        toast.showSuccess(toastId!, {
          successMessage: t("toast.success"),
          txHash: result.txHash,
        });

        // Invalidate cache (simulated by a short delay before refresh)
        setTimeout(() => {
          router.refresh();
        }, 2000);
      } else {
        throw new Error("Transaction failed");
      }
    } catch (error) {
      const mapped = mapTransactionError(error);
      setLastError(mapped);
      setTrackerState(mapped.cancelledByUser ? "cancelled" : "error");
      setTrackerTitle(mapped.title);
      setTrackerMessage(mapped.message);

      if (toastId) {
        toast.showError(toastId, {
          errorMessage: mapped.title,
        });
      } else {
        toast.error(mapped.title, mapped.message);
      }
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          {t("title", { id: loanId })}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      </header>

      <form
        onSubmit={handleRepayClick}
        className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none"
      >
        <div>
          <label
            htmlFor="repayment-amount"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t("amountLabel")}
          </label>
          <input
            id="repayment-amount"
            type="text"
            inputMode="decimal"
            step={Math.pow(10, -decimals)}
            value={amount}
            onChange={(event) => setAmount(sanitizeAmountInput(event.target.value))}
            onBlur={(event) => {
              const formatted = formatAmountOnBlur(event.target.value, "USDC");
              if (formatted && formatted !== event.target.value) {
                setAmount(formatted);
              }
            }}
            className={`mt-2 w-full rounded-2xl border bg-zinc-50 px-4 py-3 text-zinc-900 outline-none transition focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 ${
              precisionError ? "border-red-500" : "border-zinc-200"
            }`}
          />
          <p
            className={`mt-2 text-xs ${
              precisionError ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {precisionError ?? helperText ?? t("decimalsHelper", { decimals })}
          </p>
        </div>

        <Button
          type="submit"
          className="w-full"
          isLoading={isSubmitting}
          disabled={!!precisionError}
        >
          {t("submit")}
        </Button>
      </form>

      <TransactionStatusTracker
        state={trackerState}
        title={trackerTitle}
        message={trackerMessage}
        guidance={trackerGuidance}
        txHash={trackerTxHash}
        onCancel={
          trackerState === "signing" || trackerState === "submitting" ? cancelFlow : undefined
        }
        disabled={isSubmitting}
      />

      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading}
        />
      )}
    </section>
  );
}
