import type { AutorMensagem, ConversaResumo } from '@/lib/whatsapp/conversas';

export type ConversaLinha = Omit<ConversaResumo, 'ultima'> & {
  telefone: string;
  nome_perfil: string | null;
  janela_expira_em: string | null;
  pausado_motivo: string | null;
  lead: { id: string; nome: string; dono: { nome: string | null } | null } | null;
  /** Prévia na lista. Nula em conversa criada sem mensagem ainda. */
  ultima: { autor: AutorMensagem; conteudo: string | null; tipo: string } | null;
};

export type MensagemLinha = {
  id: string;
  direcao: 'entrada' | 'saida';
  autor: AutorMensagem;
  conteudo: string | null;
  tipo: string;
  template_nome: string | null;
  status_entrega: string | null;
  created_at: string;
  autor_usuario: { nome: string | null } | null;
};

export function nomeDaConversa(c: Pick<ConversaLinha, 'lead' | 'nome_perfil' | 'telefone'>) {
  return c.lead?.nome ?? c.nome_perfil ?? null;
}
