import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import {
  CV_FORM_MESSAGES,
  CV_LIMITS,
  CV_STRUCTURED_MAX_BYTES,
  buildCvPayload,
  collectPayloadKeys,
  collapseCvText,
  createEmptyDraft,
  currentCvMonth,
  draftFromStructured,
  fieldErrorFrom422,
  isCvMonth,
  isHttpsCvLink,
  loadStructuredCvForEdit,
  parseStructuredCvRead,
  parseStructuredCvWrite,
  payloadByteLength,
  pollCvEmbeddings,
  setStructuredCvTimingForTests,
  validateCvDraft,
  type CvFormDraft,
} from '../api/structuredCv';
import { CV_STRUCTURED_CONSENT_VERSION, type CvEstruturadoFormSource } from '../api/types';

const HIDDEN = [
  'email',
  'cv_file',
  'original_file',
  'object_key',
  'chroma_dir',
  'vector_store',
  'extracted_text_object_key',
  'extracted_text',
  'document_id',
  'version',
  'reason',
  'canonical_sha256',
  'key',
];

function resumo(length = 360): string {
  const unit = 'Atuação com entrega contínua de resultados reais. ';
  let text = '';
  while (text.length < length) {
    text += unit;
  }
  return text.slice(0, length);
}

function validDraft(patch: Partial<CvFormDraft> = {}): CvFormDraft {
  return {
    ...createEmptyDraft(),
    nome: 'Ana Silva',
    cidade: 'Campinas',
    uf: 'SP',
    modalidade: 'remoto',
    telefone: '(11) 98765-4321',
    cargosAlvo: ['Analista de dados'],
    senioridade: 'pleno',
    resumo: resumo(),
    primeiroEmprego: false,
    experiencias: [
      {
        key: 'exp-1',
        cargo: 'Analista de dados',
        empresa: 'Empresa Alfa',
        inicio: '2020-01',
        fim: '2024-06',
        atual: false,
        realizacoes: [
          'Entregou painel de indicadores usado pela operação.',
          'Reduziu retrabalho ao padronizar a extração dos dados.',
        ],
        tecnologias: ['Python'],
      },
    ],
    habilidadesTecnicas: ['Python', 'SQL', 'ETL'],
    consentimento: true,
    ...patch,
  };
}

describe('CV estruturado — validação e payload', () => {
  it('aceita o rascunho mínimo e envia só o contrato', () => {
    const draft = validDraft();
    expect(validateCvDraft(draft, new Date('2026-11-13T15:00:00-03:00'))).toEqual([]);
    const payload = buildCvPayload(draft);
    expect(payload.identificacao.telefone).toBe('11987654321');
    expect(payload.identificacao.nome).toBe('Ana Silva');
    expect(payload.consentimento).toEqual({
      aceito: true,
      versao_termo: CV_STRUCTURED_CONSENT_VERSION,
    });
    expect(payload.primeiro_emprego).toBe(false);
    expect(payload.experiencias[0]?.fim).toBe('2024-06');
    expect(payload.experiencias[0]?.atual).toBe(false);
    const keys = collectPayloadKeys(payload);
    for (const hidden of HIDDEN) {
      expect(keys.has(hidden)).toBe(false);
    }
  });

  it('colapsa espaços e preserva quebra de linha no resumo', () => {
    expect(collapseCvText('  Ana   Silva  ')).toBe('Ana Silva');
    const multiline = collapseCvText('linha  um\n\nlinha   dois', true);
    expect(multiline).toBe('linha um\n\nlinha dois');
    const draft = validDraft({
      nome: '  Ana   Silva ',
      resumo: `${resumo(300)}\n\n${' continua '.repeat(5)}`,
    });
    const payload = buildCvPayload(draft);
    expect(payload.identificacao.nome).toBe('Ana Silva');
    expect(payload.resumo).toContain('\n');
    expect(validateCvDraft(draft, new Date('2026-11-13T15:00:00-03:00'))).toEqual([]);
  });

  it('recusa nome com dígito, resumo curto, cargo duplicado e telefone fora do limite', () => {
    const now = new Date('2026-11-13T15:00:00-03:00');
    const errors = validateCvDraft(
      validDraft({
        nome: 'Ana 2',
        resumo: 'Curto demais.',
        cargosAlvo: ['Analista', 'analista'],
        telefone: '123',
      }),
      now,
    );
    expect(errors.map((error) => error.field)).toEqual(
      expect.arrayContaining(['nome', 'resumo', 'cargos_alvo', 'telefone']),
    );
    expect(errors.find((error) => error.field === 'nome')?.step).toBe('basico');
    expect(errors.find((error) => error.field === 'resumo')?.message).toBe(CV_FORM_MESSAGES.resumo);
  });

  it('exige início ≤ fim, sem data futura, e fim nulo quando o cargo é atual', () => {
    const now = new Date('2026-11-13T15:00:00-03:00');
    expect(currentCvMonth(now)).toBe('2026-11');
    expect(isCvMonth('1950-01', now)).toBe(true);
    expect(isCvMonth('1949-12', now)).toBe(false);
    expect(isCvMonth('2026-11', now)).toBe(true);
    expect(isCvMonth('2026-12', now)).toBe(false);

    const futuro = validateCvDraft(
      validDraft({
        experiencias: [
          {
            key: 'exp',
            cargo: 'Analista',
            empresa: 'Alfa',
            inicio: '2026-12',
            fim: '2026-12',
            atual: false,
            realizacoes: ['Fez um painel de indicadores.', 'Padronizou a extração.'],
            tecnologias: [],
          },
        ],
      }),
      now,
    );
    expect(futuro.some((error) => error.field === 'experiencias.0.inicio')).toBe(true);

    const invertido = validateCvDraft(
      validDraft({
        experiencias: [
          {
            key: 'exp',
            cargo: 'Analista',
            empresa: 'Alfa',
            inicio: '2024-06',
            fim: '2020-01',
            atual: false,
            realizacoes: ['Fez um painel de indicadores.', 'Padronizou a extração.'],
            tecnologias: [],
          },
        ],
      }),
      now,
    );
    expect(invertido.find((error) => error.message === CV_FORM_MESSAGES.inicioAfterFim)?.step).toBe(
      'experiencias',
    );

    const ambos = validateCvDraft(
      validDraft({
        experiencias: [
          {
            key: 'exp',
            cargo: 'Analista',
            empresa: 'Alfa',
            inicio: '2020-01',
            fim: '2024-06',
            atual: true,
            realizacoes: ['Fez um painel de indicadores.', 'Padronizou a extração.'],
            tecnologias: [],
          },
        ],
      }),
      now,
    );
    expect(ambos.some((error) => error.message === CV_FORM_MESSAGES.periodo)).toBe(true);

    const atual = validDraft({
      experiencias: [
        {
          key: 'exp',
          cargo: 'Analista',
          empresa: 'Alfa',
          inicio: '2020-01',
          fim: '',
          atual: true,
          realizacoes: ['Fez um painel de indicadores.', 'Padronizou a extração.'],
          tecnologias: [],
        },
      ],
    });
    expect(validateCvDraft(atual, now)).toEqual([]);
    expect(buildCvPayload(atual).experiencias[0]?.fim).toBeUndefined();
    expect(buildCvPayload(atual).experiencias[0]?.atual).toBe(true);
  });

  it('aceita primeiro emprego sem experiências e recusa os dois vazios', () => {
    const now = new Date('2026-11-13T15:00:00-03:00');
    const primeiro = validDraft({ primeiroEmprego: true, experiencias: [] });
    expect(validateCvDraft(primeiro, now)).toEqual([]);
    expect(buildCvPayload(primeiro).experiencias).toEqual([]);
    expect(buildCvPayload(primeiro).primeiro_emprego).toBe(true);

    const vazio = validateCvDraft(validDraft({ primeiroEmprego: false, experiencias: [] }), now);
    expect(vazio.find((error) => error.field === 'primeiro_emprego')?.step).toBe('experiencias');
  });

  it('formação exige conclusão ou em andamento, nunca os dois', () => {
    const now = new Date('2026-11-13T15:00:00-03:00');
    const base = {
      key: 'f1',
      curso: 'Ciência da Computação',
      instituicao: 'Unicamp',
      nivel: 'graduacao' as const,
    };
    expect(
      validateCvDraft(
        validDraft({
          formacoes: [{ ...base, conclusao: '', emAndamento: true }],
        }),
        now,
      ),
    ).toEqual([]);
    const ambos = validateCvDraft(
      validDraft({
        formacoes: [{ ...base, conclusao: '2020-12', emAndamento: true }],
      }),
      now,
    );
    expect(ambos.some((error) => error.field === 'formacoes.0.conclusao')).toBe(true);
    const payload = buildCvPayload(
      validDraft({ formacoes: [{ ...base, conclusao: '', emAndamento: true }] }),
    );
    expect(payload.formacoes[0]?.em_andamento).toBe(true);
    expect(payload.formacoes[0]?.conclusao).toBeUndefined();
  });

  it('links só https, sem IP, localhost, ponto final ou usuário e senha', () => {
    const now = new Date('2026-11-13T15:00:00-03:00');
    expect(isHttpsCvLink('https://exemplo.com/ana')).toBe(true);
    expect(isHttpsCvLink('https://exemplo.com./ana')).toBe(true);
    expect(isHttpsCvLink('https://notlocalhost.com/cv')).toBe(true);
    expect(isHttpsCvLink('http://exemplo.com')).toBe(false);
    expect(isHttpsCvLink('https://localhost/cv')).toBe(false);
    expect(isHttpsCvLink('https://localhost.')).toBe(false);
    expect(isHttpsCvLink('https://app.localhost/cv')).toBe(false);
    expect(isHttpsCvLink('https://app.localhost./cv')).toBe(false);
    expect(isHttpsCvLink('https://impressora.local/cv')).toBe(false);
    expect(isHttpsCvLink('https://127.0.0.1/cv')).toBe(false);
    expect(isHttpsCvLink('https://user:pass@exemplo.com/cv')).toBe(false);
    for (const url of [
      'http://exemplo.com',
      'https://localhost.',
      'https://app.localhost/cv',
      'https://impressora.local/cv',
    ]) {
      const errors = validateCvDraft(
        validDraft({ links: [{ key: 'l1', rotulo: '', url }] }),
        now,
      );
      const error = errors.find((item) => item.field === 'links.0.url');
      expect(error?.step).toBe('links');
      expect(error?.message).toBe(CV_FORM_MESSAGES.linkUrl);
    }
  });

  it('mapeia o 422 para o campo e o passo', () => {
    expect(
      fieldErrorFrom422({
        detail: [{ type: 'value_error', loc: ['body', 'resumo'], msg: 'tamanho invalido' }],
      }),
    ).toMatchObject({ field: 'resumo', step: 'resumo' });
    expect(
      fieldErrorFrom422({
        detail: [{ loc: ['body', 'experiencias', 0, 'inicio'], msg: 'data invalida' }],
      }),
    ).toMatchObject({ field: 'experiencias.0.inicio', step: 'experiencias' });
    expect(
      fieldErrorFrom422({
        detail: [{ loc: ['body', 'identificacao', 'cargos_alvo'], msg: 'duplicado' }],
      }),
    ).toMatchObject({ field: 'cargos_alvo', step: 'basico' });
    expect(
      fieldErrorFrom422({
        detail: [{ loc: ['body'], msg: 'informe experiencias ou marque primeiro emprego' }],
      }),
    ).toMatchObject({ field: 'primeiro_emprego', step: 'experiencias' });
    expect(
      fieldErrorFrom422({
        detail: [{ loc: ['body', 'formacoes', 1, 'nivel'], msg: 'faltou' }],
      }),
    ).toMatchObject({ field: 'formacoes.1.nivel', step: 'formacao' });
    expect(
      fieldErrorFrom422({
        detail: [{ loc: ['body', 'consentimento', 'aceito'], msg: 'obrigatorio' }],
      }),
    ).toMatchObject({ field: 'consentimento', step: 'revisao' });
  });

  it('não deixa o corpo passar de 64 KB', () => {
    const huge = validDraft({ resumo: 'a'.repeat(CV_LIMITS.resumoMax) });
    expect(payloadByteLength(buildCvPayload(huge))).toBeLessThan(CV_STRUCTURED_MAX_BYTES);
    const oversized = { ...buildCvPayload(huge), resumo: 'a'.repeat(70_000) };
    expect(payloadByteLength(oversized)).toBeGreaterThan(CV_STRUCTURED_MAX_BYTES);
  });

  it('descarta campos ocultos da resposta e preenche o rascunho com data', () => {
    const write = parseStructuredCvWrite({
      version: 4,
      document_id: 'doc-secreto',
      has_cv: true,
      has_embeddings: false,
      ready_for_analysis: false,
      reason: 'nao mostrar este motivo',
      cv_file: '/segredo/cv.txt',
      original_file: '/segredo/original.pdf',
      object_key: 'users/1/key',
      chroma_dir: '/segredo/chroma',
      vector_store: 'mongo',
      extracted_text_object_key: 'users/1/text',
    });
    expect(write).toEqual({
      has_cv: true,
      has_embeddings: false,
      ready_for_analysis: false,
    });
    expect(Object.keys(write)).toEqual(['has_cv', 'has_embeddings', 'ready_for_analysis']);

    const read = parseStructuredCvRead({
      version: 4,
      email: 'ana@example.com',
      updated_at: '2026-11-01T00:00:00Z',
      is_current: false,
      cv_file: '/segredo/cv.txt',
      object_key: 'users/1/key',
      data: {
        identificacao: {
          nome: 'Ana Silva',
          cidade: 'Campinas',
          uf: 'SP',
          modalidade: 'remoto',
          telefone: '11987654321',
          cargos_alvo: ['Analista de dados'],
          senioridade: 'pleno',
          cv_file: '/segredo/dentro',
        },
        resumo: resumo(),
        primeiro_emprego: false,
        experiencias: [
          {
            cargo: 'Analista',
            empresa: 'Alfa',
            inicio: '2020-01',
            fim: null,
            atual: true,
            realizacoes: ['Fez um painel.', 'Padronizou a extração.'],
            tecnologias: ['Python'],
            object_key: 'nao',
          },
        ],
        formacoes: [],
        cursos: [],
        habilidades_tecnicas: ['Python', 'SQL', 'ETL'],
        habilidades_comportamentais: [],
        idiomas: [],
        links: [],
      },
      consent: { versao_termo: CV_STRUCTURED_CONSENT_VERSION, accepted_at: '2026-11-01T00:00:00Z' },
    });
    expect(read.email).toBe('ana@example.com');
    expect(read.isCurrent).toBe(false);
    expect(JSON.stringify(read)).not.toMatch(/cv_file|object_key|version|segredo/);
    const draft = draftFromStructured(read);
    expect(draft.nome).toBe('Ana Silva');
    expect(draft.experiencias[0]?.atual).toBe(true);
    expect(draft.experiencias[0]?.fim).toBe('');
    expect(draft.consentimento).toBe(false);
  });
});

describe('CV estruturado — GET 409 e embeddings', () => {
  it('repete o GET 409 e desiste com mensagem de criar', async () => {
    setStructuredCvTimingForTests({ getRetryDelaysMs: [0, 0, 0] });
    const sleeps: number[] = [];
    let calls = 0;
    const pending: boolean[] = [];
    const result = await loadStructuredCvForEdit(
      async () => {
        calls += 1;
        throw new ApiError(409, null, 'ocupado');
      },
      {
        onPending: () => pending.push(true),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(result.kind).toBe('unavailable');
    expect(calls).toBe(4);
    expect(pending).toHaveLength(4);
    expect(sleeps).toEqual([0, 0, 0]);
  });

  it('no segundo GET 200 abre o currículo', async () => {
    setStructuredCvTimingForTests({ getRetryDelaysMs: [0, 0, 0] });
    let calls = 0;
    const source: CvEstruturadoFormSource = {
      email: 'ana@example.com',
      isCurrent: true,
      data: buildCvPayload(validDraft()),
    };
    const result = await loadStructuredCvForEdit(async () => {
      calls += 1;
      if (calls === 1) {
        throw new ApiError(409, null, 'ocupado');
      }
      return source;
    }, { sleep: async () => undefined });
    expect(result).toEqual({ kind: 'found', cv: source });
    expect(calls).toBe(2);
  });

  it('GET 404 abre vazio', async () => {
    const result = await loadStructuredCvForEdit(async () => {
      throw new ApiError(404, null, 'ausente');
    });
    expect(result.kind).toBe('missing');
  });

  it('consulta o status até has_embeddings', async () => {
    setStructuredCvTimingForTests({ pollDelaysMs: [0, 0] });
    const seen: boolean[] = [];
    let calls = 0;
    const ready = await pollCvEmbeddings(async () => {
      calls += 1;
      const has = calls >= 2;
      seen.push(has);
      return { has_cv: true, has_embeddings: has };
    }, { sleep: async () => undefined });
    expect(ready).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it('não usa o relógio local fora de America/Sao_Paulo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T02:30:00Z'));
    expect(currentCvMonth()).toBe('2026-10');
    vi.useRealTimers();
  });
});
