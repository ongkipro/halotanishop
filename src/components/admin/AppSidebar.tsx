import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { StoreMark } from "./StoreMark";
import { ChevronRight } from "lucide-react";
import {
  ADMIN_ACCENT,
  getVisibleNavGroups,
  isAdminNavHrefActive,
  profileNavItem,
  type AdminRole,
} from "./admin-navigation";
import { CMS_VERSION } from "@/lib/version";


export function AppSidebar({
  activeMenu,
  currentPath,
  siteUrl = "",
  adminName,
  siteName,
  siteLogo,
  adminRole,
  restricted = false,
  onOpenChangelog,
}: {
  activeMenu: string;
  currentPath: string;
  siteUrl?: string;
  adminName: string;
  siteName?: string;
  siteLogo?: string;
  adminRole: AdminRole;
  restricted?: boolean;
  onOpenChangelog?: () => void;
}) {
  const rawName = siteName || adminName;
  const storeName = rawName
    .replace(/\s+preview\s+ops$/i, "")
    .replace(/\s+preview$/i, "")
    .replace(/\s+ops$/i, "")
    .replace(/\s+dashboard$/i, "")
    .replace(/\s+cms$/i, "")
    .trim();
  const displayDomain = siteUrl.replace(/^https?:\/\//, "") || "adsbook.internal";
  const groups = restricted ? [] : getVisibleNavGroups(adminRole);

  return (
    <Sidebar variant="sidebar" collapsible="icon" className="border-r-0">
      <SidebarHeader className="px-3 pb-2 pt-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={`${storeName} Dashboard`} className="h-14 rounded-xl px-2 hover:bg-sidebar-accent">
              <a href={restricted ? profileNavItem.href : "/admin/dashboard"} aria-label={restricted ? "Buka keamanan akun" : `Buka dashboard ${storeName}`}>
                <StoreMark logo={siteLogo} name={storeName} className="size-9" />
                <span className="grid-cols-1 grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">{storeName}</span>
                  <span className="truncate text-xs text-slate-500">{displayDomain}</span>
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-2">
        {restricted && (
          <SidebarGroup className="py-1">
            <SidebarGroupLabel className="mb-0.5 h-6 px-2 text-xs font-medium uppercase tracking-wider text-slate-400">
              Keamanan akun
            </SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive tooltip={profileNavItem.label} className="h-9 rounded-lg px-2.5 font-medium group-data-[collapsible=icon]:size-10!" style={{ backgroundColor: `${ADMIN_ACCENT}12`, color: ADMIN_ACCENT }}>
                  <a href={profileNavItem.href} aria-current="page">
                    <profileNavItem.icon className="size-[17px]" aria-hidden="true" />
                    <span>{profileNavItem.label}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
        {groups.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="mb-0.5 h-6 px-2 text-xs font-semibold uppercase tracking-[0.06em] text-slate-400">
              {group.label}
            </SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const active = activeMenu === item.id;
                const children = item.children ?? [];
                const activeChild = children.find((child) =>
                  isAdminNavHrefActive(currentPath, child.href),
                );
                const overviewActive = !activeChild && isAdminNavHrefActive(currentPath, item.href);
                const itemStyle = active
                  ? {
                      backgroundColor: `${ADMIN_ACCENT}12`,
                      color: ADMIN_ACCENT,
                    }
                  : undefined;

                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={children.length > 0 ? `${item.label} · memiliki submenu` : item.label}
                      className="relative h-9 rounded-lg px-2.5 font-normal text-slate-600 hover:bg-slate-100 hover:text-slate-950 data-[active=true]:font-medium group-data-[collapsible=icon]:size-10!"
                      style={itemStyle}
                    >
                      <a
                        href={item.href}
                        aria-current={overviewActive ? "page" : undefined}
                      >
                        {active && (
                          <span
                            className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full"
                            style={{ backgroundColor: ADMIN_ACCENT }}
                            aria-hidden="true"
                          />
                        )}
                        <item.icon className="size-[17px]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                          {children.length > 0 && <span className="sr-only"> · memiliki submenu</span>}
                        </span>
                        {children.length > 0 && (
                          <ChevronRight
                            className={`ml-auto size-3.5 shrink-0 group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-0.5 group-data-[collapsible=icon]:top-0.5 group-data-[collapsible=icon]:size-2.5 ${active ? "rotate-90" : ""}`}
                            aria-hidden="true"
                          />
                        )}
                      </a>
                    </SidebarMenuButton>
                    {active && children.length > 0 && (
                      <SidebarMenuSub className="mr-0 gap-0.5 border-slate-200/90 py-1">
                        {children.map((child) => {
                          const childActive = isAdminNavHrefActive(currentPath, child.href);

                          return (
                            <SidebarMenuSubItem key={child.href}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={childActive}
                                className="h-8 rounded-md px-2 text-sm font-normal text-slate-500 hover:bg-slate-100 hover:text-slate-950 data-[active=true]:font-medium data-[active=true]:text-blue-700"
                              >
                                <a
                                  href={child.href}
                                  aria-current={childActive ? "page" : undefined}
                                >
                                  <span
                                    aria-hidden="true"
                                    className={`size-1.5 shrink-0 rounded-full ${childActive ? "bg-blue-600" : "bg-slate-300"}`}
                                  />
                                  <span>{child.label}</span>
                                </a>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* The product card: who made this admin and what changed. Keluar moved
          to the account menu in the top bar. Collapsed (icon rail) it is the
          product icon alone. */}
      <SidebarFooter className="border-t border-slate-200/70 p-2">
        {onOpenChangelog && (
          <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                onClick={onOpenChangelog}
                tooltip={`Catatan rilis AdsBookCMS v${CMS_VERSION.version}`}
                className="h-10 hover:bg-slate-100"
              >
                <img src="/images/adsbook-icon.svg" alt="" width="18" height="18" className="shrink-0" />
                <span>v{CMS_VERSION.version}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        {onOpenChangelog ? (
          <button
            type="button"
            onClick={onOpenChangelog}
            title="Buka catatan rilis AdsBookCMS"
            className="group flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-2.5 py-2 text-left shadow-xs transition-[border-color,box-shadow] hover:border-slate-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 group-data-[collapsible=icon]:hidden"
          >
            <img src="/images/adsbook-icon.svg" alt="" width="28" height="28" className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-4 text-slate-900">AdsBookCMS</span>
              <span className="mt-0.5 flex items-center gap-0.5 text-xs leading-4 text-slate-500 group-hover:text-slate-700">
                Catatan rilis
                <ChevronRight className="size-3" aria-hidden="true" />
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/15">
              v{CMS_VERSION.version}
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 group-data-[collapsible=icon]:hidden">
            <img src="/images/adsbook-icon.svg" alt="" width="28" height="28" className="shrink-0" />
            <span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-900">AdsBookCMS</span>
            <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/15">
              v{CMS_VERSION.version}
            </span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
