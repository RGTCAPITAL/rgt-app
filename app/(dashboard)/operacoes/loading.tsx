import { Spinner } from '@/components/ui/spinner';

export default function Loading() {
  return (
    <div>
      <div className="mb-6">
        <div className="h-8 w-40 animate-pulse rounded-md bg-neutral-100" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded-md bg-neutral-100" />
      </div>
      <div className="mb-6 h-20 animate-pulse rounded-lg border border-neutral-200 bg-white" />
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <div className="flex items-center justify-center py-16 text-sm text-neutral-500">
          <Spinner size={5} className="text-primary mr-2" />
          Carregando operações…
        </div>
      </div>
    </div>
  );
}
