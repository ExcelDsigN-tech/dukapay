import React, { Component, type ComponentType, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import WalletError from "./wallet/error";
import SettingsError from "./settings/error";
import RemittancesError from "./remittances/error";
import ActivityError from "./activity/error";
import RequestLoanError from "./request-loan/error";
import RepayLoanError from "./repay/[loanId]/error";
import LoanDetailsError from "./loans/[loanId]/error";
import KingdomError from "./kingdom/error";
import LiquidationsError from "./liquidations/error";
import LendError from "./lend/error";
import AdminGovernanceError from "./admin/governance/error";
import AdminDisputesError from "./admin/disputes/error";
import AdminDisputeDetailError from "./admin/disputes/[id]/error";

type RouteError = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;

// Mimics the boundary Next.js wraps around a route segment with its error.tsx.
class SegmentBoundary extends Component<
  { fallback: RouteError; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    const Fallback = this.props.fallback;
    if (this.state.error) return <Fallback error={this.state.error} reset={this.reset} />;
    return this.props.children;
  }
}

const routes: Array<[string, RouteError, string]> = [
  ["/wallet", WalletError, "wallet page"],
  ["/settings", SettingsError, "settings page"],
  ["/remittances", RemittancesError, "remittances page"],
  ["/activity", ActivityError, "activity page"],
  ["/request-loan", RequestLoanError, "loan request page"],
  ["/repay/[loanId]", RepayLoanError, "loan repayment page"],
  ["/loans/[loanId]", LoanDetailsError, "loan details page"],
  ["/kingdom", KingdomError, "kingdom page"],
  ["/liquidations", LiquidationsError, "liquidations page"],
  ["/lend", LendError, "lending page"],
  ["/admin/governance", AdminGovernanceError, "governance admin page"],
  ["/admin/disputes", AdminDisputesError, "disputes admin page"],
  ["/admin/disputes/[id]", AdminDisputeDetailError, "dispute details page"],
];

describe("route error boundaries", () => {
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = jest.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it.each(routes)(
    "%s catches a render error and recovers on retry",
    (_route, RouteError, scope) => {
      let shouldThrow = true;
      function Page() {
        if (shouldThrow) throw new Error("page exploded");
        return <p>page content</p>;
      }

      render(
        <div>
          <nav>app shell</nav>
          <SegmentBoundary fallback={RouteError}>
            <Page />
          </SegmentBoundary>
        </div>,
      );

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`The ${scope} hit an unexpected runtime error`)),
      ).toBeInTheDocument();
      expect(screen.getByText("page exploded")).toBeInTheDocument();
      expect(screen.getByText("app shell")).toBeInTheDocument();

      shouldThrow = false;
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));

      expect(screen.getByText("page content")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );
});
