const MAX_CHARS = 16;

/**
 * The landing page an order or lead came from (PRD A36, REQ-194). A short
 * chip beside the traffic-source badge: the page's name cut to 16 characters,
 * the full recorded path in its tooltip. It never shrinks below its own text:
 * the row it sits in wraps it under the badge instead, where it truncates to
 * the row's width. A row without a source gains nothing.
 */
export function SourceSlugChip({
  label,
  path,
}: {
  label?: string | null;
  path?: string | null;
}) {
  if (!label) return null;
  const chars = Array.from(label);
  const text = chars.length > MAX_CHARS ? `${chars.slice(0, MAX_CHARS - 1).join("")}…` : label;
  return (
    <span
      className="inline-flex max-w-[min(9.5rem,100%)] shrink-0 items-center truncate rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600"
      title={path ? `${label} — ${path}` : label}
    >
      <span className="truncate">{text}</span>
    </span>
  );
}
