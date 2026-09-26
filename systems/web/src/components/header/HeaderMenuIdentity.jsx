import useAuthSession from './useAuthSession.js';
import { pickDisplay, hasLiveIdentity } from './header-avatar-display.js';
import { replaceBrokenAvatar } from './avatar-image-fallback.js';

// Preact island — identity anchor inside hz-shell__menu-user-row (user hamburger menu).
// Slice 2 of vanilla→Preact migration (menu identity row).
//
// Props are SSR-derived from SiteHeader.astro frontmatter — correct at first paint.
// After hydration, useAuthSession() provides the live auth object; pickDisplay() adopts
// live values ONLY once the session is fully settled with real identity, preventing any
// flash during the post-hydration loading window (same flash rule as HeaderAvatar).
//
// href: when auth is settled and carries a real handle, prefer the live
// profile path; otherwise fall back to the SSR-derived profileHref prop.

const DEFAULT_AVATAR_URL = '/assets/brand/default-avatar-96.webp';

const TIER_LABELS = {
  gray: 'תג אפור',
  gold: 'תג זהב',
  diamond: 'תג יהלום',
};

export default function HeaderMenuIdentity({
  // SSR-derived props — authoritative for first paint and the whole loading window.
  initial: propInitial,
  tier: propTier,
  avatarUrl: propAvatarUrl,
  name: propName,
  sub: propSub,
  profileHref: propProfileHref,
}) {
  const auth = useAuthSession();
  const { initial, avatarUrl, tier, name, sub } = pickDisplay(auth, {
    initial: propInitial,
    avatarUrl: propAvatarUrl,
    tier: propTier,
    name: propName,
    sub: propSub,
  });

  // Live profile href: only when settled with real identity and a non-empty segment.
  let href = propProfileHref;
  if (hasLiveIdentity(auth)) {
    const segment = auth.user?.handle || '';
    if (segment) href = `/@${encodeURIComponent(segment)}`;
  }

  const displayAvatarUrl = avatarUrl || DEFAULT_AVATAR_URL;
  const isDefaultAvatar = !avatarUrl;
  const tierClass = tier ? ` hz-shell__avatar--verified hz-shell__avatar--tier-${tier}` : '';
  const tierTitle = tier ? (TIER_LABELS[tier] || 'תג') : undefined;
  const badge = tier ? 'verified' : '';

  return (
    <a class="hz-shell__menu-user" href={href}>
      <span class={`hz-shell__avatar${tierClass}`} data-shell-verification-avatar title={tierTitle}>
        <span class="hz-shell__avatar-frame">
          <img
            class="hz-shell__avatar-img"
            src={displayAvatarUrl}
            alt=""
            width="36"
            height="36"
            data-shell-user-avatar-img
            data-default-avatar={isDefaultAvatar ? true : undefined}
            onError={(event) => replaceBrokenAvatar(event, DEFAULT_AVATAR_URL)}
          />
          <span class="hz-shell__avatar-initial" data-shell-user-menu-initial hidden={Boolean(avatarUrl)}>{initial}</span>
        </span>
        <span class="hz-shell__avatar-badge material-symbols-outlined" data-shell-verification-badge aria-hidden="true">{badge}</span>
      </span>
      <div class="hz-shell__menu-user-text">
        <span class="hz-shell__menu-user-name" data-shell-user-name>{name}</span>
        <span class="hz-shell__menu-user-sub" data-shell-user-sub>{sub}</span>
      </div>
    </a>
  );
}
