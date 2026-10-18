import { describe, expect, it } from 'vitest';

import { formatCvUpdatedAt } from '../api/cv';

describe('formatCvUpdatedAt', () => {
  it('formata 2026-10-18T18:40:56Z em America/Sao_Paulo', () => {
    expect(formatCvUpdatedAt('2026-10-18T18:40:56Z')).toBe('18/10/2026 às 15h40');
  });

  it('oculta data ausente ou inválida', () => {
    expect(formatCvUpdatedAt(undefined)).toBeNull();
    expect(formatCvUpdatedAt(null)).toBeNull();
    expect(formatCvUpdatedAt('')).toBeNull();
    expect(formatCvUpdatedAt('nao-e-data')).toBeNull();
  });
});
