import assert from "node:assert/strict";
import test from "node:test";
import {
  getSearchableNavItems,
  getVisibleNavGroups,
  isAdminNavHrefActive,
} from "../components/admin/admin-navigation.ts";
import { ADMIN_ROLES, canAccessAdminRoute } from "./auth.ts";

test("visible admin navigation never exposes a route denied to its role", () => {
  for (const role of ADMIN_ROLES) {
    const links = getSearchableNavItems(role).map((item) => item.href);
    for (const href of links) {
      assert.equal(
        canAccessAdminRoute(role, new URL(href, "https://admin.local").pathname),
        true,
        `${role} cannot access visible link ${href}`,
      );
    }
  }
});

test("scoped roles see their complete workspace without privileged settings", () => {
  const advertiserItems = getVisibleNavGroups("advertiser").flatMap(
    (group) => group.items,
  );
  assert.deepEqual(
    advertiserItems.map((item) => item.id),
    // "content" is deliberately absent: the storefront content editor is
    // reachable at /admin/content and left out of the menu (ADR-018).
    ["dashboard", "products", "analytics", "ads"],
  );
  assert.equal(
    advertiserItems
      .find((item) => item.id === "products")
      ?.children?.some((child) => child.href === "/admin/landing-pages"),
    true,
  );

  const adminSettings = getVisibleNavGroups("admin")
    .flatMap((group) => group.items)
    .find((item) => item.id === "settings");
  assert.equal(
    adminSettings?.children?.some(
      (child) => child.href === "/admin/settings/access",
    ),
    false,
  );
});

test("navigation active matching keeps required query filters and accepts pagination", () => {
  assert.equal(
    isAdminNavHrefActive(
      "/admin/orders?status=abandoned&page=2",
      "/admin/orders?status=abandoned",
    ),
    true,
  );
  assert.equal(
    isAdminNavHrefActive(
      "/admin/orders?status=paid",
      "/admin/orders?status=abandoned",
    ),
    false,
  );
  assert.equal(
    isAdminNavHrefActive("/admin/landing-pages/12/edit", "/admin/landing-pages"),
    false,
  );
  // A plugin's settings page keeps "Plugin" lit; nothing else matches by prefix.
  assert.equal(isAdminNavHrefActive("/admin/settings/plugins/kelola", "/admin/settings/plugins"), true);
  assert.equal(isAdminNavHrefActive("/admin/settings/pluginsx", "/admin/settings/plugins"), false);
  assert.equal(isAdminNavHrefActive("/admin/settings/plugins/kelola", "/admin/settings/store"), false);
});
