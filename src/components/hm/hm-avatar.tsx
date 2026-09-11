import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

type HmAvatarProps = {
  name: string;
  photoUrl: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZES = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-16 text-base",
} as const;

/**
 * An HM's photo, or their initials.
 *
 * Most HMs have no photo for a while after being added, so the fallback is the
 * normal case rather than an error state - it gets the same circle and the same
 * footprint, so the list does not reflow as photos arrive.
 *
 * A plain `<img>` rather than `next/image`: the bucket host is only known from
 * `NEXT_PUBLIC_SUPABASE_URL` at runtime, so pinning it into `images.remotePatterns`
 * would couple the build to one project's URL for no benefit at this size.
 */
export function HmAvatar({
  name,
  photoUrl,
  size = "md",
  className,
}: HmAvatarProps) {
  const shared = cn(
    "shrink-0 rounded-full object-cover",
    SIZES[size],
    className,
  );

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        // A hairline ring and a soft shadow rather than a hard border: a
        // photograph sitting on glass needs an edge, not a frame.
        className={cn(
          shared,
          "bg-slate-900/[0.04] shadow-[var(--shadow-control)] ring-1 ring-slate-900/10",
        )}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        shared,
        "flex items-center justify-center bg-slate-900/[0.05] font-semibold text-slate-500 shadow-[var(--shadow-control)] ring-1 ring-slate-900/10",
      )}
    >
      {initials(name)}
    </span>
  );
}
