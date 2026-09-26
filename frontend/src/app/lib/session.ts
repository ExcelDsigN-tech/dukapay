"use client";

import { useUserStore } from "../stores/useUserStore";
import { useWalletStore } from "../stores/useWalletStore";

const USER_STORAGE_KEY = "dukapay-user";
const WALLET_STORAGE_KEY = "dukapay-wallet";

let logoutTriggered = false;

export class SessionExpiredError extends Error {
  constructor(message = "Session expired. Please sign in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export function clearSessionState() {
  useUserStore.getState().clearUser();
  useWalletStore.getState().disconnect();

  if (typeof window !== "undefined") {
    window.localStorage.removeItem(USER_STORAGE_KEY);
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
  }
}

export function logoutUser(reason: "manual" | "expired" = "manual") {
  clearSessionState();

  if (typeof window === "undefined" || logoutTriggered) {
    return;
  }

  logoutTriggered = true;
  const destination = reason === "expired" ? "/" : "/";
  window.setTimeout(() => {
    logoutTriggered = false;
  }, 0);
  window.location.assign(destination);
}
