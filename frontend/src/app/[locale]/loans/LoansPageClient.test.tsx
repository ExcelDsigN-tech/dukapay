import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoansPageClient } from "./LoansPageClient";

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

jest.mock("../../hooks/useApi", () => ({
  useBorrowerLoansPage: () => ({
    data: { items: [], pageInfo: { hasNext: false, nextCursor: null } },
    isLoading: false,
    isError: false,
  }),
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: (selector: (state: { address: string | null }) => unknown) =>
    selector({ address: null }),
  selectWalletAddress: (state: { address: string | null }) => state.address,
}));

describe("LoansPageClient tabs", () => {
  it("exposes the tablist, selected tab, and labelled panel", () => {
    render(<LoansPageClient />);

    const tablist = screen.getByRole("tablist");
    const allTab = screen.getByRole("tab", { name: "tabs.all" });
    const panel = screen.getByRole("tabpanel");

    expect(tablist).toContainElement(allTab);
    expect(allTab).toHaveAttribute("aria-selected", "true");
    expect(allTab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", allTab.id);
  });

  it("moves selection and focus with arrow keys", async () => {
    const user = userEvent.setup();
    render(<LoansPageClient />);

    const allTab = screen.getByRole("tab", { name: "tabs.all" });
    const activeTab = screen.getByRole("tab", { name: "tabs.active" });
    await user.click(allTab);
    fireEvent.keyDown(allTab, { key: "ArrowRight" });

    expect(activeTab).toHaveAttribute("aria-selected", "true");
    expect(activeTab).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(activeTab);
  });
});
