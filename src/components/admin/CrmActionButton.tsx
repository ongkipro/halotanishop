import type { OrderFollowUpStep } from '../../lib/order-follow-up';

export type CrmStepKey = OrderFollowUpStep;
export interface CrmStepConfig {
  key: CrmStepKey;
  label: string;
  fullLabel: string;
  mobileLabel: string;
  title: string;
}

// Shared presentation labels for the existing CRM templates. Completion is
// recorded explicitly by CrmActionGroup, never by clicking a WhatsApp link.
export const CRM_STEPS: CrmStepConfig[] = [
  { key: 'welcome', label: 'Welcome', fullLabel: 'Welcome', mobileLabel: 'Welcome', title: 'Welcome: Sapa & Konfirmasi Pesanan' },
  { key: '1', label: 'Detail', fullLabel: 'Detail', mobileLabel: 'Detail', title: 'Detail: Kirim Rincian Pesanan' },
  { key: '2', label: 'FU 1', fullLabel: 'FU 1', mobileLabel: 'FU 1', title: 'Follow Up 1: Ingatkan Pembayaran' },
  { key: '3', label: 'FU 2', fullLabel: 'FU 2', mobileLabel: 'FU 2', title: 'Follow Up 2: Tawaran Promo' },
  { key: '4', label: 'FU 3', fullLabel: 'FU 3', mobileLabel: 'FU 3', title: 'Follow Up 3: Edukasi Manfaat' },
  { key: '5', label: 'FU 4', fullLabel: 'FU 4', mobileLabel: 'FU 4', title: 'Follow Up 4: Tanya Kendala' },
  { key: '6', label: 'FU 5', fullLabel: 'FU 5', mobileLabel: 'FU 5', title: 'Follow Up 5: Terakhir' },
  { key: '7', label: 'Process', fullLabel: 'Process', mobileLabel: 'Process', title: 'Processing: Informasi Pengiriman' },
  { key: '8', label: 'Finish', fullLabel: 'Finish', mobileLabel: 'Finish', title: 'Completed: Paket Diterima' },
  { key: '9', label: 'Upsell', fullLabel: 'Upsell', mobileLabel: 'Upsell', title: 'UpSelling: Penawaran Varian Lain' },
];
