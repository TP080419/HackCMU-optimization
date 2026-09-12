import { useEffect, useRef, useState } from 'react'
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE } from '../game/config'
import type { BuildableKind, GameState, Orientation, Point } from '../game/types'
import { drawWorld } from '../rendering/canvas'

interface Props {
  stateRef: React.MutableRefObject<GameState | null>
  selectedId: string | null
  hover: Point | null
  buildKind: BuildableKind | null
  orientation: Orientation
  dragPath: Point[]
  demolish: boolean
  onHover(point: Point | null): void
  onDragPreview(path: Point[], orientation: Orientation): void
  onTileAction(point: Point): void
  onBeltDrag(path: Point[], orientation: Orientation): void
}

function pointerTile(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>): Point | null {
  const rect = canvas.getBoundingClientRect()
  const x = Math.floor((event.clientX - rect.left) * (MAP_WIDTH * TILE_SIZE / rect.width) / TILE_SIZE)
  const y = Math.floor((event.clientY - rect.top) * (MAP_HEIGHT * TILE_SIZE / rect.height) / TILE_SIZE)
  return x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT ? { x, y } : null
}

function straightPath(start: Point, end: Point): { path: Point[]; orientation: Orientation } {
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
  const distance = horizontal ? end.x - start.x : end.y - start.y
  const sign = distance < 0 ? -1 : 1
  const count = Math.abs(distance)
  const path: Point[] = []
  for (let index = 0; index <= count; index += 1) {
    path.push({ x: start.x + (horizontal ? sign * index : 0), y: start.y + (horizontal ? 0 : sign * index) })
  }
  const orientation: Orientation = horizontal ? (sign > 0 ? 0 : 2) : (sign > 0 ? 1 : 3)
  return { path, orientation }
}

export function WorldCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef(props)
  const [dragStart, setDragStart] = useState<Point | null>(null)
  overlayRef.current = props

  useEffect(() => {
    let frame = 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const draw = (now: number) => {
      const canvas = canvasRef.current
      const state = overlayRef.current.stateRef.current
      if (canvas && state) {
        drawWorld(canvas, state, {
          selectedId: overlayRef.current.selectedId,
          hover: overlayRef.current.hover,
          buildKind: overlayRef.current.buildKind,
          orientation: overlayRef.current.orientation,
          dragPath: overlayRef.current.dragPath,
          demolish: overlayRef.current.demolish,
          reducedMotion,
        }, now)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="world-canvas"
      width={MAP_WIDTH * TILE_SIZE}
      height={MAP_HEIGHT * TILE_SIZE}
      aria-label="XenoFlow factory map, 24 columns by 14 rows"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const point = pointerTile(canvas, event)
        if (!point) return
        canvas.setPointerCapture(event.pointerId)
        if (props.buildKind === 'belt') {
          setDragStart(point)
          props.onDragPreview([point], props.orientation)
        }
      }}
      onPointerMove={(event) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const point = pointerTile(canvas, event)
        props.onHover(point)
        if (point && dragStart) {
          const preview = straightPath(dragStart, point)
          props.onDragPreview(preview.path, preview.orientation)
        }
      }}
      onPointerLeave={() => props.onHover(null)}
      onPointerUp={(event) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const point = pointerTile(canvas, event)
        if (!point) return
        if (dragStart && props.buildKind === 'belt') {
          const result = straightPath(dragStart, point)
          props.onBeltDrag(result.path, result.orientation)
          props.onDragPreview([], result.orientation)
          setDragStart(null)
        } else {
          props.onTileAction(point)
        }
      }}
      onPointerCancel={() => {
        setDragStart(null)
        props.onDragPreview([], props.orientation)
      }}
    />
  )
}
