import { parseTrafficSource } from '../../lib/traffic-source';
import { Badge } from '../ui/badge';

/**
 * The order's traffic source. `plain` is a small coloured dot and label with
 * no frame, for a dense list row; otherwise it is the same Badge as the
 * status badges beside it on the order page.
 */
export function TrafficSourceBadge({
  adClickIds,
  plain = false,
  className = '',
}: {
  adClickIds?: string | null;
  plain?: boolean;
  className?: string;
}) {
  const source = parseTrafficSource(adClickIds);
  const title = source.details.utm_campaign ? `Campaign: ${source.details.utm_campaign}` : source.label;
  const dot = <span className="size-1.5 shrink-0 rounded-full bg-current opacity-80" aria-hidden="true" />;
  if (plain) {
    const tone = source.badgeClass.split(/\s+/).find((token) => token.startsWith('text-')) ?? 'text-slate-600';
    return <span className={`inline-flex items-center gap-1 text-xs ${tone} ${className}`} title={title}>{dot}{source.label}</span>;
  }
  return (
    <Badge variant="outline" className={`gap-1.5 text-xs font-medium ${source.badgeClass} ${className}`} title={title}>
      {dot}
      {source.label}
    </Badge>
  );
}
