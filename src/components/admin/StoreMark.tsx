import { cn } from "@/lib/utils";

// A store without its own logo shows its initial. The deleted placeholder
// wordmark still counts as no logo, should an old store row name it.
const LEGACY_PLACEHOLDER_LOGO = "/images/adsbook-mark.webp";

export function StoreMark({ logo, name, className }: { logo?: string; name: string; className?: string }) {
  if (logo && logo !== LEGACY_PLACEHOLDER_LOGO) {
    return <img src={logo} alt={name} className={cn("shrink-0 object-contain", className)} />;
  }
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-lg bg-slate-900 text-sm font-semibold text-white", className)}>
      {(name.trim()[0] || "A").toUpperCase()}
    </span>
  );
}
