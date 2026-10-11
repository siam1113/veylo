import { useEffect, useState } from 'react';
import { authClient } from '../lib/backend.client';

let exchangeInFlight: Promise<boolean> | null = null;
function exchangeCodeOnce(url: string): Promise<boolean> {
  if (!authClient) return Promise.resolve(false);
  if (!exchangeInFlight) {
    exchangeInFlight = authClient.auth.exchangeCodeForSession(url)
      .then(({ error }) => !error)
      .catch(() => false)
      .finally(() => { exchangeInFlight = null; });
  }
  return exchangeInFlight;
}

export default function AuthCallback() {
  const [message, setMessage] = useState('Completing sign in…');
  useEffect(() => {
    let active = true;
    const finishSignIn = async () => {
      if (!authClient) {
        setMessage('Sign in is not configured for this app.');
        return;
      }
      try {
        const exchanged = await exchangeCodeOnce(window.location.href);
        if (!exchanged) throw new Error('Auth code exchange failed');
        if (active) window.location.replace('/');
      } catch {
        if (active) setMessage('This sign-in link is invalid or expired. Return to Veylo and request a new link.');
      }
    };
    void finishSignIn();
    return () => { active = false; };
  }, []);
  return <main className="auth-screen"><section className="auth-card"><p className="auth-message" role="status">{message}</p>{message !== 'Completing sign in…' ? <a className="capture-button" href="/">Back to sign in <span>↗</span></a> : null}</section></main>;
}
