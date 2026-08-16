import {
  mapTransactionError,
  ERROR_CODE_MESSAGES,
} from "./transactionErrors";

describe("mapTransactionError", () => {
  it("maps wallet rejection messages to wallet_rejected", () => {
    const result = mapTransactionError("User rejected the request");
    expect(result).toMatchObject({
      category: "wallet_rejected",
      title: "Transaction cancelled",
      cancelledByUser: true,
      retryable: true,
    });
  });

  it("maps cancellation variants to wallet_rejected", () => {
    expect(mapTransactionError("The signing request was cancelled.").category).toBe(
      "wallet_rejected",
    );
    expect(mapTransactionError("The signing request was canceled.").category).toBe(
      "wallet_rejected",
    );
  });

  it("maps network/timeout messages to network_timeout", () => {
    const result = mapTransactionError("Network request timed out");
    expect(result).toMatchObject({
      category: "network_timeout",
      retryable: true,
      cancelledByUser: false,
    });
  });

  it("maps failed to fetch to network_timeout", () => {
    expect(mapTransactionError("Failed to fetch").category).toBe("network_timeout");
  });

  it("maps insufficient balance messages to insufficient_balance", () => {
    const result = mapTransactionError("insufficient funds available");
    expect(result).toMatchObject({
      category: "insufficient_balance",
      retryable: false,
    });
  });

  it("maps score too low messages to score_too_low", () => {
    const result = mapTransactionError("Your score too low for this loan");
    expect(result.category).toBe("score_too_low");
  });

  it("maps simulation failures to simulation_failed", () => {
    const result = mapTransactionError("Host simulation returned an error");
    expect(result).toMatchObject({
      category: "simulation_failed",
      retryable: true,
    });
  });

  it("maps on-chain failures to onchain_failure", () => {
    const result = mapTransactionError("Transaction failed on-chain: revert");
    expect(result).toMatchObject({
      category: "onchain_failure",
      retryable: false,
    });
  });

  it("maps unknown errors to unknown with the raw message", () => {
    const result = mapTransactionError("Something entirely unexpected");
    expect(result).toMatchObject({
      category: "unknown",
      message: "Something entirely unexpected",
    });
  });

  it("handles Error instances", () => {
    const result = mapTransactionError(new Error("Failed to fetch"));
    expect(result.category).toBe("network_timeout");
  });

  it("handles non-string, non-Error values via JSON serialization", () => {
    const result = mapTransactionError({ code: "E_X" });
    expect(result.category).toBe("unknown");
    expect(result.message).toContain("E_X");
  });
});

describe("ERROR_CODE_MESSAGES", () => {
  it("provides a message for every known backend error code", () => {
    const expectedCodes = [
      "INVALID_AMOUNT",
      "INVALID_PUBLIC_KEY",
      "INVALID_SIGNATURE",
      "INVALID_CHALLENGE",
      "MISSING_FIELD",
      "VALIDATION_ERROR",
      "UNAUTHORIZED",
      "TOKEN_EXPIRED",
      "TOKEN_INVALID",
      "CHALLENGE_EXPIRED",
      "FORBIDDEN",
      "ACCESS_DENIED",
      "NOT_FOUND",
      "LOAN_NOT_FOUND",
      "USER_NOT_FOUND",
      "POOL_NOT_FOUND",
      "CONFLICT",
      "DUPLICATE_REQUEST",
      "RATE_LIMIT_EXCEEDED",
      "INTERNAL_ERROR",
      "DATABASE_ERROR",
      "EXTERNAL_SERVICE_ERROR",
      "BLOCKCHAIN_ERROR",
      "SERVICE_UNAVAILABLE",
      "BORROWER_MISMATCH",
      "INSUFFICIENT_BALANCE",
      "LOAN_ALREADY_REPAID",
      "LOAN_NOT_ACTIVE",
      "INVALID_LOAN_ID",
      "INVALID_TX_XDR",
    ];

    for (const code of expectedCodes) {
      expect(ERROR_CODE_MESSAGES[code]).toBeDefined();
    }
  });

  it("exposes human-readable messages", () => {
    expect(ERROR_CODE_MESSAGES.INVALID_AMOUNT).toMatch(/positive number/);
    expect(ERROR_CODE_MESSAGES.SERVICE_UNAVAILABLE).toMatch(/unavailable/i);
  });
});