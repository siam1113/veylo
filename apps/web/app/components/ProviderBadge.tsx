import { providerLogoSrc } from '../lib/provider-logos';

export function ProviderBadge({ provider, className = '' }: { provider?: string | null; className?: string }) {
  const src = providerLogoSrc(provider);
  if (!src) return null;
  return <img className={`provider-badge ${className}`} src={src} alt="" width="14" height="14" />;
}
