const PUBLIC_AVATAR_PREFIX = "/api/uploads/avatars/";
const PUBLIC_AVATAR_FILE_RE = /^[A-Za-z0-9_-]+\.webp$/;

export function sanitizePublicAvatarUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    return null;
  }

  if (!normalized.startsWith(PUBLIC_AVATAR_PREFIX)) {
    return null;
  }

  const fileName = normalized.slice(PUBLIC_AVATAR_PREFIX.length);
  if (!PUBLIC_AVATAR_FILE_RE.test(fileName)) {
    return null;
  }

  // Reject legacy avatar filenames that embed the owner's internal user id
  // (`user_<uuid>-…webp`, the historical naming scheme). The public profile DTO
  // deliberately never exposes the raw user id, so serving such a URL would leak it.
  // Current uploads are named `avatar-<random>.webp` (see createAvatarFileName in
  // current-user-avatar-service.ts) and pass this guard cleanly; the remaining `user_…`
  // files are legacy data and must be re-uploaded/migrated, not served.
  if (/^user[_-]/i.test(fileName)) {
    return null;
  }

  return `${PUBLIC_AVATAR_PREFIX}${fileName}`;
}
