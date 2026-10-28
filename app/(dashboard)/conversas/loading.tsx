import { Spinner } from '@/components/ui/spinner';

export default function Loading() {
  return (
    <div>
      <div className="mb-8 h-24 animate-pulse rounded-xl bg-neutral-100" />
      <div className="flex h-[calc(100dvh-20rem)] min-h-[28rem] items-center justify-center rounded-lg border border-neutral-200 bg-white text-sm text-neutral-500">
        <Spinner size={5} className="text-primary mr-2" />
        Carregando conversas…
      </div>
    </div>
  );
}
