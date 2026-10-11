import { useEffect } from 'react';
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from 'react-router';
import type { ReactNode } from 'react';
import appStyles from './styles.css?url';
import { reportClientRenderError } from './lib/backend.client';

export function links() { return [{ rel: 'stylesheet', href: appStyles }]; }
export function meta() { return [{ title: 'Veylo — Make room for what matters' }]; }

export function Layout({ children }: { children: ReactNode }) {
  return <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta id="veylo-theme-color" name="theme-color" content="#eaf0ed" />
      <link rel="manifest" href="/assets/manifest.webmanifest" />
      <link rel="icon" href="/assets/icon.svg" type="image/svg+xml" />
      <link rel="stylesheet" href="/assets/veylo.css" />
      <link rel="stylesheet" href="/assets/status.css" />
      <script dangerouslySetInnerHTML={{ __html: `try{const saved=localStorage.getItem('veylo-theme-v1');document.documentElement.dataset.theme=saved==='light'||saved==='dark'?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.getElementById('veylo-theme-color').content=document.documentElement.dataset.theme==='dark'?'#1e2823':'#eaf0ed'}catch{document.documentElement.dataset.theme='light'}` }} />
      <Meta />
      <Links />
    </head>
    <body>
      {children}
      <ScrollRestoration />
      <Scripts />
    </body>
  </html>;
}

export default function Root() {
  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');
  }, []);
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  useEffect(() => { console.error('Veylo route render failed', error); void reportClientRenderError(error); }, [error]);
  const message = isRouteErrorResponse(error) ? `${error.status} · ${error.statusText}` : 'A temporary issue interrupted this screen.';
  return <main className="error-screen"><div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>veylo</span></div><p className="date-label">YOUR SPACE IS STILL HERE</p><h1>Let’s try that again.</h1><p>{message}</p><small>If a thought was saved on this device, it remains available after reload.</small><button className="capture-button" onClick={() => window.location.reload()}>Reload Veylo <span>↗</span></button></main>;
}
