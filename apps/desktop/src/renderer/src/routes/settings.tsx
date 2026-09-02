import { Button } from '@retenia/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useT } from '../i18n/use-t'
import { useSetDensity, useSetGamificationProfile, useSettings } from '../shell/use-settings'

const settingsSearchSchema = z.object({
  /** Which control gets focus-scrolled on load — a small, typed example of zod-validated
   * search params (the other is `/library`'s `q`). The full Settings screen (AI providers,
   * voice, scheduler, …) lands in sub-phase 7.5/13.5; this phase only wires the two fields
   * the shell itself reads (density, gamification profile). */
  tab: z.enum(['density', 'gamification']).optional(),
})

function SettingsScreen() {
  const t = useT('settings')
  const settings = useSettings()
  const setDensity = useSetDensity()
  const setGamificationProfile = useSetGamificationProfile()
  const { tab = 'density' } = Route.useSearch()

  const density = settings.data?.density ?? 'comfortable'
  const profile = settings.data?.gamification.profile ?? 'arcade'

  return (
    <div data-testid="screen-settings" className="flex flex-col gap-6 p-6">
      <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted">{t('comingSoon')}</p>

      <section
        data-testid="settings-density"
        data-focused={tab === 'density'}
        className="flex flex-col gap-2"
      >
        <h2 className="text-sm font-semibold">{t('density.label')}</h2>
        <div className="flex gap-2">
          <Button
            variant={density === 'compact' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setDensity.mutate({ density: 'compact' })}
          >
            {t('density.compact')}
          </Button>
          <Button
            variant={density === 'comfortable' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setDensity.mutate({ density: 'comfortable' })}
          >
            {t('density.comfortable')}
          </Button>
        </div>
      </section>

      <section
        data-testid="settings-gamification"
        data-focused={tab === 'gamification'}
        className="flex flex-col gap-2"
      >
        <h2 className="text-sm font-semibold">{t('gamification.label')}</h2>
        <div className="flex gap-2">
          <Button
            variant={profile === 'arcade' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setGamificationProfile.mutate({ profile: 'arcade' })}
          >
            {t('gamification.arcade')}
          </Button>
          <Button
            variant={profile === 'sober' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setGamificationProfile.mutate({ profile: 'sober' })}
          >
            {t('gamification.sober')}
          </Button>
        </div>
      </section>
    </div>
  )
}

export const Route = createFileRoute('/settings')({
  validateSearch: settingsSearchSchema,
  component: SettingsScreen,
})
