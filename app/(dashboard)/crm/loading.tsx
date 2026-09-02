import { Spinner } from '@/components/ui/spinner';

export default function Loading() {
  return (
    <div>
      <div className="mb-6">
        <div className="h-8 w-24 animate-pulse rounded-md bg-neutral-100" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded-md bg-neutral-100" />
      </div>
      <div className="mb-4 h-16 animate-pulse rounded-lg border border-neutral-200 bg-white" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-6">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="flex min-h-[60vh] flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 p-2"
          >
            {i === 2 && <Spinner size={5} className="text-primary" />}
          </div>
        ))}
      </div>
    </div>
  );
}
