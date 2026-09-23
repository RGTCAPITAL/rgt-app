'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { titleCase } from '@/lib/formatters';
import { ORIGEM_LEAD } from '@/lib/leads';
import {
  chaveDedup,
  cnjValido,
  normalizarTexto,
  parseDinheiroBR,
  somenteDigitos,
  texto,
  type LinhaImport,
} from '@/lib/leads-import';

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Importação de planilha de leads.
 *
 * Mora fora de `actions.ts` porque cresceu: além de inserir, precisa conferir
 * duplicata contra duas tabelas antes de gravar.
 *
 * Decisão de produto embutida aqui: **importar nunca é o mesmo que abordar**.
 * A planilha entra com `status = 'novo'` e o contato é um ato separado, feito
 * por uma pessoa. É o que mantém a operação dentro das regras da Meta, da LGPD
 * e da OAB. Ver RGT-OS/knowledge/demandas-renato-contato-massa-2026-09-23.md
 */

const VINCULOS = ['cliente_mandato_vigente', 'ex_cliente', 'lead_frio', 'opt_in'] as const;
export type Vinculo = (typeof VINCULOS)[number];

const BASE_POR_VINCULO: Record<Vinculo, string> = {
  cliente_mandato_vigente: 'execucao_contrato',
  ex_cliente: 'legitimo_interesse',
  lead_frio: 'legitimo_interesse',
  opt_in: 'consentimento',
};

const ORIGENS_VALIDAS = new Set<string>([
  ...ORIGEM_LEAD.map((o) => o.value),
  'importacao_planilha',
  'lista_processual',
]);

const LIMITE_LINHAS = 1000;

/** Insert em blocos: uma linha ruim não pode zerar as outras 999. */
const TAMANHO_CHUNK = 50;

async function exigirImportador(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Sessão expirada.' };

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('perfil:perfis(slug)')
    .eq('id', user.id)
    .single<{ perfil: { slug: string } | null }>();

  const role = usuario?.perfil?.slug;
  if (role !== 'admin' && role !== 'gestao') {
    return { ok: false as const, error: 'Apenas admin ou gestão pode importar em massa.' };
  }
  return { ok: true as const, userId: user.id, role };
}

export type LinhaConferida = {
  indice: number;
  /** Linha real na planilha, pro usuário achar o problema no arquivo dele. */
  linhaOrigem: number;
  nome: string;
  telefone: string | null;
  numero_processo: string | null;
  duplicataDe: { origem: 'lead' | 'prospeccao' | 'planilha'; motivo: string } | null;
  erro: string | null;
};

export type Conferencia = {
  novas: number;
  duplicadas: number;
  invalidas: number;
  linhas: LinhaConferida[];
};

/** Rejeita payload malformado antes de qualquer acesso a campo. */
function validarEntrada(rows: unknown): rows is LinhaImport[] {
  return Array.isArray(rows) && rows.every((r) => r !== null && typeof r === 'object');
}

/**
 * Confere a planilha contra o banco ANTES de inserir.
 *
 * Existe porque a versão anterior fazia `.insert()` puro: clicar duas vezes
 * criava tudo em dobro, e quem já estava na fila de prospecção do TRT19 virava
 * lead duplicado sem ninguém notar. Broker ligando duas vezes pra mesma pessoa
 * é erro que o cliente percebe.
 *
 * Os selects filtram pelas chaves da própria planilha em vez de varrer as
 * tabelas: PostgREST corta em 1000 linhas por padrão, e um `select()` nu
 * passaria a deduplicar parcialmente assim que a base crescer — falhando em
 * silêncio, que é o pior modo de falhar aqui.
 */
export async function conferirPlanilha(rows: LinhaImport[]): Promise<Result<Conferencia>> {
  const supabase = await createClient();
  const auth = await exigirImportador(supabase);
  if (!auth.ok) return auth;

  if (!validarEntrada(rows) || rows.length === 0) {
    return { ok: false, error: 'Planilha vazia ou inválida.' };
  }
  if (rows.length > LIMITE_LINHAS) {
    return { ok: false, error: `Limite de ${LIMITE_LINHAS} linhas por importação.` };
  }

  const cpfs = new Set<string>();
  const cnjs = new Set<string>();
  const tels = new Set<string>();
  for (const r of rows) {
    const cpf = somenteDigitos(r.cpf_cnpj);
    if (cpf) cpfs.add(cpf);
    const cnj = somenteDigitos(r.numero_processo);
    if (cnj) cnjs.add(cnj);
    const tel = somenteDigitos(r.telefone);
    if (tel) tels.add(tel);
  }

  // `leads` guarda CNJ e telefone como vieram (com máscara), então não dá pra
  // filtrar por dígitos no servidor. Busca por CPF (que gravamos normalizado)
  // e traz o resto com teto explícito — melhor um erro claro que um dedup
  // silenciosamente parcial.
  const { data: leadsExistentes, error: erroLeads } = await supabase
    .from('leads')
    .select('id, nome, cpf_cnpj, telefone, numero_processo')
    .limit(5000)
    .returns<
      {
        id: string;
        nome: string;
        cpf_cnpj: string | null;
        telefone: string | null;
        numero_processo: string | null;
      }[]
    >();

  if (erroLeads) {
    console.error('[import] falha ao conferir duplicatas em leads:', erroLeads);
    return {
      ok: false,
      error: 'Não consegui conferir duplicatas no CRM. Nada foi importado — tente de novo.',
    };
  }

  if ((leadsExistentes?.length ?? 0) >= 5000) {
    return {
      ok: false,
      error:
        'O CRM passou de 5.000 leads e a conferência de duplicata precisa ser ajustada. Me avise antes de importar.',
    };
  }

  // prospeccao_precatorios guarda CNJ normalizado — dá pra filtrar no servidor
  const cnjLista = Array.from(cnjs);
  let prospeccoes: {
    numero_processo: string;
    cedente_cpf_provavel: string | null;
    cedente_nome_provavel: string | null;
  }[] = [];

  if (cnjLista.length > 0 || cpfs.size > 0) {
    const filtros: string[] = [];
    if (cnjLista.length > 0) filtros.push(`numero_processo.in.(${cnjLista.join(',')})`);
    if (cpfs.size > 0) filtros.push(`cedente_cpf_provavel.in.(${Array.from(cpfs).join(',')})`);

    const { data, error: erroProsp } = await supabase
      .from('prospeccao_precatorios')
      .select('numero_processo, cedente_cpf_provavel, cedente_nome_provavel')
      .or(filtros.join(','))
      .returns<typeof prospeccoes>();

    if (erroProsp) {
      console.error('[import] falha ao conferir prospecção:', erroProsp);
      return {
        ok: false,
        error: 'Não consegui conferir a fila de prospecção. Nada foi importado — tente de novo.',
      };
    }
    prospeccoes = data ?? [];
  }

  const porCpf = new Map<string, string>();
  const porCnjTel = new Map<string, string>();
  const porTel = new Map<string, string>();

  for (const l of leadsExistentes ?? []) {
    const cpf = somenteDigitos(l.cpf_cnpj);
    if (cpf) porCpf.set(cpf, l.nome);
    const tel = somenteDigitos(l.telefone);
    const cnj = somenteDigitos(l.numero_processo);
    if (cnj && tel) porCnjTel.set(cnj + ':' + tel, l.nome);
    if (tel) porTel.set(tel, l.nome);
  }

  // Prospecção não tem telefone, então o segundo fator do par é o nome.
  // CNJ sozinho marcaria os 20 co-credores de um litisconsórcio como
  // duplicata — o erro que a regra do módulo existe pra evitar.
  const prospPorCpf = new Map<string, string>();
  const prospPorCnjNome = new Map<string, string>();
  for (const p of prospeccoes) {
    const cpf = somenteDigitos(p.cedente_cpf_provavel);
    if (cpf) prospPorCpf.set(cpf, p.cedente_nome_provavel ?? p.numero_processo);
    const cnj = somenteDigitos(p.numero_processo);
    const nome = normalizarTexto(p.cedente_nome_provavel ?? '');
    if (cnj && nome) prospPorCnjNome.set(cnj + ':' + nome, p.cedente_nome_provavel!);
  }

  // Planilha montada à mão repete linha com frequência
  const vistasNaPlanilha = new Set<string>();

  const linhas: LinhaConferida[] = rows.map((r, i) => {
    const nome = texto(r.nome);
    const cpf = somenteDigitos(r.cpf_cnpj);
    const tel = somenteDigitos(r.telefone);
    const processoBruto = texto(r.numero_processo);
    const cnj = somenteDigitos(processoBruto);

    const base: LinhaConferida = {
      indice: i,
      linhaOrigem: r.linhaOrigem ?? i + 2,
      nome: nome || '(sem nome)',
      telefone: tel || null,
      numero_processo: processoBruto || null,
      duplicataDe: null,
      erro: null,
    };

    if (nome.length < 2) return { ...base, erro: 'Nome ausente ou muito curto' };
    if (tel && (tel.length < 10 || tel.length > 13)) {
      return { ...base, erro: `Telefone com ${tel.length} dígitos` };
    }
    if (cpf && cpf.length !== 11 && cpf.length !== 14) {
      return { ...base, erro: 'CPF/CNPJ deve ter 11 ou 14 dígitos' };
    }
    const email = texto(r.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ...base, erro: 'Email mal formado' };
    }

    // Valida o campo PREENCHIDO, não os dígitos extraídos: "a definir" e "-"
    // produzem zero dígitos e escapariam da checagem, violando o CHECK do
    // banco na hora do insert e derrubando o lote inteiro.
    if (processoBruto && !cnjValido(cnj)) {
      return {
        ...base,
        erro:
          cnj.length === 0
            ? `Processo não parece um número: "${processoBruto}". Se ainda não tem, deixe a célula vazia.`
            : cnj.length === 20
              ? 'CNJ com dígito verificador inválido'
              : `CNJ com ${cnj.length} dígitos (esperado 20)`,
      };
    }

    if (r.valor_processo !== undefined && parseDinheiroBR(r.valor_processo) === null) {
      return { ...base, erro: `Valor não reconhecido: "${texto(r.valor_processo)}"` };
    }
    if (
      r.valor_proposta_indicativa !== undefined &&
      parseDinheiroBR(r.valor_proposta_indicativa) === null
    ) {
      return {
        ...base,
        erro: `Proposta não reconhecida: "${texto(r.valor_proposta_indicativa)}"`,
      };
    }

    const chave = chaveDedup(r);
    if (chave && vistasNaPlanilha.has(chave)) {
      return {
        ...base,
        duplicataDe: { origem: 'planilha', motivo: 'Linha repetida na própria planilha' },
      };
    }
    if (chave) vistasNaPlanilha.add(chave);

    if (cpf && porCpf.has(cpf)) {
      return { ...base, duplicataDe: { origem: 'lead', motivo: `CPF já em "${porCpf.get(cpf)}"` } };
    }
    if (cnj && tel && porCnjTel.has(cnj + ':' + tel)) {
      return {
        ...base,
        duplicataDe: {
          origem: 'lead',
          motivo: `Processo e telefone já em "${porCnjTel.get(cnj + ':' + tel)}"`,
        },
      };
    }
    if (!cpf && !cnj && tel && porTel.has(tel)) {
      return {
        ...base,
        duplicataDe: { origem: 'lead', motivo: `Telefone já em "${porTel.get(tel)}"` },
      };
    }
    if (cpf && prospPorCpf.has(cpf)) {
      return {
        ...base,
        duplicataDe: {
          origem: 'prospeccao',
          motivo: `Já na fila de prospecção (${prospPorCpf.get(cpf)})`,
        },
      };
    }
    const chaveProsp = cnj + ':' + normalizarTexto(nome);
    if (cnj && prospPorCnjNome.has(chaveProsp)) {
      return {
        ...base,
        duplicataDe: {
          origem: 'prospeccao',
          motivo: 'Mesma pessoa e mesmo processo já na fila de prospecção',
        },
      };
    }

    return base;
  });

  return {
    ok: true,
    data: {
      novas: linhas.filter((l) => !l.erro && !l.duplicataDe).length,
      duplicadas: linhas.filter((l) => l.duplicataDe).length,
      invalidas: linhas.filter((l) => l.erro).length,
      linhas,
    },
  };
}

export type OpcoesImport = {
  origem: string;
  vinculo: Vinculo;
  /** Null = sem dono (distribui depois). */
  donoId: string | null;
  lote: string;
  fonteReferencia: string;
  /** Índices (0-based) que o usuário decidiu importar mesmo sendo duplicata. */
  incluirDuplicadas: number[];
};

function opcoesValidas(o: unknown): o is OpcoesImport {
  if (!o || typeof o !== 'object') return false;
  const x = o as Record<string, unknown>;
  return (
    typeof x.origem === 'string' &&
    typeof x.vinculo === 'string' &&
    (x.donoId === null || typeof x.donoId === 'string') &&
    typeof x.lote === 'string' &&
    typeof x.fonteReferencia === 'string' &&
    Array.isArray(x.incluirDuplicadas) &&
    x.incluirDuplicadas.every((n) => typeof n === 'number' && Number.isInteger(n))
  );
}

/**
 * Insere as linhas conferidas.
 *
 * Reconfere tudo do zero em vez de confiar no que veio do cliente: o payload
 * da conferência passa pelo navegador e não é fonte confiável de validação.
 *
 * Grava em blocos porque um único statement multi-row aborta inteiro na
 * primeira violação de constraint — 83 linhas viravam zero, com mensagem de
 * Postgres em inglês, na frente do cliente.
 */
export async function importarPlanilha(
  rows: LinhaImport[],
  opcoes: OpcoesImport,
): Promise<Result<{ criados: number; puladas: number; erros: string[] }>> {
  const supabase = await createClient();
  const auth = await exigirImportador(supabase);
  if (!auth.ok) return auth;

  if (!opcoesValidas(opcoes)) return { ok: false, error: 'Opções de importação inválidas.' };
  if (!VINCULOS.includes(opcoes.vinculo)) return { ok: false, error: 'Vínculo inválido.' };
  if (!ORIGENS_VALIDAS.has(opcoes.origem)) return { ok: false, error: 'Origem inválida.' };

  const conf = await conferirPlanilha(rows);
  if (!conf.ok) return conf;

  const incluir = new Set(opcoes.incluirDuplicadas);
  const inserts: Record<string, unknown>[] = [];
  const erros: string[] = [];
  let puladas = 0;

  for (const l of conf.data!.linhas) {
    if (l.erro) {
      erros.push(`Linha ${l.linhaOrigem}: ${l.erro}`);
      continue;
    }
    if (l.duplicataDe && !incluir.has(l.indice)) {
      puladas++;
      continue;
    }

    const r = rows[l.indice]!;
    const processo = texto(r.numero_processo);

    inserts.push({
      nome: titleCase(texto(r.nome)),
      telefone: somenteDigitos(r.telefone) || null,
      email: texto(r.email) || null,
      cpf_cnpj: somenteDigitos(r.cpf_cnpj) || null,
      // Rede de segurança: com a validação acima, processo inválido nunca
      // chega aqui — mas o CHECK do banco derruba o bloco se chegar.
      numero_processo: somenteDigitos(processo).length === 20 ? processo : null,
      valor_processo: parseDinheiroBR(r.valor_processo),
      valor_proposta_indicativa: parseDinheiroBR(r.valor_proposta_indicativa),
      notas: texto(r.notas) || null,
      origem: opcoes.origem,
      vinculo: opcoes.vinculo,
      base_legal: BASE_POR_VINCULO[opcoes.vinculo],
      lote: opcoes.lote.trim() || null,
      fonte_referencia: opcoes.fonteReferencia.trim() || null,
      data_captura: new Date().toISOString(),
      status: 'novo',
      dono_id: opcoes.donoId,
    });
  }

  if (inserts.length === 0) {
    const detalhe = erros.length > 0 ? ' ' + erros.slice(0, 3).join(' · ') : '';
    return {
      ok: false,
      error: `Nada pra importar: ${puladas} duplicada(s), ${erros.length} inválida(s).${detalhe}`,
    };
  }

  let criados = 0;
  for (let i = 0; i < inserts.length; i += TAMANHO_CHUNK) {
    const bloco = inserts.slice(i, i + TAMANHO_CHUNK);
    const { error, count } = await supabase.from('leads').insert(bloco, { count: 'exact' });
    if (error) {
      console.error('[import] falha no bloco', i / TAMANHO_CHUNK, error);
      erros.push(
        `Um bloco de ${bloco.length} linhas foi recusado pelo banco. Os leads criados antes dele foram mantidos.`,
      );
      continue;
    }
    criados += count ?? bloco.length;
  }

  if (criados === 0) {
    return {
      ok: false,
      error: 'O banco recusou todos os registros. Nenhum lead foi criado — nada ficou pela metade.',
    };
  }

  revalidatePath('/crm');
  return { ok: true, data: { criados, puladas, erros } };
}
