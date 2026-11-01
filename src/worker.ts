import type { ExecutionContext, ExportedHandler } from "@cloudflare/workers-types";
import { handle } from "@astrojs/cloudflare/handler";
import { purgeExpiredAbandonedOrders } from "./lib/order-persistence.ts";
import { getEnvValue } from "./lib/env.ts";
import {
  alertsFromOperationalHealth,
  evaluateOperationalAlerts,
} from "./lib/operational-alerts.ts";
import { collectOperationalHealth, recordSchedulerRun } from "./lib/operational-health.ts";
import { readSetupRequiredLeft, writeHealthSnapshot } from "./lib/health-snapshot.ts";
import { backfillReceiverScores } from "./lib/rts-scoring.ts";
import { ensureSchemaUpgraded } from "./lib/schema-version.ts";
import { purgeExpiredRateLimits } from "./lib/rate-limit.ts";
import { reconcileNativeLandingPages } from "./lib/landing-pages.ts";
import { purgeExpiredNotifications } from "./lib/notifications.ts";
import {
  expirePendingPaymentTransactions,
  purgeExpiredAutoLarisCallbacks,
  reconcileAutoLarisPaymentStatuses,
} from "./lib/autolaris-payment.ts";
import { enqueuePurchaseForPaidOrder } from "./lib/paid-order-purchase.ts";
import { envTenantConfig } from "./lib/tenant.ts";
import { drainCapiOutbox, purgeExpiredCapiOutboxEvents } from "./lib/capi-outbox.ts";
import { getStoreAdsConfig } from "./lib/store-ads.ts";
import { runPluginCron } from "./plugins/registry.ts";
import {
  drainGoogleAdsConversionOutbox,
  purgeExpiredGoogleAdsConversions,
  readGoogleAdsOfflineConfig,
  reconcileGoogleAdsConversions,
} from "./lib/google-ads-offline.ts";
type AstroRequest = Parameters<typeof handle>[0];

async function runScheduledMaintenance(
  env: CloudflareRuntimeEnv,
  scheduledTime: number,
  context: ExecutionContext,
) {
  await ensureSchemaUpgraded(env.OMS_DB);
  // No step takes the ones after it down: payment reconciliation, both outbox
  // drains and the health evaluation each run even when an earlier step hit a
  // transient D1 or provider error. The failure is logged and reads as -1.
  const housekeeping = async (label: string, run: () => Promise<number>) => {
    try {
      return await run();
    } catch (error) {
      console.error(label, error);
      return -1;
    }
  };
  // The panel's "Tugas terjadwal" signal: proof this clock still runs at all.
  // A D1 column on the status row, not KV (A-379), stamped before any later
  // step can fail.
  await housekeeping("scheduled-heartbeat-failed", async () => {
    await recordSchedulerRun(env.OMS_DB, new Date(scheduledTime));
    return 0;
  });
  const purgedAbandonedOrders = await housekeeping(
    "scheduled-abandoned-order-purge-failed",
    () => purgeExpiredAbandonedOrders(env.OMS_DB, new Date(scheduledTime)),
  );
  const purgedRateLimitWindows = await housekeeping(
    "scheduled-rate-limit-purge-failed",
    () => purgeExpiredRateLimits(env.OMS_DB, new Date(scheduledTime)),
  );
  const expiredPaymentInstructions = await housekeeping(
    "scheduled-payment-expiry-failed",
    () => expirePendingPaymentTransactions(env.OMS_DB, new Date(scheduledTime)),
  );
  const purgedProviderCallbacks = await housekeeping(
    "scheduled-callback-purge-failed",
    () => purgeExpiredAutoLarisCallbacks(env.OMS_DB, new Date(scheduledTime)),
  );
  const purgedNotifications = await housekeeping(
    "scheduled-notification-purge-failed",
    () => purgeExpiredNotifications(env.OMS_DB, new Date(scheduledTime)),
  );
  const purgedCapiOutboxEvents = await housekeeping(
    "scheduled-capi-outbox-purge-failed",
    () => purgeExpiredCapiOutboxEvents(env.OMS_DB, new Date(scheduledTime)),
  );
  const purgedGoogleAdsConversions = await housekeeping(
    "scheduled-google-ads-purge-failed",
    () => purgeExpiredGoogleAdsConversions(env.OMS_DB, new Date(scheduledTime)),
  );
  // The native register reached the table only when an operator opened the
  // landing-page list, so a page deployed since stayed out of the sitemap and
  // could not take a product page until then. The re-sync writes only what
  // changed, so running it hourly costs nothing when nothing did.
  await housekeeping("scheduled-native-landing-reconcile-failed", async () => {
    await reconcileNativeLandingPages(env.OMS_DB);
    return 0;
  });
  // Payment truth for QRIS/VA. The retired webhook never answered; the
  // provider's Advice endpoint does, and this is the only clock that asks it.
  // A transaction is marked paid solely when the provider's own response says
  // so — an operator can still reconcile by hand from /admin/payments, and
  // every transition either way is audited.
  const scheduledLocals = {
    runtimeEnv: env,
    tenant: envTenantConfig,
    cfContext: context,
  } satisfies App.Locals;
  let autoLarisReconciliation = {
    checked: 0,
    pending: 0,
    unproven: 0,
    failed: 0,
    paidOrderIds: [] as number[],
    unrecognisedPaidStatuses: [] as string[],
  };
  try {
    autoLarisReconciliation = await reconcileAutoLarisPaymentStatuses(
      env.OMS_DB,
      scheduledLocals,
      new Date(scheduledTime),
    );
  } catch (error) {
    console.error("scheduled-autolaris-advice-failed", error);
  }
  for (const orderId of autoLarisReconciliation.paidOrderIds) {
    try {
      await enqueuePurchaseForPaidOrder(env.OMS_DB, scheduledLocals, orderId);
    } catch (error) {
      // Payment truth is authoritative. Conversion delivery is independently
      // retried by its outbox and must never roll a paid order back.
      console.error("scheduled-paid-order-purchase-failed", { orderId, error });
    }
  }
  // The outbox had no clock of its own: `drainCapiOutbox` was reachable only
  // from `/api/meta-event` and `/api/v1/tracking/events`, so a delivery that
  // failed was retried when the next visitor arrived rather than when its
  // backoff expired. Backoff caps at an hour, which assumes someone will be
  // along within the hour — not true for a store between campaigns, and the
  // health check below was already counting the overdue rows without anything
  // acting on them.
  const drainedCapiEvents = await housekeeping("scheduled-capi-drain-failed", async () => {
    const ads = await getStoreAdsConfig({ runtimeEnv: env } as unknown as App.Locals);
    return ads.metaPixelId && ads.metaCapiToken
      ? drainCapiOutbox(env.OMS_DB, ads.metaPixelId, ads.metaCapiToken)
      : 0;
  });
  const googleAdsOffline = readGoogleAdsOfflineConfig(env);
  const queuedGoogleAdsConversions = googleAdsOffline
    ? await housekeeping("scheduled-google-ads-reconcile-failed", () =>
        reconcileGoogleAdsConversions(env.OMS_DB, googleAdsOffline, new Date(scheduledTime)),
      )
    : 0;
  const drainedGoogleAdsConversions = googleAdsOffline
    ? await housekeeping("scheduled-google-ads-drain-failed", () =>
        drainGoogleAdsConversionOutbox(env.OMS_DB, googleAdsOffline),
      )
    : 0;
  // Active plugins only (ADR-028); a store with none does one cheap read.
  // runPluginCron isolates each plugin's failure; this catch is for the read.
  const pluginCron = await runPluginCron(env.OMS_DB, env, new Date(scheduledTime)).catch((error) => {
    console.error("scheduled-plugin-cron-failed", error);
    return {};
  });

  // Receiver Score is whitelisted per Mengantar account; orders taken while it
  // was refused (or never opened in /admin) score themselves here.
  const backfilledReceiverScores = await housekeeping("scheduled-receiver-score-backfill-failed", () =>
    backfillReceiverScores(env.OMS_DB, scheduledLocals),
  );

  const health = await collectOperationalHealth(env.OMS_DB);
  const alerts = await evaluateOperationalAlerts(
    alertsFromOperationalHealth(health),
    {
      store: env.SESSION,
      webhookUrl: getEnvValue("OPS_ALERT_WEBHOOK_URL", {
        OPS_ALERT_WEBHOOK_URL: env.OPS_ALERT_WEBHOOK_URL,
      }),
      // No request here, so the install names itself from its own config.
      source: env.PUBLIC_SITE_URL,
    },
  );

  console.info("operational-health-scheduled", {
    overall: health.overall,
    schemaState: health.build.schemaState,
    purgedAbandonedOrders,
    purgedRateLimitWindows,
    expiredPaymentInstructions,
    purgedProviderCallbacks,
    purgedNotifications,
    purgedCapiOutboxEvents,
    purgedGoogleAdsConversions,
    backfilledReceiverScores,
    autoLarisReconciliation: {
      checked: autoLarisReconciliation.checked,
      paid: autoLarisReconciliation.paidOrderIds.length,
      pending: autoLarisReconciliation.pending,
      unproven: autoLarisReconciliation.unproven,
      failed: autoLarisReconciliation.failed,
      // The provider's success code with a settlement word the allowlist does
      // not know. Non-empty here is the observation SCR1 needs, not an error.
      unrecognisedPaidStatuses: autoLarisReconciliation.unrecognisedPaidStatuses,
    },
    drainedCapiEvents,
    queuedGoogleAdsConversions,
    drainedGoogleAdsConversions,
    pluginCron,
    alerts: alerts.map(({ id, state, reason, transition, notification }) => ({
      id,
      state,
      reason,
      transition,
      notification,
    })),
  });

  // The admin status icon reads this one row instead of collecting health on
  // every page (A39). Last, and isolated: its failure is logged and nothing
  // else, and a run that failed to collect never reaches it, so the previous
  // snapshot stays rather than a blank one.
  await housekeeping("scheduled-health-snapshot-failed", async () => {
    await writeHealthSnapshot(
      env.OMS_DB,
      health,
      await readSetupRequiredLeft(env.OMS_DB, scheduledLocals),
    );
    return 0;
  });
}

export default {
  fetch(request, env, ctx) {
    // @astrojs/cloudflare's public handler uses the DOM Request type while
    // ExportedHandler supplies the structurally compatible Workers Request.
    return handle(request as unknown as AstroRequest, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    await runScheduledMaintenance(env, controller.scheduledTime, ctx);
  },
} satisfies ExportedHandler<CloudflareRuntimeEnv>;
