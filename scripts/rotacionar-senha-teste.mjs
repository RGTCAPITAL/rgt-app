/**
 * Troca a senha de todas as contas *.teste@rgtcapital.local e derruba as
 * sessões abertas delas (RGT-93).
 *
 *   node --env-file=.env.local scripts/rotacionar-senha-teste.mjs
 *
 * A senha nova é gerada aqui e nunca aparece na tela: vai direto pro
 * TEST_USER_PASSWORD do .env.local e pro clipboard (pbcopy), de onde você cola
 * na Vercel e no .env.local da outra máquina.
 *
 * Ordem importa: o .env.local é gravado ANTES de mexer no Supabase. Se o
 * script morrer no meio, a senha que está no arquivo é a que vale pras contas
 * já trocadas, e rodar de novo deixa tudo consistente.
 */

import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const ENV = '.env.local';
const DOMINIO_TESTE = /\.teste@rgtcapital\.local$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('Faltam variáveis do Supabase. Rode com --env-file=.env.local, de dentro de app/.');
  process.exit(1);
}

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, opcoes);

// Lista antes de gerar qualquer coisa: se a service role não funcionar, nada muda.
const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (error) {
  console.error(`Não consegui listar usuários: ${error.message}`);
  process.exit(1);
}
const contas = data.users.filter((u) => DOMINIO_TESTE.test(u.email ?? ''));
if (contas.length === 0) {
  console.error('Nenhuma conta *.teste encontrada. Projeto Supabase errado?');
  process.exit(1);
}

// 32 caracteres base64url: forte, e sem caractere que quebre o .env.
const senha = randomBytes(24).toString('base64url');

const env = readFileSync(ENV, 'utf8');
const linha = `TEST_USER_PASSWORD=${senha}`;
writeFileSync(
  ENV,
  /^TEST_USER_PASSWORD=.*$/m.test(env)
    ? env.replace(/^TEST_USER_PASSWORD=.*$/m, linha)
    : `${env.trimEnd()}\n${linha}\n`,
);
execFileSync('pbcopy', { input: senha });

let falhas = 0;
for (const conta of contas) {
  const { error: erroTroca } = await admin.auth.admin.updateUserById(conta.id, { password: senha });
  if (erroTroca) {
    console.error(`✗ ${conta.email}: ${erroTroca.message}`);
    falhas++;
    continue;
  }

  // Trocar a senha não invalida refresh token já emitido. Entrar com a senha
  // nova e sair com scope global é o jeito de derrubar todas as sessões.
  const cliente = createClient(url, anonKey, opcoes);
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email: conta.email,
    password: senha,
  });
  const { error: erroSaida } = erroLogin
    ? { error: erroLogin }
    : await cliente.auth.signOut({ scope: 'global' });
  if (erroSaida) {
    console.error(
      `! ${conta.email}: senha trocada, mas sessões não derrubadas (${erroSaida.message})`,
    );
    falhas++;
  } else {
    console.log(`✓ ${conta.email}`);
  }

  await new Promise((r) => setTimeout(r, 400)); // GoTrue limita logins por janela
}

console.log(
  `\n${contas.length - falhas}/${contas.length} contas ok. Senha nova no ${ENV} e no clipboard.`,
);
process.exit(falhas ? 1 : 0);
