"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Wallet } from "lucide-react";
import { Button, type ButtonProps } from "@/app/components/ui/Button";
import { useWallet } from "@/app/components/providers/WalletProvider";
import { useContractToast } from "@/app/hooks/useContractToast";

export type ConnectWalletButtonProps = Omit<
  ButtonProps,
  "isLoading" | "leftIcon" | "onClick" | "children"
>;

/**
 * Shared "Connect Wallet" CTA.
 *
 * The connect action lives in `WalletProvider` — the only place that talks to
 * Freighter — so the resulting state flows back into `useWalletStore` and the
 * calling page re-renders. Surrounding copy stays with the page, but the
 * button's own accessible name is always `Connect Wallet`, which the E2E page
 * object in `frontend/e2e/utils/page-objects/WalletPage.ts` relies on.
 */
export function ConnectWalletButton({ className, ...props }: ConnectWalletButtonProps) {
  const t = useTranslations("WalletConnection");
  const { connectWallet } = useWallet();
  const toast = useContractToast();
  const [isConnecting, setIsConnecting] = useState(false);

  async function handleConnect() {
    setIsConnecting(true);
    try {
      await connectWallet();
      toast.info(t("successTitle"), t("successMessage"));
    } catch (error) {
      toast.error(t("errorTitle"), error instanceof Error ? error.message : t("errorMessage"));
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={handleConnect}
      isLoading={isConnecting}
      leftIcon={<Wallet className="h-4 w-4" aria-hidden="true" />}
      className={className}
      {...props}
    >
      {t("connect")}
    </Button>
  );
}
