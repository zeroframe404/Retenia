import { useEffect, useState } from 'react'
import { Circle, Image as KonvaImage, Layer, Line, Rect, Stage } from 'react-konva'
import type { ImageStageProps, ImageStageShape } from './image-stage'

/**
 * The Konva half of `ImageStage`, in its own module so `React.lazy` gets a chunk boundary. Never
 * import this file directly — import `./image-stage`.
 *
 * A canvas is invisible to a screen reader, so the stage is wrapped in a group labelled by `alt`
 * and every shape also exists as a real `<button>` in the sibling list the family renderer draws;
 * this component is the pointer path, never the only path (§9's keyboard rule applies to hotspots
 * exactly as it does to drag-and-drop).
 */

const STROKE = '#2563eb'
const FILL = 'rgba(37, 99, 235, 0.25)'

function useImageElement(src: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    const element = new window.Image()
    element.src = src
    element.onload = () => setImage(element)
    return () => {
      element.onload = null
    }
  }, [src])
  return image
}

function Shape({
  shape,
  width,
  height,
  onClick,
}: {
  shape: ImageStageShape
  width: number
  height: number
  onClick?: () => void
}) {
  const common = {
    stroke: STROKE,
    strokeWidth: 2,
    fill: shape.active ? FILL : 'transparent',
    onClick,
    onTap: onClick,
  }
  if (shape.kind === 'rect') {
    const [x = 0, y = 0, w = 0, h = 0] = shape.coords
    return <Rect x={x * width} y={y * height} width={w * width} height={h * height} {...common} />
  }
  if (shape.kind === 'circle') {
    const [cx = 0, cy = 0, r = 0] = shape.coords
    return (
      <Circle x={cx * width} y={cy * height} radius={r * Math.min(width, height)} {...common} />
    )
  }
  const points = shape.coords.map((value, index) => value * (index % 2 === 0 ? width : height))
  return <Line points={points} closed {...common} />
}

export default function ImageStageImpl({
  src,
  alt,
  width,
  height,
  shapes = [],
  onShapeClick,
  onPointClick,
  disabled = false,
}: ImageStageProps) {
  const image = useImageElement(src)

  return (
    <figure className="m-0" data-testid="image-stage">
      <figcaption className="sr-only">{alt}</figcaption>
      <Stage
        width={width}
        height={height}
        onClick={(event) => {
          if (disabled || !onPointClick) return
          const point = event.target.getStage()?.getPointerPosition()
          if (point) onPointClick(point.x / width, point.y / height)
        }}
      >
        <Layer>
          {image && <KonvaImage image={image} width={width} height={height} alt={alt} />}
          {shapes.map((shape) => (
            <Shape
              key={shape.id}
              shape={shape}
              width={width}
              height={height}
              onClick={disabled ? undefined : () => onShapeClick?.(shape.id)}
            />
          ))}
        </Layer>
      </Stage>
    </figure>
  )
}
