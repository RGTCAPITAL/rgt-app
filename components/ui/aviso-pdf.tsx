import Link from 'next/link';
import { FileText, ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

/**
 * Mostrado quando alguém escolhe um PDF numa tela que espera planilha.
 *
 * Existe porque a leitura de ofício requisitório por IA mora dentro do
 * formulário de nova operação, e ninguém adivinha isso. Quem tem um PDF de
 * precatório na mão tenta a tela de importar — que é o palpite certo pelo
 * nome, e o errado pelo sistema.
 *
 * Antes o `accept` do input filtrava PDF no seletor do sistema: o arquivo
 * aparecia cinza e não dava nem pra escolher, sem nenhuma explicação. Agora
 * o PDF entra e a tela diz pra onde ir.
 */
export function AvisoPdf({ nomeArquivo }: { nomeArquivo: string }) {
  return (
    <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4">
      <div className="flex gap-3">
        <FileText className="mt-0.5 size-5 shrink-0 text-blue-700" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-blue-900">
            Isso é um PDF, e esta tela só lê planilha
          </div>
          <p className="mt-1 text-sm text-blue-800">
            Se <strong className="break-all">{nomeArquivo}</strong> for um ofício requisitório ou
            uma certidão de precatório, o lugar dele é em Nova Operação. Lá a inteligência
            artificial lê o documento e preenche os campos do cadastro sozinha, mostrando de onde
            tirou cada informação.
          </p>
          <Link
            href="/operacoes/nova"
            className={buttonVariants({ size: 'sm', className: 'mt-3' })}
          >
            Ir pra Nova Operação
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
