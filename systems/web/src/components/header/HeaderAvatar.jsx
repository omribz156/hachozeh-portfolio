import useAuthSession from './useAuthSession.js';
import { pickDisplay } from './header-avatar-display.js';
import { replaceBrokenAvatar } from './avatar-image-fallback.js';

// Preact island — avatar button inside hz-shell__actions-group[data-shell-user-actions].
// Slice 1 of vanilla→Preact migration (header avatar).
//
// Props are SSR-derived from SiteHeader.astro frontmatter — they reflect the correct
// signed-in state at first paint (the flash fix). After hydration, useAuthSession()
// provides the live auth object; pickDisplay() adopts live values ONLY once the session
// is fully settled with real identity (see header-avatar-display.js for the flash rule),
// so the post-hydration loading window can never flip the SSR-correct avatar.
// (The vanilla avatar/initial/badge writes that header-session.client.js used to
// make were removed in Slice 2 — this island is now the sole writer of its subtree.)

const DEFAULT_AVATAR_URL = '/assets/brand/default-avatar-96.webp';

const TIER_LABELS = {
  gray: 'תג אפור',
  gold: 'תג זהב',
  diamond: 'תג יהלום',
};

export default function HeaderAvatar({
  // SSR-derived props — authoritative for first paint and the whole loading window.
  initial: propInitial,
  tier: propTier,
  avatarUrl: propAvatarUrl,
}) {
  const auth = useAuthSession();
  const { initial, avatarUrl, tier } = pickDisplay(auth, {
    initial: propInitial,
    avatarUrl: propAvatarUrl,
    tier: propTier,
  });

  const displayAvatarUrl = avatarUrl || DEFAULT_AVATAR_URL;
  const isDefaultAvatar = !avatarUrl;
  const tierClass = tier ? ` hz-shell__avatar--verified hz-shell__avatar--tier-${tier}` : '';
  const tierTitle = tier ? (TIER_LABELS[tier] || 'תג') : undefined;
  const badge = tier ? 'verified' : '';

  return (
    <button
      class={`hz-shell__avatar hz-shell__avatar--trigger${tierClass}`}
      type="button"
      data-hamburger-trigger="user"
      data-shell-verification-avatar
      aria-haspopup="true"
      aria-expanded="false"
      aria-label="תפריט וחשבון"
      title={tierTitle}
    >
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
        <span class="hz-shell__avatar-initial" data-shell-user-initial hidden={Boolean(avatarUrl)}>{initial}</span>
      </span>
      <span class="hz-shell__avatar-badge material-symbols-outlined" data-shell-verification-badge aria-hidden="true">{badge}</span>
      <span class="hz-shell__avatar-presence" aria-hidden="true"></span>
    </button>
  );
}
