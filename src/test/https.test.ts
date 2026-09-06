import { describe, expect, it } from 'vitest';

import { httpsRedirectUrl, shouldRedirectToHttps } from '../https';

describe('HTTPS em producao', () => {
  it('redireciona http publico em producao', () => {
    expect(shouldRedirectToHttps('http:', 'app.example.com', true)).toBe(true);
    expect(
      httpsRedirectUrl({
        host: 'app.example.com',
        pathname: '/conta',
        search: '?x=1',
        hash: '#topo',
      }),
    ).toBe('https://app.example.com/conta?x=1#topo');
  });

  it('permite http em localhost e fora de producao', () => {
    expect(shouldRedirectToHttps('http:', 'localhost', true)).toBe(false);
    expect(shouldRedirectToHttps('http:', '127.0.0.1', true)).toBe(false);
    expect(shouldRedirectToHttps('http:', 'app.example.com', false)).toBe(false);
    expect(shouldRedirectToHttps('https:', 'app.example.com', true)).toBe(false);
  });
});
