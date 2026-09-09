import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clienteServico, motivoSkip, podeRodarIntegracao } from './helpers/clientes-teste';

/**
 * Garante que os arquivos de migration no git descrevem o banco de verdade.
 *
 * O risco que isto fecha (RGT-45) é concreto e já aconteceu: as migrations são
 * aplicadas via MCP e o arquivo é salvo depois, à mão. Nesta mesma sessão duas
 * migrations foram aplicadas e o arquivo esqueceu de ser criado — os índices de
 * performance e a RPC transacional do virarLead existiam só no banco. Quem
 * recriasse o ambiente pelo git teria um schema silenciosamente diferente.
 *
 * O teste compara a lista de versions dos arquivos com
 * `supabase_migrations.schema_migrations` e aponta os dois lados da divergência.
 */

const DIR_MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** O CLI do Supabase espera `<timestamp de 14 dígitos>_nome.sql`. */
const PADRAO_NOME = /^(\d{14})_[a-z0-9_]+\.sql$/;

function arquivosDeMigration(): string[] {
  return readdirSync(DIR_MIGRATIONS).filter((f) => f.endsWith('.sql'));
}

describe('migrations · arquivos', () => {
  it('todos seguem o padrão de nome do Supabase CLI', () => {
    const foraDoPadrao = arquivosDeMigration().filter((f) => !PADRAO_NOME.test(f));
    expect(foraDoPadrao, `arquivos que o CLI não reconheceria: ${foraDoPadrao.join(', ')}`).toEqual(
      [],
    );
  });

  it('não há timestamp repetido', () => {
    const versions = arquivosDeMigration().map((f) => f.slice(0, 14));
    const repetidos = versions.filter((v, i) => versions.indexOf(v) !== i);
    expect(repetidos, `timestamps duplicados: ${repetidos.join(', ')}`).toEqual([]);
  });
});

describe.skipIf(!podeRodarIntegracao)('migrations · arquivo x banco', () => {
  it('o git descreve exatamente o que está aplicado', async () => {
    // Via RPC: o schema supabase_migrations não é exposto pelo PostgREST, e
    // expor o schema inteiro só pra isso seria exagero (migration 029).
    const { data, error } = await clienteServico().rpc('migrations_aplicadas');

    expect(error, `não consegui ler o histórico de migrations: ${error?.message}`).toBeNull();

    const noBanco = new Set((data as unknown as { version: string }[]).map((m) => m.version));
    const nosArquivos = new Set(arquivosDeMigration().map((f) => f.slice(0, 14)));

    // Aplicado no banco mas sem arquivo: recriar o ambiente pelo git produz um
    // schema incompleto. Foi exatamente o que aconteceu com a 023 e a 024.
    const semArquivo = [...noBanco].filter((v) => !nosArquivos.has(v)).sort();

    // Arquivo que nunca foi aplicado: ou falta rodar, ou o registro se perdeu.
    const naoAplicado = [...nosArquivos].filter((v) => !noBanco.has(v)).sort();

    expect(semArquivo, `aplicadas no banco sem arquivo no git: ${semArquivo.join(', ')}`).toEqual(
      [],
    );
    expect(
      naoAplicado,
      `arquivos que não constam como aplicados: ${naoAplicado.join(', ')}`,
    ).toEqual([]);
  });
});

if (!podeRodarIntegracao) console.warn(motivoSkip());
