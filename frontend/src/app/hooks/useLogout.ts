"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWalletStore } from "../stores/useWalletStore";
import { useUserStore } from "../stores/useUserStore";
import { useGamificationStore } from "../stores/useGamificationStore";
import { useQueryClient } from "@tanstack/react-query";
import { CSRF_HEADER_NAME, getCsrfToken } from "./useApi";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * useLogout
 *
 * Centralised logout handler that:
 *  1. Revokes the session server-side so the httpOnly auth cookies are cleared
 *  2. Clears the user store (removes the cached user profile)
 *  3. Disconnects the wallet store
 *  4. Resets the gamification store session state
 *  5. Clears all TanStack Query cache (so stale data doesn't leak between sessions)
 *  6. Redirects to the home / login page
 *
 * Pass `sessionExpired: true` to show an explanatory message before redirect.
 */
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const clearUser = useUserStore((s) => s.clearUser);
  const disconnectWallet = useWalletStore((s) => s.disconnect);
  const resetGamification = useGamificationStore((s) => s.resetGamification);

  const logout = useCallback(
    (options?: { sessionExpired?: boolean; redirectTo?: string }) => {
      // 0. Fire-and-forget: ask the backend to revoke the session and clear the
      //    httpOnly cookies. Never block the redirect on the network round-trip.
      void (async () => {
        try {
          const csrfToken = await getCsrfToken();
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (csrfToken) {
            headers[CSRF_HEADER_NAME] = csrfToken;
          }

          await fetch(`${API_URL}/auth/logout`, {
            method: "POST",
            credentials: "include",
            headers,
          });
        } catch {
          // Ignore network/CSRF failures — local state is cleared regardless.
        }
      })();

      // 1. Clear authentication state (cached user profile)
      clearUser();

      // 2. Disconnect wallet
      disconnectWallet();

      // 3. Reset gamification session counters
      resetGamification();

      // 4. Purge all cached server data so nothing leaks to the next session
      queryClient.clear();

      // 5. Navigate away
      const dest = options?.redirectTo ?? "/";
      if (options?.sessionExpired) {
        // Append flag so the landing page can show an expiry notice
        router.replace(`${dest}?reason=session_expired`);
      } else {
        router.replace(dest);
      }
    },
    [clearUser, disconnectWallet, resetGamification, queryClient, router],
  );

  return { logout };
}
