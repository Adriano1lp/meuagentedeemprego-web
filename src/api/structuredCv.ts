import {
  CV_STRUCTURED_CONSENT_VERSION,
  UF_CODES,
  type CvConsentimento,
  type CvCurso,
  type CvEstruturadoCreate,
  type CvEstruturadoData,
  type CvEstruturadoFormSource,
  type CvEstruturadoUpdate,
  type CvEstruturadoWritePublic,
  type CvExperiencia,
  type CvFormacao,
  type CvIdioma,
  type CvLink,
  type CvModalidade,
  type CvNivelFormacao,
  type CvNivelIdioma,
  type CvSenioridade,
  type UfCode,
} from './types';

/**
 * CV estruturado (W5b). Contrato: services/structured_cv.py da API,
 * master 9cc4938. O rascunho fica só em memória: este módulo não lê
 * nem grava localStorage ou sessionStorage.
 */

export const CV_STRUCTURED_PATH = '/users/me/cv/structured';
export const CV_STRUCTURED_MAX_BYTES = 64 * 1024;

export const CV_FORM_SAVED_LABEL = 'Currículo criado pelo formulário';
export const CV_FORM_PREPARING = 'Estamos preparando seu currículo…';
export const CV_FORM_READY = 'Pronto! Já pode analisar vagas.';
export const CV_FORM_REPLACE = 'Isso substitui seu currículo atual';
export const CV_FORM_NOT_CURRENT =
  'O currículo atual veio de um arquivo. Salvar pelo formulário vai substituí-lo.';
export const CV_FORM_LEAVE =
  'Se você sair agora, o rascunho do currículo será perdido.';
export const CV_FORM_OFFLINE = 'Sem conexão. Verifique sua internet.';
export const CV_FORM_UNAVAILABLE = 'Não foi possível salvar agora. Tente de novo.';
export const CV_FORM_TOO_LARGE = 'Não foi possível enviar o currículo. Tente de novo.';
export const CV_FORM_INVALID = 'Revise os dados e tente de novo.';
export const CV_FORM_RATE_LIMIT =
  'Muitas alterações seguidas. Aguarde para tentar de novo.';
export const CV_FORM_SESSION = 'Sessão expirada. Entre novamente para continuar.';
export const CV_FORM_EMBEDDINGS_FAILED =
  'Não foi possível concluir agora. Seus dados continuam aqui.';
export const CV_FORM_OPEN_FAILED = 'Não foi possível abrir o currículo agora.';

export const CV_LIMITS = {
  nome: 120,
  cidade: 80,
  telefoneMin: 10,
  telefoneMax: 13,
  cargosMin: 1,
  cargosMax: 3,
  cargoAlvo: 80,
  resumoMin: 300,
  resumoMax: 800,
  experienciasMax: 15,
  cargo: 100,
  empresa: 100,
  realizacoesMin: 2,
  realizacoesMax: 6,
  realizacao: 300,
  tecnologiasMax: 20,
  tecnologia: 40,
  formacoesMax: 10,
  curso: 120,
  instituicao: 120,
  cursosMax: 20,
  cargaMin: 1,
  cargaMax: 2000,
  habilidadesTecnicasMin: 3,
  habilidadesTecnicasMax: 30,
  habilidade: 50,
  habilidadesComportamentaisMax: 10,
  idiomasMax: 10,
  idioma: 40,
  linksMax: 5,
  rotulo: 40,
  url: 300,
  monthMin: '1950-01',
} as const;

export const CV_FORM_MESSAGES = {
  nomeRequired: 'Informe o nome.',
  nomeDigits: 'O nome não pode ter números.',
  nomeLength: 'O nome pode ter no máximo 120 caracteres.',
  cidadeRequired: 'Informe a cidade.',
  cidadeLength: 'A cidade pode ter no máximo 80 caracteres.',
  uf: 'Selecione a UF.',
  modalidade: 'Selecione a modalidade.',
  telefone: 'O telefone precisa ter de 10 a 13 dígitos.',
  cargosRequired: 'Informe de 1 a 3 cargos-alvo.',
  cargosLength: 'Cada cargo-alvo pode ter no máximo 80 caracteres.',
  cargosDuplicate: 'Não repita o mesmo cargo-alvo.',
  senioridade: 'Selecione a senioridade.',
  resumo: 'O resumo precisa ter entre 300 e 800 caracteres.',
  experienciaRequired: 'Informe ao menos uma experiência ou marque primeiro emprego.',
  cargoRequired: 'Informe o cargo.',
  cargoLength: 'O cargo pode ter no máximo 100 caracteres.',
  empresaRequired: 'Informe a empresa.',
  empresaLength: 'A empresa pode ter no máximo 100 caracteres.',
  periodo: 'Informe o fim ou marque como cargo atual.',
  date: 'Use um mês entre janeiro de 1950 e o mês atual.',
  inicioAfterFim: 'O início não pode ser depois do fim.',
  realizacoes: 'Informe de 2 a 6 realizações.',
  realizacaoLength: 'Cada realização pode ter no máximo 300 caracteres.',
  tecnologias: 'Informe no máximo 20 tecnologias.',
  tecnologiaLength: 'Cada tecnologia pode ter no máximo 40 caracteres.',
  experienciasMax: 'Informe no máximo 15 experiências.',
  cursoRequired: 'Informe o curso.',
  cursoLength: 'O curso pode ter no máximo 120 caracteres.',
  instituicaoRequired: 'Informe a instituição.',
  instituicaoLength: 'A instituição pode ter no máximo 120 caracteres.',
  nivel: 'Selecione o nível.',
  conclusao: 'Informe a conclusão ou marque em andamento.',
  formacoesMax: 'Informe no máximo 10 formações.',
  cursoNome: 'Informe o nome do curso.',
  carga: 'A carga horária precisa ficar entre 1 e 2000 horas.',
  cursosMax: 'Informe no máximo 20 cursos.',
  habilidadesTecnicas: 'Informe de 3 a 30 habilidades técnicas.',
  habilidadeLength: 'Cada habilidade pode ter no máximo 50 caracteres.',
  habilidadesComportamentais: 'Informe no máximo 10 habilidades comportamentais.',
  idiomaRequired: 'Informe o idioma.',
  idiomaLength: 'O idioma pode ter no máximo 40 caracteres.',
  idiomaNivel: 'Selecione o nível do idioma.',
  idiomasMax: 'Informe no máximo 10 idiomas.',
  linkUrl: 'Use um link https válido.',
  linkRotulo: 'O rótulo do link pode ter no máximo 40 caracteres.',
  linksMax: 'Informe no máximo 5 links.',
  consent: 'Confirme que podemos usar estes dados para montar seu currículo.',
  apiField: 'Revise este campo.',
} as const;

export const MODALIDADE_OPTIONS: readonly { value: CvModalidade; label: string }[] = [
  { value: 'presencial', label: 'Presencial' },
  { value: 'hibrido', label: 'Híbrido' },
  { value: 'remoto', label: 'Remoto' },
  { value: 'indiferente', label: 'Indiferente' },
];

export const SENIORIDADE_OPTIONS: readonly { value: CvSenioridade; label: string }[] = [
  { value: 'estagio', label: 'Estágio' },
  { value: 'junior', label: 'Júnior' },
  { value: 'pleno', label: 'Pleno' },
  { value: 'senior', label: 'Sênior' },
  { value: 'especialista', label: 'Especialista' },
  { value: 'lideranca', label: 'Liderança' },
];

export const NIVEL_FORMACAO_OPTIONS: readonly { value: CvNivelFormacao; label: string }[] = [
  { value: 'medio', label: 'Ensino médio' },
  { value: 'tecnico', label: 'Técnico' },
  { value: 'tecnologo', label: 'Tecnólogo' },
  { value: 'graduacao', label: 'Graduação' },
  { value: 'pos_graduacao', label: 'Pós-graduação' },
  { value: 'mba', label: 'MBA' },
  { value: 'mestrado', label: 'Mestrado' },
  { value: 'doutorado', label: 'Doutorado' },
];

export const NIVEL_IDIOMA_OPTIONS: readonly { value: CvNivelIdioma; label: string }[] = [
  { value: 'A1', label: 'Iniciante' },
  { value: 'A2', label: 'Básico' },
  { value: 'B1', label: 'Intermediário' },
  { value: 'B2', label: 'Intermediário avançado' },
  { value: 'C1', label: 'Avançado' },
  { value: 'C2', label: 'Proficiente' },
  { value: 'nativo', label: 'Nativo' },
];

export const UF_OPTIONS: readonly { value: UfCode; label: string }[] = [
  { value: 'AC', label: 'Acre' },
  { value: 'AL', label: 'Alagoas' },
  { value: 'AP', label: 'Amapá' },
  { value: 'AM', label: 'Amazonas' },
  { value: 'BA', label: 'Bahia' },
  { value: 'CE', label: 'Ceará' },
  { value: 'DF', label: 'Distrito Federal' },
  { value: 'ES', label: 'Espírito Santo' },
  { value: 'GO', label: 'Goiás' },
  { value: 'MA', label: 'Maranhão' },
  { value: 'MT', label: 'Mato Grosso' },
  { value: 'MS', label: 'Mato Grosso do Sul' },
  { value: 'MG', label: 'Minas Gerais' },
  { value: 'PA', label: 'Pará' },
  { value: 'PB', label: 'Paraíba' },
  { value: 'PR', label: 'Paraná' },
  { value: 'PE', label: 'Pernambuco' },
  { value: 'PI', label: 'Piauí' },
  { value: 'RJ', label: 'Rio de Janeiro' },
  { value: 'RN', label: 'Rio Grande do Norte' },
  { value: 'RS', label: 'Rio Grande do Sul' },
  { value: 'RO', label: 'Rondônia' },
  { value: 'RR', label: 'Roraima' },
  { value: 'SC', label: 'Santa Catarina' },
  { value: 'SP', label: 'São Paulo' },
  { value: 'SE', label: 'Sergipe' },
  { value: 'TO', label: 'Tocantins' },
];

export const CV_FORM_STEPS = [
  'basico',
  'resumo',
  'experiencias',
  'formacao',
  'cursos',
  'habilidades',
  'idiomas',
  'links',
  'revisao',
] as const;

export type CvFormStep = (typeof CV_FORM_STEPS)[number];

export const CV_FORM_STEP_LABELS: Record<CvFormStep, string> = {
  basico: 'Básico',
  resumo: 'Resumo',
  experiencias: 'Experiências',
  formacao: 'Formação',
  cursos: 'Cursos',
  habilidades: 'Habilidades',
  idiomas: 'Idiomas',
  links: 'Links',
  revisao: 'Revisão',
};

export type FieldError = {
  field: string;
  step: CvFormStep;
  message: string;
};

export type ExperienciaDraft = {
  key: string;
  cargo: string;
  empresa: string;
  inicio: string;
  fim: string;
  atual: boolean;
  realizacoes: string[];
  tecnologias: string[];
};

export type FormacaoDraft = {
  key: string;
  curso: string;
  instituicao: string;
  nivel: CvNivelFormacao | '';
  conclusao: string;
  emAndamento: boolean;
};

export type CursoDraft = {
  key: string;
  nome: string;
  instituicao: string;
  anoMes: string;
  cargaHoraria: string;
};

export type IdiomaDraft = {
  key: string;
  idioma: string;
  nivel: CvNivelIdioma | '';
};

export type LinkDraft = {
  key: string;
  rotulo: string;
  url: string;
};

export type CvFormDraft = {
  nome: string;
  cidade: string;
  uf: UfCode | '';
  modalidade: CvModalidade | '';
  telefone: string;
  cargosAlvo: string[];
  senioridade: CvSenioridade | '';
  resumo: string;
  primeiroEmprego: boolean;
  experiencias: ExperienciaDraft[];
  formacoes: FormacaoDraft[];
  cursos: CursoDraft[];
  habilidadesTecnicas: string[];
  habilidadesComportamentais: string[];
  idiomas: IdiomaDraft[];
  links: LinkDraft[];
  consentimento: boolean;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type CvTiming = {
  getRetryDelaysMs: readonly number[];
  pollDelaysMs: readonly number[];
};

const DEFAULT_TIMING: CvTiming = {
  getRetryDelaysMs: [1000, 2000, 4000],
  pollDelaysMs: [2000, 2000, 2000, 2000, 2000, 2000],
};

let timing: CvTiming = DEFAULT_TIMING;
let itemSeq = 0;

export function structuredCvTiming(): CvTiming {
  return timing;
}

/** Só testes. Sem argumento, volta ao intervalo de produção. */
export function setStructuredCvTimingForTests(next: Partial<CvTiming> | null): void {
  timing = next ? { ...DEFAULT_TIMING, ...next } : DEFAULT_TIMING;
}

function nextKey(): string {
  itemSeq += 1;
  return `item-${itemSeq}`;
}

export function collapseCvText(value: string, multiline = false): string {
  const withoutTags = value.replace(/<[^>]*>/g, '');
  if (!multiline) {
    return withoutTags.replace(/\s+/g, ' ').trim();
  }
  return withoutTags
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .trim();
}

export function cvTextLength(value: string, multiline = false): number {
  return collapseCvText(value, multiline).length;
}

export function currentCvMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  return `${year}-${month}`;
}

export function isCvMonth(value: string, now = new Date()): boolean {
  return MONTH.test(value) && value >= CV_LIMITS.monthMin && value <= currentCvMonth(now);
}

export function cvPhoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function labelOf<T extends string>(
  options: readonly { value: T; label: string }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? '';
}

export function emptyExperiencia(): ExperienciaDraft {
  return {
    key: nextKey(),
    cargo: '',
    empresa: '',
    inicio: '',
    fim: '',
    atual: false,
    realizacoes: ['', ''],
    tecnologias: [],
  };
}

export function emptyFormacao(): FormacaoDraft {
  return {
    key: nextKey(),
    curso: '',
    instituicao: '',
    nivel: '',
    conclusao: '',
    emAndamento: false,
  };
}

export function emptyCurso(): CursoDraft {
  return {
    key: nextKey(),
    nome: '',
    instituicao: '',
    anoMes: '',
    cargaHoraria: '',
  };
}

export function emptyIdioma(): IdiomaDraft {
  return { key: nextKey(), idioma: '', nivel: '' };
}

export function emptyLink(): LinkDraft {
  return { key: nextKey(), rotulo: '', url: '' };
}

export function createEmptyDraft(): CvFormDraft {
  return {
    nome: '',
    cidade: '',
    uf: '',
    modalidade: '',
    telefone: '',
    cargosAlvo: [],
    senioridade: '',
    resumo: '',
    primeiroEmprego: false,
    experiencias: [emptyExperiencia()],
    formacoes: [],
    cursos: [],
    habilidadesTecnicas: [],
    habilidadesComportamentais: [],
    idiomas: [],
    links: [],
    consentimento: false,
  };
}

function asEnum<T extends string>(
  options: readonly { value: T }[],
  value: unknown,
): T | '' {
  return options.some((option) => option.value === value) ? (value as T) : '';
}

function asUf(value: unknown): UfCode | '' {
  return UF_CODES.includes(value as UfCode) ? (value as UfCode) : '';
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

export function draftFromStructured(source: CvEstruturadoFormSource): CvFormDraft {
  const data = source.data;
  const ident = data.identificacao;
  const experiencias = data.experiencias.map((item) => ({
    key: nextKey(),
    cargo: item.cargo,
    empresa: item.empresa,
    inicio: item.inicio,
    fim: item.atual ? '' : (item.fim ?? ''),
    atual: item.atual === true,
    realizacoes: item.realizacoes.length > 0 ? [...item.realizacoes] : ['', ''],
    tecnologias: [...item.tecnologias],
  }));
  return {
    nome: ident.nome,
    cidade: ident.cidade,
    uf: ident.uf,
    modalidade: ident.modalidade,
    telefone: ident.telefone ?? '',
    cargosAlvo: [...ident.cargos_alvo],
    senioridade: ident.senioridade,
    resumo: data.resumo,
    primeiroEmprego: data.primeiro_emprego === true,
    experiencias: experiencias.length > 0 ? experiencias : [emptyExperiencia()],
    formacoes: data.formacoes.map((item) => ({
      key: nextKey(),
      curso: item.curso,
      instituicao: item.instituicao,
      nivel: item.nivel,
      conclusao: item.em_andamento ? '' : (item.conclusao ?? ''),
      emAndamento: item.em_andamento === true,
    })),
    cursos: data.cursos.map((item) => ({
      key: nextKey(),
      nome: item.nome,
      instituicao: item.instituicao ?? '',
      anoMes: item.ano_mes ?? '',
      cargaHoraria:
        typeof item.carga_horaria_h === 'number' ? String(item.carga_horaria_h) : '',
    })),
    habilidadesTecnicas: [...data.habilidades_tecnicas],
    habilidadesComportamentais: [...data.habilidades_comportamentais],
    idiomas: data.idiomas.map((item) => ({
      key: nextKey(),
      idioma: item.idioma,
      nivel: item.nivel,
    })),
    links: data.links.map((item) => ({
      key: nextKey(),
      rotulo: item.rotulo ?? '',
      url: item.url,
    })),
    consentimento: false,
  };
}

function pushError(
  errors: FieldError[],
  field: string,
  step: CvFormStep,
  message: string,
): void {
  errors.push({ field, step, message });
}

function validateBasico(draft: CvFormDraft, errors: FieldError[]): void {
  const nome = collapseCvText(draft.nome);
  if (!nome) {
    pushError(errors, 'nome', 'basico', CV_FORM_MESSAGES.nomeRequired);
  } else if (/\d/.test(nome) || !/[^\W\d_]/u.test(nome)) {
    pushError(errors, 'nome', 'basico', CV_FORM_MESSAGES.nomeDigits);
  } else if (nome.length > CV_LIMITS.nome) {
    pushError(errors, 'nome', 'basico', CV_FORM_MESSAGES.nomeLength);
  }

  const cidade = collapseCvText(draft.cidade);
  if (!cidade) {
    pushError(errors, 'cidade', 'basico', CV_FORM_MESSAGES.cidadeRequired);
  } else if (cidade.length > CV_LIMITS.cidade) {
    pushError(errors, 'cidade', 'basico', CV_FORM_MESSAGES.cidadeLength);
  }

  if (!draft.uf) {
    pushError(errors, 'uf', 'basico', CV_FORM_MESSAGES.uf);
  }
  if (!draft.modalidade) {
    pushError(errors, 'modalidade', 'basico', CV_FORM_MESSAGES.modalidade);
  }

  const digits = cvPhoneDigits(draft.telefone);
  if (draft.telefone.trim() && (digits.length < CV_LIMITS.telefoneMin || digits.length > CV_LIMITS.telefoneMax)) {
    pushError(errors, 'telefone', 'basico', CV_FORM_MESSAGES.telefone);
  }

  const cargos = draft.cargosAlvo.map((item) => collapseCvText(item)).filter(Boolean);
  if (cargos.length < CV_LIMITS.cargosMin || cargos.length > CV_LIMITS.cargosMax) {
    pushError(errors, 'cargos_alvo', 'basico', CV_FORM_MESSAGES.cargosRequired);
  }
  if (cargos.some((item) => item.length > CV_LIMITS.cargoAlvo)) {
    pushError(errors, 'cargos_alvo', 'basico', CV_FORM_MESSAGES.cargosLength);
  }
  const seen = new Set<string>();
  for (const cargo of cargos) {
    const key = cargo.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) {
      pushError(errors, 'cargos_alvo', 'basico', CV_FORM_MESSAGES.cargosDuplicate);
      break;
    }
    seen.add(key);
  }

  if (!draft.senioridade) {
    pushError(errors, 'senioridade', 'basico', CV_FORM_MESSAGES.senioridade);
  }
}

function validateResumo(draft: CvFormDraft, errors: FieldError[]): void {
  const length = cvTextLength(draft.resumo, true);
  if (length < CV_LIMITS.resumoMin || length > CV_LIMITS.resumoMax) {
    pushError(errors, 'resumo', 'resumo', CV_FORM_MESSAGES.resumo);
  }
}

function validateExperiencias(
  draft: CvFormDraft,
  errors: FieldError[],
  now: Date,
): void {
  if (draft.primeiroEmprego) {
    return;
  }
  if (draft.experiencias.length > CV_LIMITS.experienciasMax) {
    pushError(errors, 'experiencias', 'experiencias', CV_FORM_MESSAGES.experienciasMax);
  }
  if (draft.experiencias.length < 1) {
    pushError(errors, 'primeiro_emprego', 'experiencias', CV_FORM_MESSAGES.experienciaRequired);
    return;
  }
  draft.experiencias.forEach((item, index) => {
    const prefix = `experiencias.${index}`;
    const cargo = collapseCvText(item.cargo);
    const empresa = collapseCvText(item.empresa);
    if (!cargo) {
      pushError(errors, `${prefix}.cargo`, 'experiencias', CV_FORM_MESSAGES.cargoRequired);
    } else if (cargo.length > CV_LIMITS.cargo) {
      pushError(errors, `${prefix}.cargo`, 'experiencias', CV_FORM_MESSAGES.cargoLength);
    }
    if (!empresa) {
      pushError(errors, `${prefix}.empresa`, 'experiencias', CV_FORM_MESSAGES.empresaRequired);
    } else if (empresa.length > CV_LIMITS.empresa) {
      pushError(errors, `${prefix}.empresa`, 'experiencias', CV_FORM_MESSAGES.empresaLength);
    }
    if (!isCvMonth(item.inicio, now)) {
      pushError(errors, `${prefix}.inicio`, 'experiencias', CV_FORM_MESSAGES.date);
    }
    const temFim = item.fim.trim().length > 0;
    if (item.atual === temFim) {
      pushError(errors, `${prefix}.fim`, 'experiencias', CV_FORM_MESSAGES.periodo);
    } else if (temFim && !isCvMonth(item.fim, now)) {
      pushError(errors, `${prefix}.fim`, 'experiencias', CV_FORM_MESSAGES.date);
    } else if (temFim && isCvMonth(item.inicio, now) && item.inicio > item.fim) {
      pushError(errors, `${prefix}.inicio`, 'experiencias', CV_FORM_MESSAGES.inicioAfterFim);
    }
    const realizacoes = item.realizacoes
      .map((linha) => collapseCvText(linha, true))
      .filter(Boolean);
    if (realizacoes.length < CV_LIMITS.realizacoesMin || realizacoes.length > CV_LIMITS.realizacoesMax) {
      pushError(errors, `${prefix}.realizacoes`, 'experiencias', CV_FORM_MESSAGES.realizacoes);
    }
    if (realizacoes.some((linha) => linha.length > CV_LIMITS.realizacao)) {
      pushError(errors, `${prefix}.realizacoes`, 'experiencias', CV_FORM_MESSAGES.realizacaoLength);
    }
    const tecnologias = item.tecnologias.map((tech) => collapseCvText(tech)).filter(Boolean);
    if (tecnologias.length > CV_LIMITS.tecnologiasMax) {
      pushError(errors, `${prefix}.tecnologias`, 'experiencias', CV_FORM_MESSAGES.tecnologias);
    }
    if (tecnologias.some((tech) => tech.length > CV_LIMITS.tecnologia)) {
      pushError(errors, `${prefix}.tecnologias`, 'experiencias', CV_FORM_MESSAGES.tecnologiaLength);
    }
  });
}

function validateFormacoes(draft: CvFormDraft, errors: FieldError[], now: Date): void {
  if (draft.formacoes.length > CV_LIMITS.formacoesMax) {
    pushError(errors, 'formacoes', 'formacao', CV_FORM_MESSAGES.formacoesMax);
  }
  draft.formacoes.forEach((item, index) => {
    const prefix = `formacoes.${index}`;
    const curso = collapseCvText(item.curso);
    const instituicao = collapseCvText(item.instituicao);
    if (!curso) {
      pushError(errors, `${prefix}.curso`, 'formacao', CV_FORM_MESSAGES.cursoRequired);
    } else if (curso.length > CV_LIMITS.curso) {
      pushError(errors, `${prefix}.curso`, 'formacao', CV_FORM_MESSAGES.cursoLength);
    }
    if (!instituicao) {
      pushError(errors, `${prefix}.instituicao`, 'formacao', CV_FORM_MESSAGES.instituicaoRequired);
    } else if (instituicao.length > CV_LIMITS.instituicao) {
      pushError(errors, `${prefix}.instituicao`, 'formacao', CV_FORM_MESSAGES.instituicaoLength);
    }
    if (!item.nivel) {
      pushError(errors, `${prefix}.nivel`, 'formacao', CV_FORM_MESSAGES.nivel);
    }
    const temConclusao = item.conclusao.trim().length > 0;
    if (item.emAndamento === temConclusao) {
      pushError(errors, `${prefix}.conclusao`, 'formacao', CV_FORM_MESSAGES.conclusao);
    } else if (temConclusao && !isCvMonth(item.conclusao, now)) {
      pushError(errors, `${prefix}.conclusao`, 'formacao', CV_FORM_MESSAGES.date);
    }
  });
}

function validateCursos(draft: CvFormDraft, errors: FieldError[], now: Date): void {
  if (draft.cursos.length > CV_LIMITS.cursosMax) {
    pushError(errors, 'cursos', 'cursos', CV_FORM_MESSAGES.cursosMax);
  }
  draft.cursos.forEach((item, index) => {
    const prefix = `cursos.${index}`;
    const nome = collapseCvText(item.nome);
    if (!nome) {
      pushError(errors, `${prefix}.nome`, 'cursos', CV_FORM_MESSAGES.cursoNome);
    } else if (nome.length > CV_LIMITS.curso) {
      pushError(errors, `${prefix}.nome`, 'cursos', CV_FORM_MESSAGES.cursoLength);
    }
    const instituicao = collapseCvText(item.instituicao);
    if (instituicao.length > CV_LIMITS.instituicao) {
      pushError(errors, `${prefix}.instituicao`, 'cursos', CV_FORM_MESSAGES.instituicaoLength);
    }
    if (item.anoMes.trim() && !isCvMonth(item.anoMes, now)) {
      pushError(errors, `${prefix}.ano_mes`, 'cursos', CV_FORM_MESSAGES.date);
    }
    if (item.cargaHoraria.trim()) {
      const carga = Number(item.cargaHoraria);
      if (!Number.isInteger(carga) || carga < CV_LIMITS.cargaMin || carga > CV_LIMITS.cargaMax) {
        pushError(errors, `${prefix}.carga_horaria_h`, 'cursos', CV_FORM_MESSAGES.carga);
      }
    }
  });
}

function validateSkillList(
  items: string[],
  field: string,
  min: number,
  max: number,
  requiredMessage: string,
  errors: FieldError[],
): void {
  const clean = items.map((item) => collapseCvText(item)).filter(Boolean);
  if (clean.length < min || clean.length > max) {
    pushError(errors, field, 'habilidades', requiredMessage);
  }
  if (clean.some((item) => item.length > CV_LIMITS.habilidade)) {
    pushError(errors, field, 'habilidades', CV_FORM_MESSAGES.habilidadeLength);
  }
}

function validateIdiomas(draft: CvFormDraft, errors: FieldError[]): void {
  if (draft.idiomas.length > CV_LIMITS.idiomasMax) {
    pushError(errors, 'idiomas', 'idiomas', CV_FORM_MESSAGES.idiomasMax);
  }
  draft.idiomas.forEach((item, index) => {
    const idioma = collapseCvText(item.idioma);
    if (!idioma) {
      pushError(errors, `idiomas.${index}.idioma`, 'idiomas', CV_FORM_MESSAGES.idiomaRequired);
    } else if (idioma.length > CV_LIMITS.idioma) {
      pushError(errors, `idiomas.${index}.idioma`, 'idiomas', CV_FORM_MESSAGES.idiomaLength);
    }
    if (!item.nivel) {
      pushError(errors, `idiomas.${index}.nivel`, 'idiomas', CV_FORM_MESSAGES.idiomaNivel);
    }
  });
}

export function isHttpsCvLink(value: string): boolean {
  const limpo = collapseCvText(value);
  if (!limpo || limpo.length > CV_LIMITS.url) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(limpo);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || !url.hostname) {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === 'localhost.localdomain') {
    return false;
  }
  if (host.includes(':')) {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map((part) => Number(part));
    if (parts.every((part) => part <= 255)) {
      return false;
    }
  }
  return true;
}

function validateLinks(draft: CvFormDraft, errors: FieldError[]): void {
  if (draft.links.length > CV_LIMITS.linksMax) {
    pushError(errors, 'links', 'links', CV_FORM_MESSAGES.linksMax);
  }
  draft.links.forEach((item, index) => {
    const rotulo = collapseCvText(item.rotulo);
    if (rotulo.length > CV_LIMITS.rotulo) {
      pushError(errors, `links.${index}.rotulo`, 'links', CV_FORM_MESSAGES.linkRotulo);
    }
    if (!isHttpsCvLink(item.url)) {
      pushError(errors, `links.${index}.url`, 'links', CV_FORM_MESSAGES.linkUrl);
    }
  });
}

export function validateCvDraft(draft: CvFormDraft, now = new Date()): FieldError[] {
  const errors: FieldError[] = [];
  validateBasico(draft, errors);
  validateResumo(draft, errors);
  validateExperiencias(draft, errors, now);
  validateFormacoes(draft, errors, now);
  validateCursos(draft, errors, now);
  validateSkillList(
    draft.habilidadesTecnicas,
    'habilidades_tecnicas',
    CV_LIMITS.habilidadesTecnicasMin,
    CV_LIMITS.habilidadesTecnicasMax,
    CV_FORM_MESSAGES.habilidadesTecnicas,
    errors,
  );
  validateSkillList(
    draft.habilidadesComportamentais,
    'habilidades_comportamentais',
    0,
    CV_LIMITS.habilidadesComportamentaisMax,
    CV_FORM_MESSAGES.habilidadesComportamentais,
    errors,
  );
  validateIdiomas(draft, errors);
  validateLinks(draft, errors);
  if (!draft.consentimento) {
    pushError(errors, 'consentimento', 'revisao', CV_FORM_MESSAGES.consent);
  }
  return errors;
}

export function validateCvStep(
  draft: CvFormDraft,
  step: CvFormStep,
  now = new Date(),
): FieldError[] {
  if (step === 'revisao') {
    return validateCvDraft(draft, now);
  }
  return validateCvDraft(draft, now).filter((error) => error.step === step);
}

export function firstFieldError(errors: FieldError[]): FieldError | null {
  if (errors.length === 0) {
    return null;
  }
  const ranked = [...errors].sort(
    (left, right) => CV_FORM_STEPS.indexOf(left.step) - CV_FORM_STEPS.indexOf(right.step),
  );
  return ranked[0] ?? null;
}

function experienciaPayload(item: ExperienciaDraft): CvExperiencia {
  const atual = item.atual === true;
  const payload: CvExperiencia = {
    cargo: collapseCvText(item.cargo),
    empresa: collapseCvText(item.empresa),
    inicio: item.inicio,
    atual,
    realizacoes: item.realizacoes
      .map((linha) => collapseCvText(linha, true))
      .filter(Boolean),
    tecnologias: item.tecnologias.map((tech) => collapseCvText(tech)).filter(Boolean),
  };
  if (!atual) {
    payload.fim = item.fim;
  }
  return payload;
}

function formacaoPayload(item: FormacaoDraft): CvFormacao {
  const payload: CvFormacao = {
    curso: collapseCvText(item.curso),
    instituicao: collapseCvText(item.instituicao),
    nivel: item.nivel as CvNivelFormacao,
    em_andamento: item.emAndamento === true,
  };
  if (!item.emAndamento) {
    payload.conclusao = item.conclusao;
  }
  return payload;
}

function cursoPayload(item: CursoDraft): CvCurso {
  const payload: CvCurso = { nome: collapseCvText(item.nome) };
  const instituicao = collapseCvText(item.instituicao);
  if (instituicao) {
    payload.instituicao = instituicao;
  }
  if (item.anoMes.trim()) {
    payload.ano_mes = item.anoMes;
  }
  if (item.cargaHoraria.trim()) {
    payload.carga_horaria_h = Number(item.cargaHoraria);
  }
  return payload;
}

function idiomaPayload(item: IdiomaDraft): CvIdioma {
  return {
    idioma: collapseCvText(item.idioma),
    nivel: item.nivel as CvNivelIdioma,
  };
}

function linkPayload(item: LinkDraft): CvLink {
  const payload: CvLink = { url: collapseCvText(item.url) };
  const rotulo = collapseCvText(item.rotulo);
  if (rotulo) {
    payload.rotulo = rotulo;
  }
  return payload;
}

export function buildCvPayload(draft: CvFormDraft): CvEstruturadoCreate {
  const telefone = cvPhoneDigits(draft.telefone);
  const identificacao: CvEstruturadoCreate['identificacao'] = {
    nome: collapseCvText(draft.nome),
    cidade: collapseCvText(draft.cidade),
    uf: draft.uf as UfCode,
    modalidade: draft.modalidade as CvModalidade,
    cargos_alvo: draft.cargosAlvo.map((item) => collapseCvText(item)).filter(Boolean),
    senioridade: draft.senioridade as CvSenioridade,
  };
  if (telefone) {
    identificacao.telefone = telefone;
  }
  const consentimento: CvConsentimento = {
    aceito: true,
    versao_termo: CV_STRUCTURED_CONSENT_VERSION,
  };
  return {
    identificacao,
    resumo: collapseCvText(draft.resumo, true),
    primeiro_emprego: draft.primeiroEmprego === true,
    experiencias: draft.primeiroEmprego ? [] : draft.experiencias.map(experienciaPayload),
    formacoes: draft.formacoes.map(formacaoPayload),
    cursos: draft.cursos.map(cursoPayload),
    habilidades_tecnicas: draft.habilidadesTecnicas
      .map((item) => collapseCvText(item))
      .filter(Boolean),
    habilidades_comportamentais: draft.habilidadesComportamentais
      .map((item) => collapseCvText(item))
      .filter(Boolean),
    idiomas: draft.idiomas.map(idiomaPayload),
    links: draft.links.map(linkPayload),
    consentimento,
  };
}

export function buildCvUpdatePayload(draft: CvFormDraft): CvEstruturadoUpdate {
  return buildCvPayload(draft);
}

export function payloadByteLength(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function payloadExceedsLimit(payload: unknown): boolean {
  return payloadByteLength(payload) > CV_STRUCTURED_MAX_BYTES;
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

export function parseStructuredCvWrite(payload: unknown): CvEstruturadoWritePublic {
  const record = asRecord(payload);
  if (!record) {
    throw new Error('Resposta de currículo em formato invalido');
  }
  return {
    has_cv: record.has_cv === true,
    has_embeddings: record.has_embeddings === true,
    ready_for_analysis: record.ready_for_analysis === true,
  };
}

function pickExperiencias(value: unknown): CvExperiencia[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.cargo !== 'string' || typeof record.empresa !== 'string') {
      return [];
    }
    const atual = record.atual === true;
    const experiencia: CvExperiencia = {
      cargo: record.cargo,
      empresa: record.empresa,
      inicio: typeof record.inicio === 'string' ? record.inicio : '',
      atual,
      realizacoes: asStringList(record.realizacoes),
      tecnologias: asStringList(record.tecnologias),
    };
    if (!atual && typeof record.fim === 'string') {
      experiencia.fim = record.fim;
    }
    return [experiencia];
  });
}

function pickFormacoes(value: unknown): CvFormacao[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.curso !== 'string' || typeof record.instituicao !== 'string') {
      return [];
    }
    const nivel = asEnum(NIVEL_FORMACAO_OPTIONS, record.nivel);
    if (!nivel) {
      return [];
    }
    const emAndamento = record.em_andamento === true;
    const formacao: CvFormacao = {
      curso: record.curso,
      instituicao: record.instituicao,
      nivel,
      em_andamento: emAndamento,
    };
    if (!emAndamento && typeof record.conclusao === 'string') {
      formacao.conclusao = record.conclusao;
    }
    return [formacao];
  });
}

function pickCursos(value: unknown): CvCurso[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.nome !== 'string') {
      return [];
    }
    const curso: CvCurso = { nome: record.nome };
    if (typeof record.instituicao === 'string' && record.instituicao.trim()) {
      curso.instituicao = record.instituicao;
    }
    if (typeof record.ano_mes === 'string' && record.ano_mes.trim()) {
      curso.ano_mes = record.ano_mes;
    }
    if (typeof record.carga_horaria_h === 'number' && Number.isFinite(record.carga_horaria_h)) {
      curso.carga_horaria_h = record.carga_horaria_h;
    }
    return [curso];
  });
}

function pickIdiomas(value: unknown): CvIdioma[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.idioma !== 'string') {
      return [];
    }
    const nivel = asEnum(NIVEL_IDIOMA_OPTIONS, record.nivel);
    if (!nivel) {
      return [];
    }
    return [{ idioma: record.idioma, nivel }];
  });
}

function pickLinks(value: unknown): CvLink[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.url !== 'string') {
      return [];
    }
    const link: CvLink = { url: record.url };
    if (typeof record.rotulo === 'string' && record.rotulo.trim()) {
      link.rotulo = record.rotulo;
    }
    return [link];
  });
}

export function parseStructuredCvRead(payload: unknown): CvEstruturadoFormSource {
  const record = asRecord(payload);
  const data = record ? asRecord(record.data) : null;
  const ident = data ? asRecord(data.identificacao) : null;
  if (!record || !data || !ident) {
    throw new Error('Resposta de currículo em formato invalido');
  }
  const uf = asUf(ident.uf);
  const modalidade = asEnum(MODALIDADE_OPTIONS, ident.modalidade);
  const senioridade = asEnum(SENIORIDADE_OPTIONS, ident.senioridade);
  if (!uf || !modalidade || !senioridade || typeof ident.nome !== 'string') {
    throw new Error('Resposta de currículo em formato invalido');
  }
  const parsed: CvEstruturadoData = {
    identificacao: {
      nome: ident.nome,
      cidade: typeof ident.cidade === 'string' ? ident.cidade : '',
      uf,
      modalidade,
      cargos_alvo: asStringList(ident.cargos_alvo),
      senioridade,
    },
    resumo: typeof data.resumo === 'string' ? data.resumo : '',
    primeiro_emprego: data.primeiro_emprego === true,
    experiencias: pickExperiencias(data.experiencias),
    formacoes: pickFormacoes(data.formacoes),
    cursos: pickCursos(data.cursos),
    habilidades_tecnicas: asStringList(data.habilidades_tecnicas),
    habilidades_comportamentais: asStringList(data.habilidades_comportamentais),
    idiomas: pickIdiomas(data.idiomas),
    links: pickLinks(data.links),
  };
  if (typeof ident.telefone === 'string' && ident.telefone.trim()) {
    parsed.identificacao.telefone = ident.telefone;
  }
  return {
    email: typeof record.email === 'string' ? record.email : '',
    data: parsed,
    isCurrent: typeof record.is_current === 'boolean' ? record.is_current : null,
  };
}

function stepForHead(head: unknown): CvFormStep {
  switch (head) {
    case 'identificacao':
      return 'basico';
    case 'resumo':
      return 'resumo';
    case 'experiencias':
    case 'primeiro_emprego':
      return 'experiencias';
    case 'formacoes':
      return 'formacao';
    case 'cursos':
      return 'cursos';
    case 'habilidades_tecnicas':
    case 'habilidades_comportamentais':
      return 'habilidades';
    case 'idiomas':
      return 'idiomas';
    case 'links':
      return 'links';
    case 'consentimento':
      return 'revisao';
    default:
      return 'revisao';
  }
}

function fieldForPath(path: unknown[]): string {
  const head = path[0];
  if (head === 'identificacao') {
    const leaf = path[1];
    return typeof leaf === 'string' ? leaf : 'nome';
  }
  if (head === 'resumo') {
    return 'resumo';
  }
  if (head === 'experiencias') {
    if (typeof path[1] === 'number') {
      const leaf = typeof path[2] === 'string' ? path[2] : 'fim';
      return `experiencias.${path[1]}.${leaf}`;
    }
    return 'primeiro_emprego';
  }
  if (head === 'primeiro_emprego') {
    return 'primeiro_emprego';
  }
  if (head === 'formacoes' && typeof path[1] === 'number') {
    const leaf = typeof path[2] === 'string' ? path[2] : 'conclusao';
    return `formacoes.${path[1]}.${leaf}`;
  }
  if (head === 'cursos' && typeof path[1] === 'number') {
    const leaf = typeof path[2] === 'string' ? path[2] : 'nome';
    return `cursos.${path[1]}.${leaf}`;
  }
  if (head === 'habilidades_tecnicas' || head === 'habilidades_comportamentais') {
    return head;
  }
  if (head === 'idiomas' && typeof path[1] === 'number') {
    const leaf = typeof path[2] === 'string' ? path[2] : 'idioma';
    return `idiomas.${path[1]}.${leaf}`;
  }
  if (head === 'links' && typeof path[1] === 'number') {
    const leaf = typeof path[2] === 'string' ? path[2] : 'url';
    return `links.${path[1]}.${leaf}`;
  }
  if (head === 'consentimento') {
    return 'consentimento';
  }
  if (path.length === 0) {
    return 'primeiro_emprego';
  }
  return 'consentimento';
}

export function fieldErrorFrom422(body: unknown): FieldError {
  const record = asRecord(body);
  const detail = record?.detail;
  const first = Array.isArray(detail) ? asRecord(detail[0]) : null;
  const loc = first && Array.isArray(first.loc) ? first.loc : [];
  const path = loc[0] === 'body' ? loc.slice(1) : loc;
  const head = path[0];
  const step = path.length === 0 ? 'experiencias' : stepForHead(head);
  const field = fieldForPath(path.length === 0 ? [] : path);
  const message =
    field === 'primeiro_emprego'
      ? CV_FORM_MESSAGES.experienciaRequired
      : CV_FORM_MESSAGES.apiField;
  return { field, step, message };
}

export function fieldDomId(field: string): string {
  return `cv-${field.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

export function errorStatusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export function retryAfterOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('retryAfterSeconds' in error)) {
    return null;
  }
  const value = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export type StructuredCvLoadResult =
  | { kind: 'found'; cv: CvEstruturadoFormSource }
  | { kind: 'missing' }
  | { kind: 'unavailable' };

export async function loadStructuredCvForEdit(
  getCv: () => Promise<CvEstruturadoFormSource>,
  options?: {
    onPending?: () => void;
    signal?: AbortSignal;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  },
): Promise<StructuredCvLoadResult> {
  const delays = structuredCvTiming().getRetryDelaysMs;
  const sleep = options?.sleep ?? sleepMs;
  let attempt = 0;
  while (true) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const cv = await getCv();
      return { kind: 'found', cv };
    } catch (error) {
      const status = errorStatusOf(error);
      if (status === 404) {
        return { kind: 'missing' };
      }
      if (status === 409) {
        options?.onPending?.();
        const delay = delays[attempt];
        if (delay === undefined) {
          return { kind: 'unavailable' };
        }
        attempt += 1;
        await sleep(delay, options?.signal);
        continue;
      }
      throw error;
    }
  }
}

export async function pollCvEmbeddings(
  getStatus: () => Promise<{ has_cv?: boolean; has_embeddings?: boolean }>,
  options?: {
    signal?: AbortSignal;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  },
): Promise<boolean> {
  const delays = structuredCvTiming().pollDelaysMs;
  const sleep = options?.sleep ?? sleepMs;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const status = await getStatus();
    if (status.has_cv === true && status.has_embeddings === true) {
      return true;
    }
    const delay = delays[attempt];
    if (delay === undefined) {
      return false;
    }
    await sleep(delay, options?.signal);
  }
  return false;
}

export function rateLimitMessage(seconds: number): string {
  if (seconds <= 0) {
    return CV_FORM_RATE_LIMIT;
  }
  const unit = seconds === 1 ? 'segundo' : 'segundos';
  return `Muitas alterações seguidas. Aguarde ${seconds} ${unit} para tentar de novo.`;
}

export function collectPayloadKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPayloadKeys(item, found);
    }
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.add(key);
      collectPayloadKeys(item, found);
    }
  }
  return found;
}
