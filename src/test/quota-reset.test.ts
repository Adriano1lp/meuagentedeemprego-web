import { describe, expect, it } from 'vitest';

import {
  formatQuotaResetLabel,
  isQuotaExhausted,
  quotaUsageText,
} from '../api/billing';

describe('formatQuotaResetLabel', () => {
  it('formata 1º de novembro em UTC mesmo com o calendario de Sao Paulo em 31 de outubro', () => {
    const iso = '2026-11-01T00:00:00Z';
    const saoPaulo = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));

    expect(saoPaulo).toBe('2026-10-31');
    expect(formatQuotaResetLabel(iso)).toBe('Sua cota reinicia em 1º de novembro');
    expect(formatQuotaResetLabel(iso)).not.toMatch(/outubro|renovação|renovacao|cobrança|cobranca|fatura/i);
  });

  it('formata 1º de janeiro a partir de 2027-01-01T00:00:00Z', () => {
    expect(formatQuotaResetLabel('2027-01-01T00:00:00Z')).toBe(
      'Sua cota reinicia em 1º de janeiro',
    );
  });

  it('omite a frase quando period_end falta ou é invalido', () => {
    expect(formatQuotaResetLabel(undefined)).toBeNull();
    expect(formatQuotaResetLabel(null)).toBeNull();
    expect(formatQuotaResetLabel('')).toBeNull();
    expect(formatQuotaResetLabel('nao-e-data')).toBeNull();
  });

  it('escreve os outros dias sem ordinal e sem hora', () => {
    expect(formatQuotaResetLabel('2026-11-15T23:30:00Z')).toBe(
      'Sua cota reinicia em 15 de novembro',
    );
    expect(formatQuotaResetLabel('2026-11-15T23:30:00Z')).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('numeros de cota', () => {
  it('monta o texto só com used e limit e não calcula remaining', () => {
    expect(quotaUsageText({ used: 2, limit: 30 })).toBe('2 de 30 análises usadas');
    expect(quotaUsageText({ used: 2 })).toBeNull();
    expect(quotaUsageText({ limit: 5 })).toBeNull();
    expect(isQuotaExhausted({ remaining: 0 })).toBe(true);
    expect(isQuotaExhausted({ remaining: 4 })).toBe(false);
    expect(isQuotaExhausted({})).toBe(false);
  });
});
