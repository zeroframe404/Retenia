import type { Meta, StoryObj } from '@storybook/react-vite'
import { MediaPlayer } from './media-player'
import type { KeyframeMarker, MediaPartRef, MediaPlayerLabels, TranscriptCue } from './types'

const meta = {
  title: 'Readers/MediaPlayer',
  component: MediaPlayer,
} satisfies Meta<typeof MediaPlayer>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The strings the app supplies from `packages/i18n`'s `library` namespace. Spelled out here
 * because `packages/readers` takes all of its copy as props — the same rule `packages/ui`
 * follows — so a story needs no i18n provider to render a realistic player.
 */
const labels: MediaPlayerLabels = {
  play: 'Reproducir',
  pause: 'Pausar',
  mute: 'Silenciar',
  unmute: 'Activar el sonido',
  back: 'Retroceder 10 segundos',
  forward: 'Adelantar 10 segundos',
  transcript: 'Transcripción',
  keyframes: 'Diapositivas',
  noTranscript: 'Todavía no hay transcripción.',
  noKeyframes: 'No se encontraron diapositivas.',
  followPlayhead: 'Seguir la reproducción',
  clip: 'Recortar',
  clipStart: 'Marcar el inicio',
  clipEnd: 'Crear tarjeta',
  clipSave: 'Guardar',
  clipCancel: 'Cancelar',
  clipHint: 'Movete hasta el final del fragmento y volvé a tocar el botón.',
  localNotice:
    'Tus archivos se procesan localmente en tu computadora. No se sube nada salvo los fotogramas o el texto que habilites.',
  partOf: (index, total, title) => `Clase ${index} de ${total}: ${title}`,
  frameAt: (label) => `Diapositiva en ${label}`,
}

/** A course: three lessons laid end to end on one timeline, which is what the player exists
 *  to hide. The sources are empty on purpose — a story has no blob store, and the controls,
 *  the transcript and the markers are all driven by props rather than by the media element. */
const parts: MediaPartRef[] = [
  { src: '', mime: 'video/mp4', title: 'Bienvenida', startSec: 0, durationSec: 120 },
  { src: '', mime: 'video/mp4', title: 'Instalación', startSec: 120, durationSec: 180 },
  { src: '', mime: 'video/mp4', title: 'Primer programa', startSec: 300, durationSec: 240 },
]

const cues: TranscriptCue[] = [
  { id: 'c1', startSec: 0, endSec: 8, text: 'Bienvenidos al curso.', label: '0:00' },
  { id: 'c2', startSec: 8, endSec: 22, text: 'Vamos a empezar por la instalación.', label: '0:08' },
  { id: 'c3', startSec: 130, endSec: 145, text: 'Descargá el instalador oficial.', label: '2:10' },
  { id: 'c4', startSec: 310, endSec: 330, text: 'Ahora sí, el primer programa.', label: '5:10' },
]

const keyframes: KeyframeMarker[] = [
  { id: 'k1', timeSec: 4, src: '', text: 'Bienvenidos' },
  { id: 'k2', timeSec: 132, src: '', text: 'Instalación paso a paso' },
  { id: 'k3', timeSec: 315, src: '', text: 'hola mundo' },
]

export const Course: Story = {
  args: { kind: 'video', parts, cues, keyframes, labels, onCreateClip: () => {} },
}

/** A single recording is a one-part course, which is the whole reason there is no second code
 *  path for it. */
export const SingleRecording: Story = {
  args: {
    kind: 'audio',
    parts: [{ src: '', mime: 'audio/mpeg', title: 'Clase 3', startSec: 0, durationSec: 540 }],
    cues: cues.slice(0, 2),
    keyframes: [],
    labels,
  },
}

/** A source whose transcription has not run yet, or found no speech. */
export const NoTranscript: Story = {
  args: { kind: 'video', parts: parts.slice(0, 1), cues: [], keyframes: [], labels },
}
