import { TextDecoder, TextEncoder } from "util";

if (typeof global.TextEncoder === "undefined") {
  (global as any).TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  (global as any).TextDecoder = TextDecoder;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  Account,
  Keypair,
  rpc,
  scValToNative,
  TransactionBuilder,
} = require("@stellar/stellar-sdk");
const { buildUnsignedRepaymentXdr } = require("./soroban");

describe("buildUnsignedRepaymentXdr", () => {
  const borrower = Keypair.random().publicKey();
  const contractId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(new Account(borrower, "100"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("encodes the full repayment amount into the XDR, not a tenth of it", async () => {
    const inputAmount = 1000;
    const loanId = "42";

    const xdrString = await buildUnsignedRepaymentXdr({
      borrower,
      loanId,
      amount: inputAmount,
      contractId,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, "Test SDF Network ; September 2015");

    const op = tx.operations[0];
    expect(op.type).toBe("invokeHostFunction");

    if (op.type === "invokeHostFunction") {
      const invokeArgs = op.func.invokeContract();
      const args = invokeArgs.args();
      const loanIdVal = scValToNative(args[1]);
      const amountVal = scValToNative(args[2]);

      expect(loanIdVal).toBe(BigInt(loanId));
      expect(amountVal).toBe(BigInt(inputAmount));
      expect(amountVal).not.toBe(BigInt(inputAmount / 10));
    }
  });
});
