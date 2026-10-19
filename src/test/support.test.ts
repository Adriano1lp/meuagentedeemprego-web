import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SUPPORT_EMAIL, SUPPORT_SUBJECT, supportMailto } from '../config/support';

const srcRoot = path.resolve(process.cwd(), 'src');

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...filesUnder(full));
      continue;
    }
    found.push(full);
  }
  return found;
}

describe('supportMailto', () => {
  it('monta o href só com o assunto fixo, sem corpo', () => {
    const href = supportMailto();

    expect(href).toBe(`mailto:${SUPPORT_EMAIL}?subject=Suporte%20MAE`);
    expect(href.split('?')[1]).toBe('subject=Suporte%20MAE');
    expect(decodeURIComponent(href.split('subject=')[1] ?? '')).toBe(SUPPORT_SUBJECT);
    expect(SUPPORT_SUBJECT).toBe('Suporte MAE');

    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('subject')).toBe('Suporte MAE');
    expect([...params.keys()]).toEqual(['subject']);
    expect(href.includes('body=')).toBe(false);
  });

  it('o e-mail de suporte só aparece na config', () => {
    const configPath = path.join(srcRoot, 'config', 'support.ts');
    const hits = filesUnder(srcRoot).filter((file) =>
      readFileSync(file, 'utf8').includes(SUPPORT_EMAIL),
    );

    expect(hits).toEqual([configPath]);
    expect(readFileSync(configPath, 'utf8').split(SUPPORT_EMAIL)).toHaveLength(2);
  });
});
