"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import {
  User,
  Wallet,
  Bell,
  Shield,
  Monitor,
  Crown,
  LogOut,
  CheckCheck,
  Copy,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ConnectWalletButton } from "../../components/ui/ConnectWalletButton";
import { Input } from "../../components/ui/Input";
import { useLogout } from "../../hooks/useLogout";
import { GamificationSettings } from "../../components/gamification/GamificationSettings";
import { useThemeStore } from "../../stores/useThemeStore";
import {
  useWalletStore,
  selectWalletAddress,
  selectWalletNetwork,
} from "../../stores/useWalletStore";
import { useUserStore, selectUser } from "../../stores/useUserStore";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  useUpdateUserProfile,
} from "../../hooks/useApi";
import { COPY_FEEDBACK_RESET_MS } from "../../components/ui";
import { useLocaleSwitcher } from "../../hooks/useLocaleSwitcher";
import { LOCALES, LOCALE_LABELS } from "../../lib/locales";
// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationPrefs {
  loanApproved: boolean;
  repaymentDue: boolean;
  repaymentConfirmed: boolean;
  loanDefaulted: boolean;
  scoreChanged: boolean;
  email: boolean;
  sms: boolean;
  inApp: boolean;
  phone: string;
}

// ─── Section navigation ───────────────────────────────────────────────────────

const SECTIONS = [
  { id: "profile", icon: User },
  { id: "wallet", icon: Wallet },
  { id: "notifications", icon: Bell },
  { id: "security", icon: Shield },
  { id: "display", icon: Monitor },
  { id: "gamification", icon: Crown },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function settingsTabId(id: SectionId) {
  return `settings-tab-${id}`;
}

function settingsPanelId(id: SectionId) {
  return `settings-panel-${id}`;
}

// ─── Copy-to-clipboard helper ─────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const t = useTranslations("Settings.copy");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_RESET_MS);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
      title={t("title")}
      aria-label={copied ? t("copied") : t("title")}
    >
      {copied ? <CheckCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
        {description && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>
        )}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

// ─── Profile section ──────────────────────────────────────────────────────────

function ProfileSection() {
  const t = useTranslations("Settings");
  const user = useUserStore(selectUser);
  const updateProfile = useUpdateUserProfile();
  const [displayName, setDisplayName] = useState(user?.displayName ?? user?.id ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(false);
    updateProfile.mutate(
      { displayName, email: email.trim() || null },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.title")}</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t("profile.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
            <User className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {t("profile.picture")}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t("profile.pictureSoon")}
            </p>
          </div>
        </div>

        <Input
          label={t("profile.displayName")}
          placeholder={t("profile.displayNamePlaceholder")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <Input
          label={t("profile.email")}
          type="email"
          placeholder={t("profile.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          helperText={t("profile.emailHelper")}
        />

        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-2">
          <span className="text-red-600">*</span> {t("common.requiredField")}
        </p>

        <Button
          variant="primary"
          onClick={handleSave}
          disabled={updateProfile.isPending}
          aria-busy={updateProfile.isPending}
          className="w-full sm:w-auto"
        >
          {updateProfile.isPending
            ? t("common.saving")
            : saved
              ? t("common.saved")
              : t("profile.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Wallet section ───────────────────────────────────────────────────────────

function WalletSection() {
  const t = useTranslations("Settings.wallet");
  const address = useWalletStore(selectWalletAddress);
  const network = useWalletStore(selectWalletNetwork);
  const disconnect = useWalletStore((s) => s.disconnect);
  const { logout } = useLogout();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {address ? (
          <>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                {t("connectedAddress")}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono text-zinc-900 dark:text-zinc-50 break-all">
                  {address}
                </span>
                <CopyButton value={address} />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {t("network")}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {network?.name ?? t("unknownNetwork")}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  network?.isSupported
                    ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                    : "bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {network?.isSupported ? t("supported") : t("unsupported")}
              </span>
            </div>

            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => disconnect()}
                leftIcon={<LogOut className="h-4 w-4" />}
                className="text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-900/50 dark:hover:bg-amber-950/20"
              >
                {t("disconnect")}
              </Button>
              <Button
                variant="outline"
                onClick={() => logout()}
                leftIcon={<LogOut className="h-4 w-4" />}
                className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-950/20"
              >
                {t("signOut")}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <Wallet className="h-10 w-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("notConnected")}</p>
            <ConnectWalletButton className="mt-4 w-full sm:w-auto" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Notifications section ────────────────────────────────────────────────────

function NotificationsSection() {
  const t = useTranslations("Settings");
  const { data, isLoading, error } = useNotificationPreferences();
  const updateNotificationPreferences = useUpdateNotificationPreferences();
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    loanApproved: true,
    repaymentDue: true,
    repaymentConfirmed: true,
    loanDefaulted: true,
    scoreChanged: false,
    email: false,
    sms: false,
    inApp: true,
    phone: "",
  });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;

    // Sync server-fetched preferences into local editable form state once the
    // query resolves. This is the intended pattern here, not a render-loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs((current) => ({
      ...current,
      email: data.emailEnabled,
      sms: data.smsEnabled,
      phone: data.phone ?? "",
    }));
    // Reset save feedback when fresh server preferences replace the editable form state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveError(null);
    // Reset save confirmation when fresh server preferences replace the editable form state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(false);
  }, [data]);

  const toggle = (key: keyof NotificationPrefs) => setPrefs((p) => ({ ...p, [key]: !p[key] }));

  const perTypeOverrides = {
    loan_approved: prefs.loanApproved,
    repayment_due: prefs.repaymentDue,
    repayment_confirmed: prefs.repaymentConfirmed,
    loan_defaulted: prefs.loanDefaulted,
    score_changed: prefs.scoreChanged,
  };

  const handleSave = () => {
    setSaveError(null);
    setPhoneError(null);

    const phone = prefs.phone.trim();

    if (prefs.sms) {
      if (!phone) {
        setPhoneError(t("notifications.phoneRequired"));
        return;
      }

      // Basic international phone validation
      const phoneRegex = /^\+?[1-9]\d{7,14}$/;

      if (!phoneRegex.test(phone)) {
        setPhoneError(t("notifications.phoneInvalid"));
        return;
      }
    }

    updateNotificationPreferences.mutate(
      {
        emailEnabled: prefs.email,
        smsEnabled: prefs.sms,
        phone: phone || null,
        perTypeOverrides,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
        onError: (error) => {
          setSaveError(error.message);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("notifications.title")}</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {t("notifications.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 pb-2">
            {t("notifications.delivery")}
          </p>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <Toggle
              checked={prefs.inApp}
              onChange={() => toggle("inApp")}
              label={t("notifications.inApp")}
              description={t("notifications.inAppDescription")}
            />
            <Toggle
              checked={prefs.email}
              onChange={() => toggle("email")}
              label={t("notifications.email")}
              description={t("notifications.emailDescription")}
            />
            <Toggle
              checked={prefs.sms}
              onChange={() => {
                setPhoneError(null);
                toggle("sms");
              }}
              label={t("notifications.sms")}
              description={t("notifications.smsDescription")}
            />
          </div>
          <Input
            label={t("notifications.phone")}
            placeholder="+14155552671"
            value={prefs.phone}
            onChange={(e) => {
              setPhoneError(null);
              setPrefs((p) => ({ ...p, phone: e.target.value }));
            }}
            helperText={
              prefs.sms ? t("notifications.phoneRequired") : t("notifications.phoneOptional")
            }
          />
          {phoneError && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{phoneError}</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 pb-2 pt-4">
            {t("notifications.events")}
          </p>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <Toggle
              checked={prefs.loanApproved}
              onChange={() => toggle("loanApproved")}
              label={t("notifications.loanApproved")}
              description={t("notifications.loanApprovedDescription")}
            />
            <Toggle
              checked={prefs.repaymentDue}
              onChange={() => toggle("repaymentDue")}
              label={t("notifications.repaymentDue")}
              description={t("notifications.repaymentDueDescription")}
            />
            <Toggle
              checked={prefs.repaymentConfirmed}
              onChange={() => toggle("repaymentConfirmed")}
              label={t("notifications.repaymentConfirmed")}
              description={t("notifications.repaymentConfirmedDescription")}
            />
            <Toggle
              checked={prefs.loanDefaulted}
              onChange={() => toggle("loanDefaulted")}
              label={t("notifications.loanDefaulted")}
              description={t("notifications.loanDefaultedDescription")}
            />
            <Toggle
              checked={prefs.scoreChanged}
              onChange={() => toggle("scoreChanged")}
              label={t("notifications.scoreChanged")}
              description={t("notifications.scoreChangedDescription")}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{t("notifications.loadError")}</p>
        )}
        {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={updateNotificationPreferences.isPending || isLoading}
          className="w-full sm:w-auto"
        >
          {updateNotificationPreferences.isPending
            ? t("common.saving")
            : saved
              ? t("common.saved")
              : t("notifications.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Security section ─────────────────────────────────────────────────────────

function SecuritySection() {
  const t = useTranslations("Settings.security");
  const user = useUserStore(selectUser);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Session */}
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
            {t("activeSession")}
          </p>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">{t("started")}</span>
              <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                {user?.sessionStartedAt ? new Date(user.sessionStartedAt).toLocaleString() : "—"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">{t("kycStatus")}</span>
              <span
                className={`font-medium ${
                  user?.kycVerified
                    ? "text-green-600 dark:text-green-400"
                    : "text-yellow-600 dark:text-yellow-400"
                }`}
              >
                {user?.kycVerified ? t("verified") : t("notVerified")}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Display section ──────────────────────────────────────────────────────────

function DisplaySection() {
  const t = useTranslations("Settings");
  const { locale, switchLocale, isPending } = useLocaleSwitcher();

  const theme = useThemeStore((s) => s.theme);
  const hydrated = useThemeStore((s) => s.hydrated);
  const initializeTheme = useThemeStore((s) => s.initializeTheme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // Ensure client store is initialised
  useEffect(() => {
    if (!hydrated) initializeTheme();
  }, [hydrated, initializeTheme]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("display.title")}</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t("display.description")}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {t("display.theme")}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t("display.themeHelper")}
            </p>
          </div>
          <div className="inline-flex items-center gap-2">
            {(["light", "dark", "system"] as const).map((opt) => {
              const active = theme === opt;
              return (
                <button
                  key={opt}
                  onClick={() => setTheme(opt)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  {t(`display.themes.${opt}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label
            htmlFor="settings-language"
            className="text-sm font-medium text-zinc-900 dark:text-zinc-100 block mb-2"
          >
            {t("language")}
          </label>
          <select
            id="settings-language"
            value={locale}
            disabled={isPending}
            onChange={(e) => switchLocale(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {LOCALES.map((code) => (
              <option key={code} value={code} lang={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5">
            {t("display.languageHelper")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const t = useTranslations("Settings");
  const { logout } = useLogout();
  const [activeSection, setActiveSection] = useState<SectionId>("profile");
  const handleLogout = () => logout();

  const activateSection = (id: SectionId) => {
    setActiveSection(id);
    requestAnimationFrame(() => {
      document.getElementById(settingsTabId(id))?.focus();
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % SECTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + SECTIONS.length) % SECTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SECTIONS.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    activateSection(SECTIONS[nextIndex].id);
  };

  const renderSection = () => {
    switch (activeSection) {
      case "profile":
        return <ProfileSection />;
      case "wallet":
        return <WalletSection />;
      case "notifications":
        return <NotificationsSection />;
      case "security":
        return <SecuritySection />;
      case "display":
        return <DisplaySection />;
      case "gamification":
        return <GamificationSettings />;
    }
  };

  return (
    <main className="space-y-8 min-h-screen p-8 lg:p-12 max-w-5xl mx-auto">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
            {t("eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("description")}</p>
        </div>
        <Button
          variant="danger"
          onClick={handleLogout}
          leftIcon={<LogOut className="h-4 w-4" />}
          className="sm:mt-1"
        >
          {t("logout")}
        </Button>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Side nav */}
        <nav aria-label={t("sectionsLabel")} className="lg:w-52 flex-shrink-0">
          <ul
            role="tablist"
            aria-orientation="vertical"
            className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0"
          >
            {SECTIONS.map(({ id, icon: Icon }, index) => {
              const isActive = activeSection === id;

              return (
                <li key={id} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    id={settingsTabId(id)}
                    aria-selected={isActive}
                    aria-controls={settingsPanelId(id)}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => activateSection(id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium w-full transition-colors whitespace-nowrap ${
                      isActive
                        ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
                        : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    {t(`sections.${id}`)}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content */}
        <div
          role="tabpanel"
          id={settingsPanelId(activeSection)}
          aria-labelledby={settingsTabId(activeSection)}
          tabIndex={0}
          className="flex-1 min-w-0"
        >
          {renderSection()}
        </div>
      </div>
    </main>
  );
}
