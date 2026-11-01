import * as React from "react";
import { buttonVariants } from "../ui/button";
import { StoreMark } from "./StoreMark";
import { TOPBAR_ICON_BUTTON } from "./topbar-styles";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  History,
  Settings,
  Store,
  LogOut,
  Menu,
  Search,
  UserRound,
} from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { ChangelogModal } from "./ChangelogModal";
import { NotificationBell } from "./NotificationBell";
import { OperationalStatusIcon } from "./OperationalStatusIcon";
import { CMS_VERSION } from "@/lib/version";
import { withInsightsPeriod } from "@/lib/insights-view";
import {
  ADMIN_ACCENT,
  getSearchableNavItems,
  getVisibleNavGroups,
  isAdminNavHrefActive,
  profileNavItem,
  statusNavItem,
  type AdminRole,
} from "./admin-navigation";

interface AdminShellProps {
  children: React.ReactNode;
  title: string;
  adminName: string;
  siteName?: string;
  siteLogo?: string;
  activeMenu: string;
  currentPath: string;
  siteUrl: string;
  adminRole: AdminRole;
  /** Shown in the account menu's header; the session's own username. */
  adminUsername?: string;
  mustChangePassword?: boolean;
  sidebarDefaultOpen?: boolean;
}

export function AdminShell({
  children,
  title,
  adminName,
  siteName,
  siteLogo,
  activeMenu,
  currentPath,
  siteUrl,
  adminRole,
  adminUsername = "",
  mustChangePassword = false,
  sidebarDefaultOpen = true,
}: AdminShellProps) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const roleLabel = adminRole === "owner" ? "Owner" : adminRole === "admin" ? "Admin" : adminRole === "customer_service" ? "CS" : "Advertiser";
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [expandedMobileMenus, setExpandedMobileMenus] = React.useState<Set<string>>(
    () => new Set([activeMenu]),
  );
  const [isDesktop, setIsDesktop] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(sidebarDefaultOpen);
  const [changelogOpen, setChangelogOpen] = React.useState(false);
  const groups = mustChangePassword ? [] : getVisibleNavGroups(adminRole);
  const searchItems = mustChangePassword ? [] : getSearchableNavItems(adminRole);
  const allItems = groups.flatMap((group) => group.items);
  const currentItem = [...allItems, profileNavItem, statusNavItem].find(
    (item) => item.id === activeMenu,
  );
  const mobilePrimaryIds = adminRole === "advertiser"
    ? ["dashboard", "products", "content", "ads"]
    : adminRole === "customer_service"
      ? ["dashboard", "orders", "shipping", "scoring"]
      : ["dashboard", "orders", "shipping", "products"];
  const mobilePrimary = (mustChangePassword ? ["profile"] : mobilePrimaryIds)
    .map((id) => [...allItems, profileNavItem].find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const menuIsActive = !mobilePrimary.some((item) => item.id === activeMenu);

  React.useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const wideMedia = window.matchMedia("(min-width: 1024px)");
    const updateViewport = () => setIsDesktop(media.matches);
    const updateSidebar = () => {
      const open = wideMedia.matches;
      setSidebarOpen(open);
      document.cookie = `sidebar_state=${open}; path=/; max-age=604800; samesite=lax`;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    updateViewport();
    updateSidebar();
    media.addEventListener("change", updateViewport);
    wideMedia.addEventListener("change", updateSidebar);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      media.removeEventListener("change", updateViewport);
      wideMedia.removeEventListener("change", updateSidebar);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const handleSearchOpenChange = (open: boolean) => {
    setSearchOpen(open);
    if (!open) setSearchQuery("");
  };

  const searchContent = (
    <>
      <div className="border-b border-slate-200 bg-slate-50/70 p-2">
        <div className="rounded-lg border border-slate-300 bg-white shadow-sm focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-200">
          <CommandInput
            value={searchQuery}
            onValueChange={setSearchQuery}
            aria-label="Cari halaman admin"
            placeholder="Ketik nama halaman atau tugas…"
            className="h-11"
            autoFocus
          />
        </div>
      </div>
      <CommandList className="max-h-none flex-1 overflow-y-auto px-2 py-2 sm:max-h-[min(55vh,28rem)]">
        <CommandEmpty className="px-4 py-14 text-center">
          <p className="font-semibold text-slate-900">Tidak ada halaman yang cocok</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Coba istilah seperti order, resi, gudang, CRM, Meta, atau payment.
          </p>
        </CommandEmpty>
        {Array.from(new Set(searchItems.map((item) => item.group))).map((groupName) => (
          <CommandGroup key={groupName} heading={groupName}>
            {searchItems.filter((item) => item.group === groupName).map((item) => (
              <CommandItem
                key={`${item.href}-${item.label}`}
                value={`${item.label} ${item.description} ${item.keywords} ${item.group}`}
                onSelect={() => {
                  handleSearchOpenChange(false);
                  window.location.assign(withInsightsPeriod(item.href, window.location.pathname, window.location.search));
                }}
                className="min-h-14 px-3 py-2.5"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                  <item.icon className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{item.label}</span>
                  <span className="block truncate text-xs text-slate-500">{item.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-slate-300" aria-hidden="true" />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="hidden items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-500 sm:flex">
        <span>↑↓ Pilih hasil</span>
        <span>Enter untuk buka · Esc untuk tutup</span>
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <SidebarProvider open={sidebarOpen}>
        <AppSidebar
          adminName={adminName}
          siteName={siteName}
          siteLogo={siteLogo}
          activeMenu={activeMenu}
          currentPath={currentPath}
          siteUrl={siteUrl}
          adminRole={adminRole}
          restricted={mustChangePassword}
          onOpenChangelog={() => setChangelogOpen(true)}
        />
        <SidebarInset className="min-w-0 bg-transparent">
          <header className="admin-topbar sticky top-0 z-30 flex h-[60px] shrink-0 items-center border-b border-slate-200/70 bg-white/90 px-3 backdrop-blur-xl md:h-16 md:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className={`${TOPBAR_ICON_BUTTON} md:hidden`}
                aria-label="Buka menu navigasi"
              >
                <Menu className="size-5" aria-hidden="true" />
              </button>
              <a href={mustChangePassword ? "/admin/profile" : "/admin/dashboard"} className="flex size-8 shrink-0 items-center justify-center md:hidden" aria-label={mustChangePassword ? "Keamanan akun" : `Dashboard ${adminName}`}>
                <StoreMark logo={siteLogo} name={siteName || adminName} className="size-8" />
              </a>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight text-slate-950">
                  {title}
                </h1>
                <p className="hidden truncate text-xs font-medium text-slate-500 lg:block">
                  {currentItem?.description ?? "Workspace operasional"}
                </p>
              </div>
            </div>

            {!mustChangePassword && <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="group mx-4 hidden h-9 w-full max-w-md flex-1 items-center gap-2.5 rounded-lg bg-slate-100/80 px-3 text-left text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 md:flex xl:mx-6"
            >
              <Search className="size-4 text-slate-400 transition-colors group-hover:text-slate-600" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Cari halaman atau tugas…</span>
              <kbd className="rounded bg-white px-1.5 py-0.5 font-sans text-xs font-medium text-slate-400 ring-1 ring-slate-200">
                ⌘K
              </kbd>
            </button>}

            <div className="flex flex-1 items-center justify-end gap-1">
              {!mustChangePassword && <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className={`${TOPBAR_ICON_BUTTON} md:hidden`}
                aria-label="Cari halaman admin"
              >
                <Search className="size-[18px]" aria-hidden="true" />
              </button>}
              {!mustChangePassword && <a href="/" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", className: "hidden h-9 gap-1 font-normal text-slate-500 xl:inline-flex" })}>
                Lihat storefront <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>}
              {!mustChangePassword && <span className="mx-1 hidden h-5 w-px bg-slate-200 xl:block" aria-hidden="true" />}
              {/* A first-run session may only rotate its password. Advertiser
                  may not read notifications; asking logged a 403 on every page
                  (audit 2026-10-31 L1). */}
              {!mustChangePassword && adminRole !== "advertiser" && <NotificationBell />}
              {/* Owner and admin only: the other roles send no status request (A39). */}
              {!mustChangePassword && (adminRole === "owner" || adminRole === "admin") && (
                <OperationalStatusIcon active={activeMenu === "status"} />
              )}
              {/* The account menu: who is signed in, their profile, the store's
                  settings (roles that have them), the storefront, the release
                  notes, and Keluar - which used to sit at the foot of the sidebar. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={`ml-1 flex h-9 shrink-0 items-center gap-2 rounded-full pl-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 lg:pr-2.5 data-[state=open]:bg-slate-100 ${
                    activeMenu === "profile" ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                  aria-label={`Menu akun (${roleLabel})`}
                >
                  <span className="grid size-8 place-items-center rounded-full bg-slate-900 text-white" aria-hidden="true">
                    <UserRound className="size-4" />
                  </span>
                  {!mustChangePassword && <span className="hidden text-sm font-medium lg:inline">{roleLabel}</span>}
                  <ChevronDown className="hidden size-3.5 text-slate-400 lg:block" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className="w-60">
                  <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-white" aria-hidden="true">
                      <UserRound className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{adminUsername || roleLabel}</span>
                      <span className="block truncate text-xs font-normal text-slate-500">{roleLabel} · {siteName || adminName}</span>
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                      <a href={profileNavItem.href}>
                        <UserRound aria-hidden="true" />
                        {mustChangePassword ? "Keamanan akun" : "Profil & keamanan"}
                      </a>
                    </DropdownMenuItem>
                    {!mustChangePassword && allItems.some((item) => item.id === "settings") && (
                      <DropdownMenuItem asChild>
                        <a href="/admin/settings/store">
                          <Settings aria-hidden="true" />
                          Pengaturan toko
                        </a>
                      </DropdownMenuItem>
                    )}
                    {!mustChangePassword && (
                      <DropdownMenuItem asChild>
                        <a href="/" target="_blank" rel="noopener noreferrer">
                          <Store aria-hidden="true" />
                          Lihat storefront
                          <ArrowUpRight className="ml-auto text-slate-400" aria-hidden="true" />
                        </a>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => setChangelogOpen(true)}>
                      <History aria-hidden="true" />
                      Catatan rilis
                      <span className="ml-auto font-mono text-xs text-slate-400">v{CMS_VERSION.version}</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  {/* The layout's data-logout-form handler does the request and
                      relabels the button; the item keeps the menu open meanwhile. */}
                  <form method="POST" action="/api/admin/logout" data-logout-form>
                    <DropdownMenuItem asChild variant="destructive" onSelect={(event) => event.preventDefault()}>
                      <button type="submit" className="w-full">
                        <LogOut aria-hidden="true" />
                        Keluar
                      </button>
                    </DropdownMenuItem>
                  </form>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {mustChangePassword && (
            <div role="status" className="border-b border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 md:px-6">
              <div className="mx-auto flex w-full max-w-[1560px] items-start gap-3">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                <p className="leading-5"><strong>Amankan akun sebelum melanjutkan.</strong> Ganti password bawaan; menu operasional akan terbuka setelah Anda login kembali.</p>
              </div>
            </div>
          )}

          <div id="admin-main" tabIndex={-1} className="admin-main min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-8 md:pt-6 xl:px-8">
            {/* The one page-width contract: every admin page fills this box, so the
                header and content edges line up across menus. Pages do not set
                their own max-width. */}
            <div className="mx-auto w-full max-w-[1560px]">{children}</div>
          </div>

          <nav aria-label="Navigasi utama mobile" className="admin-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 shadow-[0_-8px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="grid h-16 items-stretch" style={{ gridTemplateColumns: `repeat(${mobilePrimary.length + 1}, minmax(0, 1fr))` }}>
              {mobilePrimary.map((item) => {
                const active = activeMenu === item.id;
                return (
                  <a key={item.href} href={item.href} aria-current={isAdminNavHrefActive(currentPath, item.href) ? "page" : undefined} className={`group flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-300 ${active ? "font-medium text-slate-950" : "font-normal text-slate-500"}`}>
                    <span className="relative grid size-8 place-items-center rounded-xl transition-colors" style={active ? { backgroundColor: `${ADMIN_ACCENT}14`, color: ADMIN_ACCENT } : undefined}>
                      <item.icon className="size-[19px]" aria-hidden="true" />
                      {active && <span className="absolute -bottom-1 h-0.5 w-3 rounded-full" style={{ backgroundColor: ADMIN_ACCENT }} aria-hidden="true" />}
                    </span>
                    <span className="w-full truncate text-center">{item.shortLabel ?? item.label}</span>
                  </a>
                );
              })}
              <button id="admin-mobile-menu-trigger" type="button" onClick={() => setMenuOpen(true)} aria-current={menuIsActive ? "page" : undefined} className={`flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-300 ${menuIsActive ? "font-medium text-slate-950" : "font-normal text-slate-500"}`} aria-label={mustChangePassword ? "Buka menu akun" : "Buka semua menu"}>
                <span className="relative grid size-8 place-items-center rounded-xl" style={menuIsActive ? { backgroundColor: `${ADMIN_ACCENT}14`, color: ADMIN_ACCENT } : undefined}>
                  <Menu className="size-[19px]" aria-hidden="true" />
                  {menuIsActive && <span className="absolute -bottom-1 h-0.5 w-3 rounded-full" style={{ backgroundColor: ADMIN_ACCENT }} aria-hidden="true" />}
                </span>
                <span>Menu</span>
              </button>
            </div>
          </nav>
        </SidebarInset>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[86dvh] gap-0 overflow-hidden rounded-t-[1.25rem] border-slate-200 bg-white p-0 md:hidden"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.getElementById("admin-mobile-menu-trigger")?.focus();
            }}
          >
            <SheetHeader className="border-b border-slate-200 px-4 pb-3 pt-4 text-left">
              <SheetTitle className="text-base font-semibold tracking-tight text-slate-950">{mustChangePassword ? "Keamanan akun" : "Semua menu"}</SheetTitle>
              <SheetDescription className="text-xs">{mustChangePassword ? "Ganti password bawaan atau akhiri sesi ini." : "Pilih workspace yang ingin dikelola."}</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto overscroll-contain px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2">
              {groups.map((group) => (
                <section key={group.label} className="mb-3">
                  <h2 className="px-2 pb-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">{group.label}</h2>
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {group.items.map((item) => {
                      const active = activeMenu === item.id;
                      const hasChildren = Boolean(item.children?.length);
                      const expanded = hasChildren && expandedMobileMenus.has(item.id);
                      const activeChild = item.children?.find((child) =>
                        isAdminNavHrefActive(currentPath, child.href),
                      );
                      return (
                        <div key={item.id} className="border-b border-slate-100 last:border-b-0">
                          <div className="flex min-h-13 items-center gap-2 px-3 py-2 active:bg-slate-50">
                            <a href={item.href} aria-current={!activeChild && isAdminNavHrefActive(currentPath, item.href) ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600" style={active ? { backgroundColor: `${ADMIN_ACCENT}14`, color: ADMIN_ACCENT } : undefined}>
                              <item.icon className="size-4" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-sm text-slate-900 ${active ? "font-medium" : "font-normal"}`}>{item.label}</span>
                              <span className="block truncate text-xs text-slate-500">{item.description}</span>
                            </span>
                            {!hasChildren && (
                              <ChevronRight className="size-4 shrink-0 text-slate-300" aria-hidden="true" />
                            )}
                          </a>
                            {hasChildren && (
                              <button
                                type="button"
                                className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                                aria-label={`${expanded ? "Tutup" : "Buka"} submenu ${item.label}`}
                                aria-expanded={expanded}
                                aria-controls={`mobile-submenu-${item.id}`}
                                onClick={() => setExpandedMobileMenus((current) => {
                                  const next = new Set(current);
                                  if (next.has(item.id)) next.delete(item.id);
                                  else next.add(item.id);
                                  return next;
                                })}
                              >
                                <ChevronRight className={`size-4 ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                          {item.children && expanded && (
                            <div id={`mobile-submenu-${item.id}`} className="bg-slate-50/50 pb-1.5 pl-14 pr-3 pt-0">
                              {item.children.map((child) => {
                                const childActive = isAdminNavHrefActive(
                                  currentPath,
                                  child.href,
                                );
                                return (
                                  <a key={child.href} href={child.href} aria-current={childActive ? "page" : undefined} className={`flex min-h-11 items-center justify-between gap-3 border-t border-slate-100/60 py-1.5 text-sm active:bg-slate-100/50 ${childActive ? "font-medium text-slate-950" : "font-normal text-slate-600"}`}>
                                    <span className="truncate">{child.label}</span>
                                    <ChevronRight className="size-3.5 shrink-0 text-slate-300" aria-hidden="true" />
                                  </a>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              <a href={profileNavItem.href} className="mb-2 flex min-h-13 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600"><profileNavItem.icon className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-normal text-slate-900">{profileNavItem.label}</span><span className="block truncate text-xs text-slate-500">{profileNavItem.description}</span></span>
                <ChevronRight className="size-4 text-slate-300" aria-hidden="true" />
              </a>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setChangelogOpen(true);
                }}
                className="mb-2 flex min-h-13 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left active:bg-slate-50"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                  <History className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-normal text-slate-900">Catatan Rilis</span>
                  <span className="block truncate text-xs text-slate-500">AdsBookCMS v{CMS_VERSION.version}</span>
                </span>
                <ChevronRight className="size-4 text-slate-300" aria-hidden="true" />
              </button>
              <form method="POST" action="/api/admin/logout" data-logout-form className="mb-2">
                <button type="submit" className="flex min-h-13 w-full items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-left text-rose-700 active:bg-rose-100">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-rose-100">
                    <LogOut className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Keluar</span>
                    <span className="block truncate text-xs text-rose-600">Akhiri sesi admin di perangkat ini</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-rose-300" aria-hidden="true" />
                </button>
              </form>
            </div>
          </SheetContent>
        </Sheet>

        {!mustChangePassword && (isDesktop ? (
          <CommandDialog
            open={searchOpen}
            onOpenChange={handleSearchOpenChange}
            title="Pencarian admin"
            description="Cari halaman dan pengaturan yang tersedia untuk akun ini."
            showCloseButton
          >
            <div className="border-b border-slate-200 px-4 py-3 pr-12">
              <h2 className="text-sm font-semibold tracking-tight text-slate-950">Pencarian admin</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Cari order, pengiriman, produk, tracking, atau pengaturan.
              </p>
            </div>
            {searchContent}
          </CommandDialog>
        ) : (
          <Sheet open={searchOpen} onOpenChange={handleSearchOpenChange}>
            <SheetContent side="bottom" style={{ height: "min(82dvh, 42rem)" }} className="max-h-[calc(100dvh-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[1.25rem] border-slate-200 bg-white p-0">
              <SheetHeader className="border-b border-slate-200 px-4 pb-3 pt-4 pr-12 text-left">
                <SheetTitle className="text-base font-semibold tracking-tight text-slate-950">Pencarian admin</SheetTitle>
                <SheetDescription className="text-xs">
                  Cari order, pengiriman, produk, tracking, atau pengaturan.
                </SheetDescription>
              </SheetHeader>
              <Command className="h-auto! min-h-0 flex-1 rounded-none!">
                {searchContent}
              </Command>
            </SheetContent>
          </Sheet>
        ))}
        <ChangelogModal open={changelogOpen} onOpenChange={setChangelogOpen} />
        <Toaster position="top-center" />
      </SidebarProvider>
    </TooltipProvider>
  );
}
