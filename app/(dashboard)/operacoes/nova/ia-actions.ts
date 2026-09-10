'use server';

import { createClient } from '@/lib/supabase/server';
import { exigirPerfil } from '@/lib/auth/roles';
import { IAError, TAMANHO_MAX_BYTES } from '@/lib/ia/client';
import { extrairOficio } from '@/lib/ia/extrair-oficio';
import { montarRevisao, type EnteOpcao, type RevisaoOficio } from '@/lib/ia/resolver';

export type ExtrairResult =
  | { ok: true; revisao: RevisaoOficio; custoTokens: { entrada: number; saida: number } }
  | { ok: false; error: string };

/**
 * Lê o ofício requisitório e devolve os campos pra revisão humana.
 *
 * Não grava nada. O retorno alimenta o painel de revisão do formulário; a
 * operação só nasce pelo `criarOperacao` de sempre, com os mesmos schemas.
 * Isso é proposital: a IA sugere, o Zod continua sendo a autoridade.
 */
export async function extrairDoOficio(formData: FormData): Promise<ExtrairResult> {
  // Chamada custa dinheiro por documento — mesma regra da Judit: checar perfil
  // ANTES de gastar, porque RLS só barraria na hora de gravar.
  const gate = await exigirPerfil(['admin', 'gestao', 'juridico', 'broker']);
  if (!gate.ok) return { ok: false, error: gate.error };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'Nenhum arquivo enviado.' };

  if (file.type !== 'application/pdf') {
    return { ok: false, error: 'Envie o ofício em PDF. Outros formatos ainda não são lidos.' };
  }
  if (file.size === 0) return { ok: false, error: 'O arquivo está vazio.' };
  if (file.size > TAMANHO_MAX_BYTES) {
    return {
      ok: false,
      error: `Arquivo tem ${(file.size / 1024 / 1024).toFixed(1)}MB — o limite é ${TAMANHO_MAX_BYTES / 1024 / 1024}MB. Envie só as páginas do ofício.`,
    };
  }

  // A lista de entes vem do banco (com RLS do usuário) porque o resolver precisa
  // casar o nome lido no PDF com um id real — e a esfera do ente é o que define
  // a esfera da operação.
  const supabase = await createClient();
  const { data: entes } = await supabase
    .from('entes_devedores')
    .select('id, nome, esfera')
    .eq('ativo', true)
    .returns<EnteOpcao[]>();

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { extracao, tokensEntrada, tokensSaida } = await extrairOficio(buffer, 'application/pdf');

    const revisao = montarRevisao(extracao, entes ?? []);

    if (!revisao.documentoReconhecido) {
      return {
        ok: false,
        error:
          'Este arquivo não parece ser um ofício requisitório. Confira se subiu o documento certo.',
      };
    }
    if (revisao.campos.length === 0) {
      return {
        ok: false,
        error: 'A IA não conseguiu extrair nenhum campo utilizável deste documento.',
      };
    }

    return {
      ok: true,
      revisao,
      custoTokens: { entrada: tokensEntrada, saida: tokensSaida },
    };
  } catch (e) {
    if (e instanceof IAError) return { ok: false, error: e.message };
    console.error('Falha ao extrair ofício:', e);
    return { ok: false, error: 'Falha ao ler o documento. Tente de novo.' };
  }
}
