"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * Interruptor liga/desliga, em preto e branco. Envolve o Switch do Base UI
 * como o tabs.tsx faz com o Tabs: o estado vem em data-checked/data-unchecked.
 * 44×24 px pra dar pra acertar com o dedo no celular.
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-neutral-300 p-0.5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-neutral-900/30 data-checked:bg-neutral-900 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform data-checked:translate-x-5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
