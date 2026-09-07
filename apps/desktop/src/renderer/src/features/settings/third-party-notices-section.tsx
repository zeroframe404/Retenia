import { useT } from '../../i18n/use-t'
import { THIRD_PARTY_NOTICES } from './third-party-notices'

/** The Settings-screen half of the LGPL notice obligation `docs/dev/sidecars.md` records
 *  (`docs/spec/07-architecture.md` §7) — the developer-facing half of that same requirement. */
export function ThirdPartyNoticesSection() {
  const t = useT('settings')

  return (
    <section data-testid="settings-third-party-notices" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{t('thirdPartyNotices.label')}</h2>
      <p className="text-muted text-sm">{t('thirdPartyNotices.description')}</p>
      <ul className="flex flex-col gap-3">
        {THIRD_PARTY_NOTICES.map((notice) => (
          <li key={notice.name} className="border-border bg-surface rounded-md border p-3 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{notice.name}</span>
              <span className="text-muted text-xs">{notice.license}</span>
            </div>
            <p className="text-muted mt-1">{notice.detail}</p>
            <a
              href={notice.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 mt-1 inline-block break-all underline"
            >
              {notice.sourceUrl}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
