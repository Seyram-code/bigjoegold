"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Activity, ArrowDownToLine, ArrowLeftRight, BarChart3, Building2, ChevronDown, ChevronRight,
  CircleDollarSign, Coins, Eye, EyeOff, LayoutDashboard, LogOut, Menu, Package, Settings2,
  ShieldCheck, Users, WalletCards, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarketPriceIndicator, NotificationsButton } from "@/components/header-tools";
import { ThemeToggle } from "@/components/theme-toggle";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { workspaceNavigation, type NavigationItem } from "@/lib/workspace-navigation";

type Role = "OWNER" | "MANAGER" | "GOLD_RECEIVER" | "SALES_OFFICER" | "INVENTORY_OFFICER" | "TRADER" | "ACCOUNTANT" | "AUDITOR" | "VIEWER";
type Permissions = Record<"dashboard" | "customers" | "trades" | "inventory" | "payments" | "reports" | "board" | "staff" | "audit" | "settings", boolean>;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

export function WorkspaceShell({
  children,
  user,
  permissions,
}: {
  children: React.ReactNode;
  user: { id: string; name: string; email: string; phone: string | null; role: Role };
  permissions: Permissions;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [profileName, setProfileName] = useState(user.name);
  const [profilePhone, setProfilePhone] = useState(user.phone ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const profileRef = useRef<HTMLDivElement>(null);
  const [signOutError, setSignOutError] = useState("");
  const visibleNavigation = filterNavigation(workspaceNavigation, permissions);

  useEffect(() => {
    let lastActivityAt = Date.now();
    let timeout: number | undefined;
    let signingOut = false;

    const signOutAfterInactivity = async () => {
      if (signingOut) return;
      signingOut = true;
      const result = await authClient.signOut();
      if (result.error) {
        signingOut = false;
        setSignOutError(`Your session has been inactive for five minutes, but sign-out failed: ${result.error.message || "Please check your connection and sign out manually."}`);
        timeout = window.setTimeout(checkInactivity, 5000);
        return;
      }
      router.replace("/login");
      router.refresh();
    };

    const checkInactivity = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = undefined;
      const remaining = INACTIVITY_TIMEOUT_MS - (Date.now() - lastActivityAt);
      if (remaining <= 0) {
        void signOutAfterInactivity();
        return;
      }
      timeout = window.setTimeout(checkInactivity, remaining);
    };

    const recordActivity = () => {
      if (signingOut) return;
      lastActivityAt = Date.now();
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = window.setTimeout(checkInactivity, INACTIVITY_TIMEOUT_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") checkInactivity();
    };

    const activityEvents: (keyof WindowEventMap)[] = ["keydown", "pointerdown", "touchstart", "wheel", "scroll"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));
    document.addEventListener("visibilitychange", handleVisibilityChange);
    timeout = window.setTimeout(checkInactivity, INACTIVITY_TIMEOUT_MS);

    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router, user.id]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

  async function signOut() {
    const result = await authClient.signOut();
    if (result.error) {
      setSignOutError(result.error.message || "Unable to sign out. Please try again.");
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileSaving(true);
    setProfileError("");
    setProfileNotice("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName, phone: profilePhone }),
      });
      const body = await response.json() as { error?: string; name?: string; phone?: string | null };
      if (!response.ok) throw new Error(body.error || "Unable to update your profile");
      setProfileName(body.name ?? profileName);
      setProfilePhone(body.phone ?? "");
      setProfileNotice("Profile updated.");
      router.refresh();
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : "Unable to update your profile");
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError("");
    setProfileNotice("");
    if (newPassword.length < 12) {
      setProfileError("Choose a password with at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setProfileError("The new password and confirmation do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) throw new Error(result.error.message || "Unable to change your password");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setProfileNotice("Password changed. Other active sessions have been signed out.");
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : "Unable to change your password");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa]">
      <AlertDialog open={Boolean(signOutError)} title="Sign-out error" description={signOutError} onConfirm={() => setSignOutError("")} />
      <aside aria-label="Main navigation" className="print-hide peer/sidebar group/sidebar fixed inset-y-0 left-0 z-40 hidden w-14 flex-col overflow-hidden border-r border-white/[.06] bg-[#0d1825] pt-16 shadow-[8px_0_24px_rgba(13,24,37,.12)] transition-[width] duration-200 ease-out hover:w-[230px] lg:flex">
        <nav className="scrollbar-hide flex-1 space-y-1 overflow-x-hidden overflow-y-auto px-1.5 py-4">
          <NavigationLinks items={visibleNavigation} pathname={pathname} />
        </nav>
        <div className="border-t border-white/[.07] p-2 group-hover/sidebar:p-4">
          <div className="mb-3 flex items-center justify-center gap-3 overflow-hidden rounded-lg bg-white/[.045] p-1.5 group-hover/sidebar:justify-start group-hover/sidebar:p-3">
            <div title={user.name} className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#d7b76f]/25 bg-[#d7b76f]/10 text-xs font-bold text-[#e2c47e]">{user.name.slice(0, 2).toUpperCase()}</div>
            <div className="min-w-0 opacity-0 group-hover/sidebar:opacity-100">
              <p className="truncate text-xs font-semibold text-white">{user.name}</p>
              <p className="mt-0.5 truncate text-[10px] text-[#91a0b0]">{formatRole(user.role)}</p>
            </div>
            <Settings2 className="ml-auto hidden shrink-0 text-[#708092] group-hover/sidebar:block" size={15} />
          </div>
          <button onClick={signOut} title="Sign out" aria-label="Sign out" className="flex h-9 w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-3 text-xs font-medium text-[#a1adba] transition hover:bg-rose-500/10 hover:text-rose-300 group-hover/sidebar:justify-start">
            <LogOut size={15} className="shrink-0" /><span className="whitespace-nowrap opacity-0 group-hover/sidebar:opacity-100">Sign out</span>
          </button>
          <p className="mt-4 hidden whitespace-nowrap px-2 text-[9px] text-[#667687] group-hover/sidebar:block">BIG JOE GOLD · LOCAL DESK</p>
        </div>
      </aside>

      <div className="workspace-content transition-[margin] duration-200 ease-out lg:ml-14 peer-hover/sidebar:lg:ml-[230px]">
        <header className="print-hide sticky top-0 z-30 flex h-16 w-full items-center gap-2 border-b border-white/[.07] bg-[#0d1825] px-2 sm:px-3">
          <div className="w-[190px] shrink-0 sm:w-[210px] lg:w-[230px]"><Brand inverse /></div>
          <button className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[#d5dde6] transition hover:bg-white/[.08]" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div role="note" aria-label="About Big Joe Gold" className="big-joe-gold-crawler hidden min-w-0 flex-1 overflow-hidden md:block">
            <div className="big-joe-gold-crawler-track">
              <span>Big Joe Gold is a Ghana-based gold trading business, managing gold purchases, sales, inventory, and customer payments.</span>
              <span aria-hidden="true">Big Joe Gold is a Ghana-based gold trading business, managing gold purchases, sales, inventory, and customer payments.</span>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <ThemeToggle className="hidden sm:flex" />
            <MarketPriceIndicator />
            <NotificationsButton />
            <div ref={profileRef} className="relative">
              <button aria-label="Open user profile" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-white/[.07]">
                <div className="flex size-8 items-center justify-center rounded-full border border-[#d7b76f] bg-[#bc8c36] text-[10px] font-bold text-[#18212c]">{user.name.slice(0, 2).toUpperCase()}</div>
                <span className="hidden min-w-0 text-left sm:block"><span className="block max-w-24 truncate text-[10px] font-semibold text-white">{user.name}</span><span className="block max-w-24 truncate text-[9px] text-[#aeb9c6]">{formatRole(user.role)}</span></span>
                <ChevronDown size={13} className="hidden text-[#aeb9c6] sm:block" />
              </button>
              {profileOpen && <div className="absolute right-0 top-11 z-50 w-60 rounded-xl border border-[#e8ebef] bg-white p-3 shadow-[0_16px_40px_rgba(23,33,47,.14)]">
                <p className="truncate text-xs font-semibold text-[#17212f]">{user.name}</p>
                <p className="mt-1 truncate text-[11px] text-[#78818d]">{user.email}</p>
                <p className="mb-2 mt-1 text-[10px] text-[#9aa2ac]">{formatRole(user.role)} access</p>
                <button onClick={() => { setProfileOpen(false); setProfileSettingsOpen(true); setProfileError(""); setProfileNotice(""); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-[#354252] transition hover:bg-[#f5f6f7]"><Users size={14} /> Profile settings</button>
                <button onClick={signOut} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-rose-700 transition hover:bg-rose-50"><LogOut size={14} /> Sign out</button>
              </div>}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-3 py-3 sm:px-4 sm:py-4">{children}</main>
      </div>

      {mobileOpen && <div className="fixed inset-0 z-40 bg-[#0c1521]/55 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)}>
        <div className="flex h-full w-[290px] flex-col bg-[#14202d] shadow-xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between pr-3"><Brand inverse /><button onClick={() => setMobileOpen(false)} className="rounded-md p-2 text-[#9ba8b6] hover:bg-white/5" aria-label="Close navigation"><X size={17} /></button></div>
          <nav className="scrollbar-hide flex-1 space-y-1 overflow-y-auto px-3 py-4">
            <NavigationLinks items={visibleNavigation} pathname={pathname} mobile onNavigate={() => setMobileOpen(false)} />
          </nav>
          <div className="border-t border-white/[.07] p-4"><p className="text-xs font-semibold text-white">{user.name}</p><p className="mt-1 text-[11px] text-[#91a0b0]">{formatRole(user.role)}</p><div className="mt-3 flex items-center justify-between"><button onClick={signOut} className="flex h-9 items-center gap-2 rounded-lg px-2 text-xs text-[#a1adba] hover:bg-rose-500/10 hover:text-rose-300"><LogOut size={15} /> Sign out</button><ThemeToggle /></div></div>
        </div>
      </div>}
      {profileSettingsOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0c1521]/55 p-4 backdrop-blur-[2px]" onClick={() => setProfileSettingsOpen(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby="profile-settings-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e8ebef] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,.24)] sm:p-6" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div><h2 id="profile-settings-title" className="text-lg font-semibold text-[#17212f]">Your profile</h2><p className="mt-1 text-xs text-[#76808c]">Update your contact details and account credentials.</p></div>
            <button type="button" onClick={() => setProfileSettingsOpen(false)} aria-label="Close profile settings" className="rounded-md p-1.5 text-[#89929e] hover:bg-[#f1f3f5]"><X size={17} /></button>
          </div>
          {profileError && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{profileError}</p>}
          {profileNotice && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{profileNotice}</p>}
          <form onSubmit={saveProfile} className="mt-5 space-y-3">
            <label className="block text-xs font-semibold text-[#465362]">Name<input required minLength={2} maxLength={100} value={profileName} onChange={(event) => setProfileName(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[#dfe4e9] px-3 text-sm font-normal text-[#263241] outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" /></label>
            <label className="block text-xs font-semibold text-[#465362]">Phone number<input type="tel" minLength={6} maxLength={40} value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[#dfe4e9] px-3 text-sm font-normal text-[#263241] outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" /></label>
            <div className="flex justify-end"><button type="submit" disabled={profileSaving} className="rounded-lg bg-[#17212f] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#243347] disabled:opacity-60">{profileSaving ? "Saving…" : "Save profile"}</button></div>
          </form>
          {user.role === "OWNER" ? <form onSubmit={changePassword} className="mt-5 space-y-3 border-t border-[#edf0f3] pt-5">
            <div><h3 className="text-sm font-semibold text-[#253243]">Change password</h3><p className="mt-1 text-[11px] leading-5 text-[#76808c]">Use your current password to set a new one. Passwords must be at least 12 characters.</p></div>
            <label className="block text-xs font-semibold text-[#465362]">Current password<span className="relative mt-1.5 block"><input type={showCurrentPassword ? "text" : "password"} autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="h-10 w-full rounded-lg border border-[#dfe4e9] px-3 pr-11 text-sm font-normal text-[#263241] outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" /><button type="button" onClick={() => setShowCurrentPassword((visible) => !visible)} aria-label={showCurrentPassword ? "Hide current password" : "Show current password"} aria-pressed={showCurrentPassword} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#89929e] hover:bg-[#f1f3f5] hover:text-[#344151]">{showCurrentPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
            <label className="block text-xs font-semibold text-[#465362]">New password<span className="relative mt-1.5 block"><input type={showNewPassword ? "text" : "password"} autoComplete="new-password" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="h-10 w-full rounded-lg border border-[#dfe4e9] px-3 pr-11 text-sm font-normal text-[#263241] outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" /><button type="button" onClick={() => setShowNewPassword((visible) => !visible)} aria-label={showNewPassword ? "Hide new password" : "Show new password"} aria-pressed={showNewPassword} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#89929e] hover:bg-[#f1f3f5] hover:text-[#344151]">{showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
            <label className="block text-xs font-semibold text-[#465362]">Confirm new password<span className="relative mt-1.5 block"><input type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-10 w-full rounded-lg border border-[#dfe4e9] px-3 pr-11 text-sm font-normal text-[#263241] outline-none focus:border-[#bc8c36] focus:ring-2 focus:ring-[#bc8c36]/15" /><button type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={showConfirmPassword} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#89929e] hover:bg-[#f1f3f5] hover:text-[#344151]">{showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
            <div className="flex justify-end"><button type="submit" disabled={passwordSaving} className="rounded-lg border border-[#dfe4e9] px-4 py-2 text-xs font-semibold text-[#293442] transition hover:bg-[#f7f8fa] disabled:opacity-60">{passwordSaving ? "Changing…" : "Change password"}</button></div>
          </form> : <div className="mt-5 rounded-lg border border-[#e8ebef] bg-[#f7f8fa] p-3 text-[11px] leading-5 text-[#66717d]">Staff sign in with access codes, not passwords. Ask an owner to generate a replacement code from Staff management.</div>}
        </section>
      </div>}
    </div>
  );
}

function NavigationLinks({
  items,
  pathname,
  mobile = false,
  onNavigate,
}: {
  items: NavigationItem[];
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});

  return <div className="space-y-1">
    {items.map((item) => {
      const Icon = navigationIcon(item.label);
      const hasActiveChild = Boolean(item.children?.some((child) => pathnameMatches(pathname, child.href)));
      const active = pathnameMatches(pathname, item.href) || hasActiveChild;
      const expanded = expandedMenus[item.label] ?? hasActiveChild;
      const rowClass = mobile
        ? "flex h-10 items-center gap-3 rounded-lg px-3 text-[12px] font-medium transition"
        : "group/navitem relative flex h-9 items-center justify-center gap-3 overflow-hidden rounded-lg px-0 text-[11px] font-medium transition-all duration-200 group-hover/sidebar:justify-start group-hover/sidebar:px-3";
      const activeClass = active ? "bg-gradient-to-r from-[#ffdf72] to-[#f4b827] font-semibold text-[#18212c] shadow-[0_2px_8px_rgba(234,174,36,.18)]" : "text-[#c1cad4] hover:bg-white/[.055] hover:text-white";
      return <div key={item.href}>
        <div className="flex items-center gap-1">
          <Link href={item.href} title={!mobile ? item.label : undefined} onClick={onNavigate} aria-current={pathnameMatches(pathname, item.href) ? "page" : undefined} className={cn(rowClass, activeClass, "min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b76f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1825]")}>
            <Icon size={16} strokeWidth={1.8} className={active ? "shrink-0 text-[#18212c]" : "shrink-0 text-[#c1cad4] group-hover/navitem:text-white"} />
            <span className={cn("truncate", !mobile && "max-w-0 opacity-0 transition-[max-width,opacity] group-hover/sidebar:max-w-[160px] group-hover/sidebar:opacity-100")}>{item.label}</span>
          </Link>
          {item.children && <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${item.label}`} aria-expanded={expanded} onClick={() => setExpandedMenus((current) => ({ ...current, [item.label]: !expanded }))} className={cn("hidden size-8 shrink-0 items-center justify-center rounded-md text-[#8795a4] transition hover:bg-white/[.06] hover:text-white group-hover/sidebar:flex", active && "text-[#d7b76f]")}>
            <ChevronRight size={14} className={cn("transition-transform", expanded && "rotate-90")} />
          </button>}
        </div>
        {item.children && expanded && <div className={cn("invisible ml-5 mt-1 max-h-0 space-y-0.5 overflow-hidden border-l border-white/[.09] pl-2 opacity-0 group-hover/sidebar:visible group-hover/sidebar:max-h-96 group-hover/sidebar:opacity-100", mobile && "visible ml-4 max-h-none overflow-visible opacity-100")}>
          {item.children.map((child) => {
            const childActive = pathnameMatches(pathname, child.href);
            return <Link key={child.href} href={child.href} onClick={onNavigate} aria-current={childActive ? "page" : undefined} className={cn("flex min-h-8 items-center rounded-md px-2 text-[11px] leading-4 transition", childActive ? "bg-[#d1ad67]/[.1] font-semibold text-[#e7c77f]" : "text-[#93a0ae] hover:bg-white/[.045] hover:text-white")}>
              {child.label}
            </Link>;
          })}
        </div>}
      </div>;
    })}
  </div>;
}

function filterNavigation(items: NavigationItem[], permissions: Permissions): NavigationItem[] {
  return items.flatMap((item) => {
    if (item.permission && !permissions[item.permission]) return [];
    const children = item.children ? filterNavigation(item.children, permissions) : undefined;
    if (item.children && !children?.length) return [];
    return [{ ...item, ...(children ? { children } : {}) }];
  });
}

function pathnameMatches(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function navigationIcon(label: string) {
  const icons = {
    Dashboard: LayoutDashboard,
    Customers: Users,
    "Receive Stock": ArrowDownToLine,
    Sales: ArrowLeftRight,
    "Add Stock": Package,
    Inventory: Package,
    Transactions: WalletCards,
    "Gold Price": Coins,
    "Manual Bank & MOMO": Coins,
    "Manso Branch": Building2,
    Finance: CircleDollarSign,
    Reports: BarChart3,
    "Staff Management": ShieldCheck,
    "Audit Logs": Activity,
    Settings: Settings2,
  };
  return icons[label as keyof typeof icons] ?? LayoutDashboard;
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={cn("flex h-16 items-center gap-2.5 px-2", inverse ? "text-white" : "text-[#17212f]")}>
    <svg className="size-10 shrink-0 text-[#f4c744]" viewBox="0 0 48 54" fill="none" aria-hidden="true">
      <path d="M24 2 44 13.5v27L24 52 4 40.5v-27L24 2Z" stroke="currentColor" strokeWidth="4" />
      <path d="m24 13 10 6v12l-10 6-10-6V19l10-6Z" stroke="currentColor" strokeWidth="2.5" />
      <path d="M20 27h8m-4-4v8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
    <div className="min-w-0"><p className="truncate text-[14px] font-extrabold tracking-wide">BIG JOE <span className="text-[#f4c744]">GOLD</span></p><p className="mt-0.5 truncate text-[8px] font-medium uppercase tracking-[.11em] text-[#bdc6d0]">Gold trading &amp; investment</p></div>
  </Link>;
}

function formatRole(role: Role) {
  return role.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
