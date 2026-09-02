import type { Namespace } from '@retenia/i18n'
import { useTranslation } from 'react-i18next'

/** `t` scoped to one namespace, typed against the known namespace list — the small,
 * common case every route/component needs instead of the full `useTranslation` result. */
export function useT(ns: Namespace) {
  return useTranslation(ns).t
}
