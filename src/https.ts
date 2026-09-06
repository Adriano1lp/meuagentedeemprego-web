export function isLocalhostHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

export function shouldRedirectToHttps(
  protocol: string,
  hostname: string,
  isProd: boolean,
): boolean {
  return isProd && protocol === 'http:' && !isLocalhostHost(hostname);
}

export function httpsRedirectUrl(location: {
  host: string;
  pathname: string;
  search: string;
  hash: string;
}): string {
  return `https://${location.host}${location.pathname}${location.search}${location.hash}`;
}

/** Em producao, redireciona http → https. Localhost pode continuar em http. */
export function enforceHttpsInProduction(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (
    !shouldRedirectToHttps(
      window.location.protocol,
      window.location.hostname,
      import.meta.env.PROD,
    )
  ) {
    return;
  }
  window.location.replace(httpsRedirectUrl(window.location));
}
