/* eslint-disable @next/next/no-img-element */

/**
 * Logo slot. Place the official logo file in public/brand/ and set NEXT_PUBLIC_BRAND_LOGO
 * (for example "/brand/logo.svg"). The logo artwork is intentionally not recreated here:
 * without the env var a neutral product wordmark is shown.
 */
export default function Brand({ inverted = false }: { inverted?: boolean }) {
  const logo = process.env.NEXT_PUBLIC_BRAND_LOGO;
  const name = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Brand logo";
  return (
    <span className="flex items-center gap-3">
      {logo && <img src={logo} alt={name} className="h-5 w-auto" />}
      <span
        className={`text-[15px] font-semibold tracking-tight ${
          logo ? `hidden sm:inline ${inverted ? "text-white/70" : "text-muted"} font-normal` : inverted ? "text-white" : "text-ink"
        }`}
      >
        SSDLC Assessment
      </span>
    </span>
  );
}
