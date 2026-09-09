import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  autenticarTodos,
  clienteComo,
  clienteServico,
  idDoUsuario,
  MARCA_TESTE,
  motivoSkip,
  podeRodarIntegracao,
} from './helpers/clientes-teste';

/**
 * Testes das garantias que moram no BANCO — policies de RLS e triggers.
 *
 * Por que existem: todas essas barreiras foram verificadas à mão durante a
 * auditoria (RGT-75), rodando SQL com JWT simulado. Nenhuma delas quebra o
 * build se alguém as enfraquecer numa migration futura. O trigger que impede
 * um broker de virar admin é a única coisa entre a aplicação e a escalação de
 * privilégio, e sumia em silêncio.
 *
 * Cada bloco abaixo nomeia a migration que criou a garantia, pra quem quebrar
 * um teste saber onde olhar.
 *
 * Rodam contra o banco real (não há Docker aqui). São seguros porque quase todos
 * verificam BLOQUEIO: se a barreira funciona, nada foi criado. O único que
 * escreve limpa o que criou no afterAll.
 */

if (!podeRodarIntegracao) console.warn(motivoSkip());

describe.skipIf(!podeRodarIntegracao)('RLS e triggers', () => {
  beforeAll(async () => {
    await autenticarTodos();
  });

  // ─── Escalação de privilégio (migration 007) ──────────────────────────────

  describe('bloquear_escalacao_privilegio', () => {
    it('broker não consegue se promover a admin', async () => {
      const broker = await clienteComo('broker');
      const brokerId = await idDoUsuario('broker');

      const { data: perfilAdmin } = await clienteServico()
        .from('perfis')
        .select('id')
        .eq('slug', 'admin')
        .single<{ id: string }>();

      const { data, error } = await broker
        .from('usuarios')
        .update({ perfil_id: perfilAdmin!.id })
        .eq('id', brokerId)
        .select('id');

      // Passa tanto se o trigger levantar exceção quanto se a RLS zerar o
      // update — o que não pode é a linha mudar.
      expect(error ?? data?.length === 0, 'broker conseguiu mudar o próprio perfil').toBeTruthy();

      const { data: depois } = await clienteServico()
        .from('usuarios')
        .select('perfil:perfis(slug)')
        .eq('id', brokerId)
        .single<{ perfil: { slug: string } }>();
      expect(depois?.perfil.slug, 'perfil do broker foi alterado').toBe('broker');
    });

    it('broker não consegue promover outro usuário', async () => {
      const broker = await clienteComo('broker');
      const juridicoId = await idDoUsuario('juridico');

      const { data: perfilAdmin } = await clienteServico()
        .from('perfis')
        .select('id')
        .eq('slug', 'admin')
        .single<{ id: string }>();

      await broker.from('usuarios').update({ perfil_id: perfilAdmin!.id }).eq('id', juridicoId);

      const { data: depois } = await clienteServico()
        .from('usuarios')
        .select('perfil:perfis(slug)')
        .eq('id', juridicoId)
        .single<{ perfil: { slug: string } }>();
      expect(depois?.perfil.slug, 'jurídico foi promovido por um broker').toBe('juridico');
    });
  });

  // ─── Último admin (migrations 018/019) ────────────────────────────────────

  // ─── Inventário: nenhuma barreira pode sumir em silêncio ──────────────────

  describe('inventário de garantias', () => {
    it('todas as barreiras de segurança seguem no lugar', async () => {
      // Nem toda garantia pode ser exercitada aqui: provar
      // `garantir_admin_remanescente` de verdade exigiria desativar admins num
      // banco compartilhado. Para essas, verificamos a PRESENÇA — o que pega o
      // modo de falha real, que é alguém dropar numa migration futura.
      const admin = await clienteComo('admin');
      const { data, error } = await admin.rpc('inventario_garantias');
      expect(error).toBeNull();

      const itens = data as unknown as {
        categoria: string;
        nome: string;
        existe: boolean;
      }[];
      expect(itens.length).toBeGreaterThan(15);

      const ausentes = itens.filter((i) => !i.existe).map((i) => `${i.categoria}:${i.nome}`);
      expect(ausentes, `garantias ausentes no banco: ${ausentes.join(', ')}`).toEqual([]);
    });
  });

  // ─── Consulta Judit paga (migration 018) ──────────────────────────────────

  describe('dd_judit_consultas', () => {
    it('jurídico não consegue forjar a autoria de uma consulta', async () => {
      const juridico = await clienteComo('juridico');
      const outroId = await idDoUsuario('gestao');

      const { error } = await juridico.from('dd_judit_consultas').insert({
        operacao_id: null,
        numero_processo: '00011073320175190001',
        tipo_consulta: 'processo',
        payload_bruto: { [MARCA_TESTE]: true },
        status: 'ok',
        criado_por: outroId, // atribuindo a consulta a outra pessoa
      });

      expect(error, 'consegiu gravar consulta em nome de outro usuário').toBeTruthy();
    });

    it('broker não consegue registrar consulta Judit', async () => {
      const broker = await clienteComo('broker');
      const brokerId = await idDoUsuario('broker');

      const { error } = await broker.from('dd_judit_consultas').insert({
        operacao_id: null,
        numero_processo: '00011073320175190001',
        tipo_consulta: 'processo',
        payload_bruto: { [MARCA_TESTE]: true },
        status: 'ok',
        criado_por: brokerId,
      });

      expect(error, 'broker gravou consulta Judit').toBeTruthy();
    });
  });

  // ─── Totais do pipeline (migration 023) ───────────────────────────────────

  describe('totais_pipeline()', () => {
    it('some por perfil: broker não enxerga o total do workspace', async () => {
      const admin = await clienteComo('admin');
      const broker = await clienteComo('broker');

      const { data: totalAdmin } = await admin.rpc('totais_pipeline');
      const { data: totalBroker } = await broker.rpc('totais_pipeline');

      const linhaAdmin = (totalAdmin as unknown as { abertas: number }[])?.[0];
      const linhaBroker = (totalBroker as unknown as { abertas: number }[])?.[0];

      expect(linhaAdmin, 'admin não recebeu totais').toBeTruthy();
      expect(linhaBroker, 'broker não recebeu totais').toBeTruthy();

      // Se a função virar SECURITY DEFINER, os dois números se igualam e a
      // soma do workspace vaza pro broker.
      expect(
        Number(linhaBroker!.abertas),
        'broker enxergou o mesmo total do admin — totais_pipeline() virou SECURITY DEFINER?',
      ).toBeLessThan(Number(linhaAdmin!.abertas));
    });
  });

  // ─── Integridade do CNJ (migration 025) ───────────────────────────────────

  describe('operacoes · CNJ', () => {
    /**
     * Linha mínima que satisfaz TODAS as outras constraints de `operacoes`.
     * Sem isso o insert falha por outro motivo e o teste passaria por acidente —
     * foi o que aconteceu na primeira versão: o caso da duplicata continuava
     * verde mesmo com o índice único dropado.
     */
    function operacaoValida(numero_processo: string, sufixo: string, donoId: string) {
      return {
        numero_processo,
        cedente_nome: `${MARCA_TESTE} ${sufixo}`,
        cedente_cpf: '52998224725',
        tipo: 'precatorio' as const,
        natureza: 'alimentar' as const,
        especie: 'credito_total' as const,
        tribunal: 'TJAL - Tribunal de Justiça de Alagoas',
        esfera: 'estadual' as const,
        valor_total: 1000,
        valor_principal: 600,
        valor_juros: 300,
        valor_selic: 100,
        data_base: '2026-01-01',
        dono_id: donoId,
        etapa_atual: 'precificacao' as const,
      };
    }

    it('recusa CNJ que não tem 20 dígitos', async () => {
      const admin = await clienteComo('admin');
      const adminId = await idDoUsuario('admin');
      const { error } = await admin
        .from('operacoes')
        .insert(operacaoValida('nao-e-um-cnj', 'lixo', adminId));

      expect(error, 'CNJ inválido foi aceito').toBeTruthy();
      // 23514 = check_violation. Se vier outro código, a linha foi barrada por
      // outra razão e este teste não está provando o que diz provar.
      expect(error!.code, `barrado por ${error!.code}: ${error!.message}`).toBe('23514');
    });

    it('recusa o mesmo processo em máscara diferente', async () => {
      const admin = await clienteComo('admin');
      const adminId = await idDoUsuario('admin');
      const { data: existente } = await clienteServico()
        .from('operacoes')
        .select('numero_processo')
        .limit(1)
        .single<{ numero_processo: string }>();

      const mesmoCnjOutraMascara = existente!.numero_processo.replace(/\D/g, '');

      const { error } = await admin
        .from('operacoes')
        .insert(operacaoValida(mesmoCnjOutraMascara, 'duplicata', adminId));

      expect(error, 'duplicata de processo foi aceita').toBeTruthy();
      // 23505 = unique_violation. Com o índice normalizado dropado, o insert
      // passaria — é exatamente essa regressão que o teste precisa pegar.
      expect(error!.code, `barrado por ${error!.code}: ${error!.message}`).toBe('23505');
    });
  });

  // ─── Ente devedor (migration 025) ─────────────────────────────────────────

  describe('entes_devedores', () => {
    it('nem admin apaga ente devedor', async () => {
      const admin = await clienteComo('admin');
      const { data: ente } = await clienteServico()
        .from('entes_devedores')
        .select('id, nome')
        .limit(1)
        .single<{ id: string; nome: string }>();

      await admin.from('entes_devedores').delete().eq('id', ente!.id);

      const { data: aindaExiste } = await clienteServico()
        .from('entes_devedores')
        .select('id')
        .eq('id', ente!.id)
        .maybeSingle();
      expect(
        aindaExiste,
        `ente ${ente!.nome} foi apagado — o histórico das operações se perde`,
      ).toBeTruthy();
    });
  });

  // ─── Visibilidade do pipeline comercial (migration 015) ───────────────────

  describe('prospeccao_precatorios', () => {
    it('broker não consegue importar lote', async () => {
      const broker = await clienteComo('broker');
      const { error } = await broker.from('prospeccao_precatorios').insert({
        numero_processo: '99999999999999999999',
        tribunal: 'TRT19',
        fonte_lote: MARCA_TESTE,
      });
      expect(error, 'broker importou prospecção').toBeTruthy();
    });
  });

  afterAll(async () => {
    // Rede de segurança: nada acima deveria conseguir escrever, mas se alguma
    // barreira estiver quebrada o teste falha E o resíduo é removido.
    const servico = clienteServico();
    await servico.from('prospeccao_precatorios').delete().eq('fonte_lote', MARCA_TESTE);
    await servico.from('operacoes').delete().like('cedente_nome', `${MARCA_TESTE}%`);
    await servico
      .from('dd_judit_consultas')
      .delete()
      .contains('payload_bruto', { [MARCA_TESTE]: true });
  });
});
