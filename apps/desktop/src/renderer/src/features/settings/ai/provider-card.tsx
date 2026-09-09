import type { ProviderCardDto } from '@retenia/ipc-contract'
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  SecretInput,
} from '@retenia/ui'
import { useState } from 'react'
import { useT } from '../../../i18n/use-t'
import { useIpcMutation } from '../../../ipc/hooks'

export interface ProviderCardProps {
  card: ProviderCardDto
  onSaved: () => void
}

/**
 * One card of the "Inteligencia artificial" screen's provider list (`docs/spec/08-ux.md`
 * §1): a masked key field, and "Probar conexión" — a real 1-token call that lists what
 * models the key can reach. Placeholder cards for providers `packages/ai` does not have a
 * profile for yet (Azure Speech, ElevenLabs) are rendered separately by `AiSettingsSection`,
 * not by this component.
 */
export function ProviderCard({ card, onSaved }: ProviderCardProps) {
  const t = useT('settings')
  const [keyInput, setKeyInput] = useState('')
  const setSecret = useIpcMutation('secrets.set')
  const probe = useIpcMutation('ai.probeProvider')

  const secretName = SECRET_NAME_BY_PROFILE[card.id]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{card.label}</CardTitle>
          <Badge variant={card.hasKey ? 'correct' : 'neutral'}>
            {card.hasKey ? t('ai.providers.configured') : t('ai.providers.notConfigured')}
          </Badge>
        </div>
        <CardDescription>{card.models.join(', ')}</CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 p-6 pt-0">
        {secretName !== undefined && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label
                htmlFor={`provider-key-${card.id}`}
                className="text-muted mb-1 block text-xs font-medium"
              >
                {t('ai.providers.apiKeyLabel')}
              </label>
              <SecretInput
                id={`provider-key-${card.id}`}
                preview={card.keyPreview}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                revealLabel={t('ai.providers.showKey')}
                hideLabel={t('ai.providers.hideKey')}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={keyInput === '' || setSecret.isPending}
              onClick={() => {
                setSecret
                  .mutateAsync({ name: secretName, value: keyInput })
                  .then(() => {
                    setKeyInput('')
                    onSaved()
                  })
                  .catch(() => {})
              }}
            >
              {t('ai.providers.saveKey')}
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!card.hasKey || probe.isPending}
            onClick={() => {
              probe.mutate({ profileId: card.id })
            }}
          >
            {probe.isPending ? t('ai.providers.probing') : t('ai.providers.probe')}
          </Button>
          {probe.data && (
            <span
              className={
                probe.data.ok
                  ? 'text-teal-700 text-xs dark:text-teal-300'
                  : 'text-red-700 text-xs dark:text-red-300'
              }
            >
              {probe.data.ok
                ? t('ai.providers.probeOk', { count: probe.data.models.length })
                : (probe.data.error ?? t('ai.providers.probeFailed'))}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}

/** Mirrors `SECRET_NAMES`/profile ids: only the profiles `packages/ai`'s `DEFAULT_PROFILES`
 *  actually has a `keyRef` for. The local (Ollama/LM Studio) card has none — its key entry
 *  is skipped, matching `ProviderProfile.keyRef: null`. */
const SECRET_NAME_BY_PROFILE: Record<string, 'anthropic' | 'google' | undefined> = {
  anthropic: 'anthropic',
  google: 'google',
}
