import {
  Button,
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
  SliderValue,
  Switch,
  TYPOGRAPHY_FONT_SIZE_MAX,
  TYPOGRAPHY_FONT_SIZE_MIN,
  TYPOGRAPHY_LINE_HEIGHT_MAX,
  TYPOGRAPHY_LINE_HEIGHT_MIN,
  useTypographySettingsStore,
} from '@retenia/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SchedulerSettings } from '../features/scheduler/scheduler-settings'
import { useT } from '../i18n/use-t'
import { useSetDensity, useSetGamificationProfile, useSettings } from '../shell/use-settings'

const settingsSearchSchema = z.object({
  /** Which control gets focus-scrolled on load — a small, typed example of zod-validated
   * search params (the other is `/library`'s `q`). The full Settings screen (AI providers,
   * voice, …) lands in sub-phase 7.5/13.5; this phase wires the fields the shell itself
   * reads (density, gamification profile), typography (purely local to `@retenia/ui`'s
   * `useTypographySettingsStore`), and the scheduler section of sub-phase 4.6. */
  tab: z.enum(['density', 'gamification', 'typography', 'scheduler']).optional(),
})

function SettingsScreen() {
  const t = useT('settings')
  const settings = useSettings()
  const setDensity = useSetDensity()
  const setGamificationProfile = useSetGamificationProfile()
  const { tab = 'density' } = Route.useSearch()

  const density = settings.data?.density ?? 'comfortable'
  const profile = settings.data?.gamification.profile ?? 'arcade'

  const fontSize = useTypographySettingsStore((s) => s.fontSize)
  const lineHeight = useTypographySettingsStore((s) => s.lineHeight)
  const dyslexiaFont = useTypographySettingsStore((s) => s.dyslexiaFont)
  const setFontSize = useTypographySettingsStore((s) => s.setFontSize)
  const setLineHeight = useTypographySettingsStore((s) => s.setLineHeight)
  const setDyslexiaFont = useTypographySettingsStore((s) => s.setDyslexiaFont)
  const resetTypography = useTypographySettingsStore((s) => s.reset)

  return (
    <div data-testid="screen-settings" className="flex flex-col gap-6 p-6">
      <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted">{t('comingSoon')}</p>

      <SchedulerSettings focused={tab === 'scheduler'} />

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

      <section
        data-testid="settings-typography"
        data-focused={tab === 'typography'}
        className="flex max-w-sm flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('typography.label')}</h2>
          <Button variant="ghost" size="sm" onClick={() => resetTypography()}>
            {t('typography.reset')}
          </Button>
        </div>

        <div className="flex flex-col gap-1.5">
          {/* Visible caption only — the accessible name for the slider's actual `<input>`
           * comes from `SliderThumb`'s `getAriaLabel` below (a plain `<label>`/`htmlFor`
           * here would target `Slider.Root`'s wrapping `<div>`, not a labelable control). */}
          <span className="text-muted text-sm">
            {t('typography.fontSize')} ({fontSize}px)
          </span>
          <Slider
            value={fontSize}
            onValueChange={(value) => setFontSize(value as number)}
            min={TYPOGRAPHY_FONT_SIZE_MIN}
            max={TYPOGRAPHY_FONT_SIZE_MAX}
            step={1}
          >
            <SliderControl>
              <SliderTrack>
                <SliderIndicator />
                {/* The accessible name has to reach the hidden `<input type="range">` Base UI
                 * renders inside the thumb — `aria-label` on `Slider.Root` lands on its outer
                 * `<div>` instead, which axe-core's `aria-input-field-name` rule correctly
                 * flags as not naming the actual form control. */}
                <SliderThumb getAriaLabel={() => t('typography.fontSize')} />
              </SliderTrack>
            </SliderControl>
            <SliderValue />
          </Slider>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-muted text-sm">
            {t('typography.lineHeight')} ({lineHeight.toFixed(1)})
          </span>
          <Slider
            value={lineHeight}
            onValueChange={(value) => setLineHeight(value as number)}
            min={TYPOGRAPHY_LINE_HEIGHT_MIN}
            max={TYPOGRAPHY_LINE_HEIGHT_MAX}
            step={0.1}
          >
            <SliderControl>
              <SliderTrack>
                <SliderIndicator />
                <SliderThumb getAriaLabel={() => t('typography.lineHeight')} />
              </SliderTrack>
            </SliderControl>
            <SliderValue />
          </Slider>
        </div>

        <div className="flex items-center justify-between gap-4 text-sm">
          <span id="typography-dyslexia-font-label">{t('typography.dyslexiaFont')}</span>
          <Switch
            checked={dyslexiaFont}
            onCheckedChange={setDyslexiaFont}
            aria-labelledby="typography-dyslexia-font-label"
          />
        </div>
      </section>
    </div>
  )
}

export const Route = createFileRoute('/settings')({
  validateSearch: settingsSearchSchema,
  component: SettingsScreen,
})
