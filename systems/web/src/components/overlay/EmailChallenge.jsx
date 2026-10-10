import { useEffect, useRef, useState } from 'preact/hooks';

let loading;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => { script.remove(); loading = null; reject(new Error('Challenge unavailable')); }, 10000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => { clearTimeout(timeout); resolve(window.turnstile); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); loading = null; reject(new Error('Challenge unavailable')); };
    document.head.append(script);
  });
  return loading;
}

export default function EmailChallenge({ siteKey, onToken }) {
  const container = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; let widget; let api;
    onToken('');
    if (siteKey) loadTurnstile().then((loaded) => {
      if (!active) return;
      api = loaded;
      widget = api.render(container.current, { sitekey: siteKey, action: 'email_auth', theme: 'dark', size: 'flexible',
        callback: (token) => { if (active) { setFailed(false); onToken(token); } },
        'expired-callback': () => { if (active) onToken(''); },
        'error-callback': () => { if (active) { onToken(''); setFailed(true); } },
      });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (widget !== undefined) api.remove(widget); };
  }, [siteKey]);
  return <div><div ref={container} />{failed && <p role="alert">בדיקת האבטחה אינה זמינה. אפשר להמשיך עם Google.</p>}</div>;
}
