import {
  formatDeposit,
  formatGenericTransaction,
  formatLoanRepayment,
  formatLoanRequest,
  formatRemittanceSend,
  formatWithdraw,
} from "./transactionFormatter";

const LONG_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLM";
const SHORT_ADDRESS = "GABC123";

describe("transaction formatter", () => {
  describe("formatLoanRequest", () => {
    it("builds a request-loan preview with masked borrower", () => {
      const result = formatLoanRequest({ amount: 250, borrower: LONG_ADDRESS });

      expect(result.network).toBe("Stellar Testnet");
      expect(result.estimatedGasFee).toBe("0.00001");
      expect(result.operations).toHaveLength(1);

      const op = result.operations[0];
      expect(op.type).toBe("Request Loan");
      expect(op.amount).toBe("250");
      expect(op.token).toBe("USDC");
      expect(op.description).toContain("250 USDC");
      expect(op.details?.["Borrower Address"]).toBe(
        `${LONG_ADDRESS.slice(0, 8)}...${LONG_ADDRESS.slice(-6)}`,
      );
    });

    it("exposes a positive USDC balance change", () => {
      const result = formatLoanRequest({ amount: 100, borrower: LONG_ADDRESS });

      expect(result.balanceChanges).toEqual([{ token: "USDC", change: "100", isPositive: true }]);
    });
  });

  describe("formatLoanRepayment", () => {
    it("builds a repayment preview with loan id", () => {
      const result = formatLoanRepayment({ loanId: 42, amount: 88.5 });

      const op = result.operations[0];
      expect(op.type).toBe("Repay Loan");
      expect(op.description).toBe("You are repaying 88.5 USDC for Loan #42");
      expect(op.details?.["Loan ID"]).toBe("42");
    });

    it("exposes a negative USDC balance change", () => {
      const result = formatLoanRepayment({ loanId: 1, amount: 10 });

      expect(result.balanceChanges).toEqual([{ token: "USDC", change: "-10", isPositive: false }]);
    });
  });

  describe("formatDeposit", () => {
    it("builds a deposit preview with LP token balance changes", () => {
      const result = formatDeposit({ amount: 500, token: "USDC" });

      expect(result.operations[0].type).toBe("Deposit");
      expect(result.operations[0].description).toContain("depositing 500 USDC");
      expect(result.balanceChanges).toEqual([
        { token: "USDC", change: "-500", isPositive: false },
        { token: "LP-USDC", change: "500", isPositive: true },
      ]);
    });
  });

  describe("formatWithdraw", () => {
    it("builds a withdraw preview with LP token balance changes", () => {
      const result = formatWithdraw({ amount: 250, token: "EURC" });

      expect(result.operations[0].type).toBe("Withdraw");
      expect(result.operations[0].description).toContain("withdrawing 250 EURC");
      expect(result.balanceChanges).toEqual([
        { token: "LP-EURC", change: "-250", isPositive: false },
        { token: "EURC", change: "250", isPositive: true },
      ]);
    });
  });

  describe("formatRemittanceSend", () => {
    it("builds a remittance preview with masked recipient", () => {
      const result = formatRemittanceSend({
        amount: 75,
        recipient: LONG_ADDRESS,
        token: "USDC",
      });

      const op = result.operations[0];
      expect(op.type).toBe("Send Remittance");
      expect(op.description).toContain("75 USDC");
      expect(op.details?.["Recipient"]).toBe(
        `${LONG_ADDRESS.slice(0, 8)}...${LONG_ADDRESS.slice(-6)}`,
      );
      expect(op.details?.["Credit Score Impact"]).toBe("+5 points");
    });

    it("exposes a negative balance change", () => {
      const result = formatRemittanceSend({
        amount: 30,
        recipient: LONG_ADDRESS,
        token: "USDC",
      });

      expect(result.balanceChanges).toEqual([{ token: "USDC", change: "-30", isPositive: false }]);
    });

    it("masks short recipient addresses without truncation overlap", () => {
      const result = formatRemittanceSend({
        amount: 10,
        recipient: SHORT_ADDRESS,
        token: "USDC",
      });

      const op = result.operations[0];
      expect(op.description).toContain(SHORT_ADDRESS);
      expect(op.details?.["Recipient"]).toBe(SHORT_ADDRESS);
      expect(op.description).not.toContain("...");
    });
  });

  describe("formatGenericTransaction", () => {
    it("passes through method, description, and args with no balance changes", () => {
      const result = formatGenericTransaction({
        contractMethod: "approve",
        description: "Approve token spend",
        args: { spender: "GXXXX", amount: 1000 },
      });

      expect(result.operations).toEqual([
        {
          type: "approve",
          description: "Approve token spend",
          details: { spender: "GXXXX", amount: 1000 },
        },
      ]);
      expect(result.balanceChanges).toEqual([]);
    });
  });
});
