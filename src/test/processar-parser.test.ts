import { describe, expect, it } from 'vitest';

import {
  canOfferPdfDownload,
  fileNameFromPdfUrl,
  isPdfMagic,
  parseProcessarResponse,
} from '../api/processar';

const pdfUrl =
  'https://meu-agente-de-emprego.onrender.com/users/me/files/abc-123.pdf';

describe('parseProcessarResponse', () => {
  it('le os campos reais do POST /processar', () => {
    const result = parseProcessarResponse({
      texto_resposta: 'Analise ok',
      pdf_url: pdfUrl,
      user_id: 'user-1',
      match_score: 82,
      pdf_generated: true,
      generation_blocked: false,
    });

    expect(result.texto_resposta).toBe('Analise ok');
    expect(result.pdf_url).toBe(pdfUrl);
    expect(result.match_score).toBe(82);
    expect(canOfferPdfDownload(result)).toBe(true);
    expect(fileNameFromPdfUrl(result.pdf_url)).toBe('abc-123.pdf');
  });

  it('nao oferece PDF quando generation_blocked e true', () => {
    const result = parseProcessarResponse({
      texto_resposta: 'Match baixo',
      pdf_url: null,
      match_score: 20,
      pdf_generated: false,
      generation_blocked: true,
      blocked_reason: 'low_match_score',
    });

    expect(result.pdf_url).toBeNull();
    expect(result.generation_blocked).toBe(true);
    expect(canOfferPdfDownload(result)).toBe(false);
    expect(fileNameFromPdfUrl(result.pdf_url)).toBeNull();
  });

  it('nao oferece PDF se generation_blocked vier com pdf_url', () => {
    const result = parseProcessarResponse({
      pdf_url: pdfUrl,
      generation_blocked: true,
      pdf_generated: false,
    });
    expect(canOfferPdfDownload(result)).toBe(false);
  });

  it('extrai file_name so de /users/me/files/{file_name}', () => {
    expect(fileNameFromPdfUrl('/users/me/files/relatorio.pdf')).toBe(
      'relatorio.pdf',
    );
    expect(fileNameFromPdfUrl('https://cdn.example/other/relatorio.pdf')).toBeNull();
  });
});

describe('isPdfMagic', () => {
  it('aceita bytes %PDF e rejeita o resto', () => {
    const encoder = new TextEncoder();
    expect(isPdfMagic(encoder.encode('%PDF-1.4\n%...'))).toBe(true);
    expect(isPdfMagic(encoder.encode('<html></html>'))).toBe(false);
    expect(isPdfMagic(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
