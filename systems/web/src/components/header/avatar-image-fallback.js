export function replaceBrokenAvatar(event, fallbackUrl) {
  const image = event?.currentTarget;
  if (!image || !fallbackUrl || image.dataset?.defaultAvatar === 'true') return;
  image.dataset.defaultAvatar = 'true';
  image.src = fallbackUrl;
}
