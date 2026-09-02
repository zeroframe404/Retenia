import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names (`clsx`) and resolve Tailwind class conflicts
 * (`tailwind-merge`) — the standard shadcn/ui helper, used by every component here. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
