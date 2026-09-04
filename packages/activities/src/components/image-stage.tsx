import { lazy, Suspense } from 'react'

/**
 * The canvas the `image_target` family draws on (`hotspot_click`, `label_image`, `drop_pin`,
 * `image_occlusion`, `drag_drop_zones` — phase 2 of §6): an image with rectangles, circles and
 * polygons over it, in the payload's normalized `0..1` coordinates.
 *
 * Konva is lazy for the same reason MathLive is: none of the 21 MVP types is an image type, so the
 * canvas engine must not be in the bundle a text-only session loads.
 */

export interface ImageStageShape {
  id: string
  kind: 'rect' | 'circle' | 'polygon'
  /** Normalized `0..1`: `[x, y, w, h]`, `[cx, cy, r]`, or a flat `[x1, y1, x2, y2, …]` ring. */
  coords: readonly number[]
  label?: string
  /** Drawn filled — a revealed occlusion, a correct hotspot in the feedback state. */
  active?: boolean
}

export interface ImageStageProps {
  src: string
  alt: string
  width: number
  height: number
  shapes?: readonly ImageStageShape[]
  onShapeClick?: (shapeId: string) => void
  /** Normalized `0..1` click position, for the types that grade a point rather than a shape. */
  onPointClick?: (x: number, y: number) => void
  disabled?: boolean
}

const ImageStageImpl = lazy(async () => {
  const { default: Component } = await import('./image-stage-impl')
  return { default: Component }
})

export function ImageStage(props: ImageStageProps) {
  return (
    <Suspense
      fallback={
        <div
          className="border-border bg-surface animate-pulse rounded-md border"
          style={{ width: props.width, height: props.height }}
          data-testid="image-stage-loading"
        />
      }
    >
      <ImageStageImpl {...props} />
    </Suspense>
  )
}
