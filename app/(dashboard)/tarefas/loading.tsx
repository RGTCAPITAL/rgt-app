import { Spinner } from '@/components/ui/spinner';

export default function Loading() {
  return (
    <div>
      <div className="mb-6">
        <div className="h-8 w-32 animate-pulse rounded-md bg-neutral-100" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded-md bg-neutral-100" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-md border border-neutral-200 bg-white"
          />
        ))}
      </div>
      <div className="flex items-center justify-center py-16 text-sm text-neutral-500">
        <Spinner size={5} className="text-primary mr-2" />
        Carregando tarefas…
      </div>
    </div>
  );
}
