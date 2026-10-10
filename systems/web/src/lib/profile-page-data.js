export async function loadProfilePageData(paramId, getJSON) {
  const handle = /^@?[a-z0-9][a-z0-9_.]{1,22}[a-z0-9]$/i.test(paramId);
  const legacyId = /^user_[a-z0-9_-]{1,75}$/i.test(paramId);
  if (!handle && !legacyId) return [null, null, null, null];
  const enc = encodeURIComponent(paramId);
  const profile = await getJSON(`/api/social/users/${enc}`, true);
  if (!profile) return [null, null, null, null];
  const [trackRecord, positions, record] = await Promise.all([
    getJSON(`/api/social/users/${enc}/track-record`),
    getJSON(`/api/social/users/${enc}/positions?limit=20`),
    getJSON(`/api/social/users/${enc}/record?limit=20`),
  ]);
  return [profile, trackRecord, positions, record];
}
