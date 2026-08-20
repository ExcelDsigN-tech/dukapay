import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LandingPage } from "./LandingPage";

// Inline English catalog so the test asserts against real display text.
const EN: Record<string, string> = {
  "hero.eyebrow": "Borderless Finance",
  "hero.title": "Enter the Citadel",
  "hero.tagline": "Lend, borrow, and move value across borders on the Stellar Network.",
  "hero.cta": "Enter the Citadel",
  "hero.subCta": "Connect Wallet",
  "hero.telegram": "Join our Telegram",
  "hero.telegramUrl": "https://t.me/+eRqhka27TVo0NzM8",
  "hero.tvl": "$1.2B+",
  "hero.tvlLabel": "Total Value Locked",
  "hero.yield": "4.8%",
  "hero.yieldLabel": "Avg. Yield",
  "arsenal.eyebrow": "The DukaPay Arsenal",
  "arsenal.title": "Everything You Need to Grow",
  "arsenal.subtitle": "One platform. Three ways to put your capital to work.",
  "arsenal.lendTitle": "Lend to Earn",
  "arsenal.lendDesc": "Earn passive yield on deposited assets",
  "arsenal.questsTitle": "Gamified Quests",
  "arsenal.questsDesc": "Earn XP rewards for financial actions",
  "arsenal.vaultsTitle": "Secure Vaults",
  "arsenal.vaultsDesc": "Audited smart contract infrastructure",
  "verified.eyebrow": "Verified Growth",
  "verified.title": "Built to be trusted",
  "verified.audit": "Certified",
  "verified.auditDesc": "Audited by independent security firms",
  "verified.stellarTitle": "Stellar Network",
  "verified.stellarDesc": "Low fees, high-speed settlement, on-chain transparency",
  "gates.eyebrow": "The Gates are Opening",
  "gates.title": "Claim your place inside the Citadel",
  "gates.subtitle": "Connect your wallet to claim access.",
  "gates.cta": "Claim Access",
};

jest.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => EN[key] ?? key,
}));

describe("LandingPage", () => {
  const mockOnConnect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the hero with brand, tagline, and social-proof metrics", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.getByRole("heading", { name: "Enter the Citadel" })).toBeInTheDocument();
    expect(screen.getByText(EN["hero.tagline"])).toBeInTheDocument();
    expect(screen.getByText("$1.2B+")).toBeInTheDocument();
    expect(screen.getByText("Total Value Locked")).toBeInTheDocument();
    expect(screen.getByText("4.8%")).toBeInTheDocument();
    expect(screen.getByText("Avg. Yield")).toBeInTheDocument();
  });

  it("calls onConnect when the hero CTA is pressed", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    const cta = screen.getByRole("button", {
      name: EN["hero.cta"],
    });
    fireEvent.click(cta);

    expect(mockOnConnect).toHaveBeenCalledTimes(1);
  });

  it("renders the DukaPay Arsenal feature suite", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(
      screen.getByRole("heading", { name: "Everything You Need to Grow" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Lend to Earn")).toBeInTheDocument();
    expect(screen.getByText(EN["arsenal.lendDesc"])).toBeInTheDocument();
    expect(screen.getByText("Gamified Quests")).toBeInTheDocument();
    expect(screen.getByText("Secure Vaults")).toBeInTheDocument();
  });

  it("renders the Verified Growth trust section with Stellar callout", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.getByText("Verified Growth")).toBeInTheDocument();
    expect(screen.getByText("Stellar Network")).toBeInTheDocument();
    expect(screen.getByText(EN["verified.stellarDesc"])).toBeInTheDocument();
  });

  it("renders the closing Gates module and its Claim Access CTA calls onConnect", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.getByText("The Gates are Opening")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Claim your place inside the Citadel" }),
    ).toBeInTheDocument();

    const claim = screen.getByRole("button", { name: "Claim Access" });
    fireEvent.click(claim);

    expect(mockOnConnect).toHaveBeenCalledTimes(1);
  });

  it("provides accessible, keyboard-focusable CTAs", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    expect(screen.getByRole("button", { name: EN["hero.cta"] })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Claim Access" })).not.toBeDisabled();
  });

  it("renders a Telegram community link pointing to the group", () => {
    render(<LandingPage onConnect={mockOnConnect} />);

    const telegram = screen.getByRole("link", { name: EN["hero.telegram"] });
    expect(telegram).toHaveAttribute("href", EN["hero.telegramUrl"]);
    expect(telegram).toHaveAttribute("target", "_blank");
  });
});
