import { DEFINITIONS, DIRECTION_VECTORS, ITEM_COLORS, MAP_HEIGHT, MAP_WIDTH, TERRAIN, TILE_SIZE } from '../game/config'
import { getMachineStatus, placementProblem } from '../game/simulation'
import type { BuildableKind, Entity, GameState, Orientation, Point } from '../game/types'

export interface CanvasOverlay {
  selectedId: string | null
  hover: Point | null
  buildKind: BuildableKind | null
  orientation: Orientation
  dragPath: Point[]
  demolish: boolean
  reducedMotion: boolean
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}

function tileCenter(entity: Pick<Entity, 'x' | 'y'>): Point {
  return { x: entity.x * TILE_SIZE + TILE_SIZE / 2, y: entity.y * TILE_SIZE + TILE_SIZE / 2 }
}

function drawTerrain(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#09151d'
  ctx.fillRect(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE)
  for (const point of TERRAIN.fertile) {
    const x = point.x * TILE_SIZE
    const y = point.y * TILE_SIZE
    ctx.fillStyle = '#17291d'
    ctx.fillRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2)
    ctx.strokeStyle = '#29442e'
    ctx.beginPath()
    ctx.moveTo(x + 7, y + 25)
    ctx.lineTo(x + 13, y + 8)
    ctx.moveTo(x + 18, y + 26)
    ctx.lineTo(x + 24, y + 10)
    ctx.stroke()
  }
  const springX = TERRAIN.spring.x * TILE_SIZE
  const springY = TERRAIN.spring.y * TILE_SIZE
  ctx.fillStyle = '#10333e'
  ctx.fillRect(springX + 1, springY + 1, TILE_SIZE - 2, TILE_SIZE - 2)
  ctx.strokeStyle = '#27C7D9'
  ctx.beginPath()
  ctx.arc(springX + 16, springY + 17, 8, 0, Math.PI * 2)
  ctx.stroke()
  const ventX = TERRAIN.vent.x * TILE_SIZE
  const ventY = TERRAIN.vent.y * TILE_SIZE
  ctx.fillStyle = '#271d3a'
  ctx.fillRect(ventX + 1, ventY + 1, TILE_SIZE - 2, TILE_SIZE - 2)
  ctx.fillStyle = '#A879FF'
  ctx.beginPath()
  ctx.moveTo(ventX + 16, ventY + 5)
  ctx.lineTo(ventX + 25, ventY + 23)
  ctx.lineTo(ventX + 8, ventY + 25)
  ctx.closePath()
  ctx.fill()
  for (const rock of TERRAIN.rocks) {
    const x = rock.x * TILE_SIZE
    const y = rock.y * TILE_SIZE
    ctx.fillStyle = '#17252b'
    ctx.beginPath()
    ctx.moveTo(x + 6, y + 23)
    ctx.lineTo(x + 10, y + 9)
    ctx.lineTo(x + 21, y + 5)
    ctx.lineTo(x + 27, y + 19)
    ctx.lineTo(x + 22, y + 27)
    ctx.lineTo(x + 10, y + 27)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#31444b'
    ctx.stroke()
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, coordinates: boolean): void {
  ctx.strokeStyle = 'rgba(85, 137, 151, .16)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= MAP_WIDTH; x += 1) {
    ctx.moveTo(x * TILE_SIZE + 0.5, 0)
    ctx.lineTo(x * TILE_SIZE + 0.5, MAP_HEIGHT * TILE_SIZE)
  }
  for (let y = 0; y <= MAP_HEIGHT; y += 1) {
    ctx.moveTo(0, y * TILE_SIZE + 0.5)
    ctx.lineTo(MAP_WIDTH * TILE_SIZE, y * TILE_SIZE + 0.5)
  }
  ctx.stroke()
  if (!coordinates) return
  ctx.font = '8px ui-monospace, monospace'
  ctx.fillStyle = 'rgba(217,246,242,.45)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) ctx.fillText(`${x},${y}`, x * TILE_SIZE + 2, y * TILE_SIZE + 2)
  }
}

function progressRatio(entity: Entity): number {
  if (entity.kind === 'uplink' || entity.kind === 'belt' || entity.kind === 'splitter' || entity.kind === 'crate' || entity.kind === 'solarPylon') return 0
  const definition = DEFINITIONS[entity.kind]
  if (entity.kind === 'crop' || entity.kind === 'waterExtractor' || entity.kind === 'crystiteDrill') return Math.min(1, entity.progress / (definition.cycleSeconds ?? 1))
  return Math.min(1, entity.progress / (definition.recipe?.seconds ?? 1))
}

function drawArrow(ctx: CanvasRenderingContext2D, center: Point, orientation: Orientation, color: string, offset = 0): void {
  const vector = DIRECTION_VECTORS[orientation]
  const side = DIRECTION_VECTORS[((orientation + 1) % 4) as Orientation]
  const cx = center.x + vector.x * offset
  const cy = center.y + vector.y * offset
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx - vector.x * 5 + side.x * 4, cy - vector.y * 5 + side.y * 4)
  ctx.lineTo(cx + vector.x * 5, cy + vector.y * 5)
  ctx.lineTo(cx - vector.x * 5 - side.x * 4, cy - vector.y * 5 - side.y * 4)
  ctx.stroke()
}

function drawEntity(ctx: CanvasRenderingContext2D, state: GameState, entity: Entity, now: number, selected: boolean, reducedMotion: boolean): void {
  const x = entity.x * TILE_SIZE
  const y = entity.y * TILE_SIZE
  const center = tileCenter(entity)
  if (entity.kind === 'uplink') {
    const recent = state.stats.lastDeliveryAt !== null && state.simulatedTime - state.stats.lastDeliveryAt < 1.5
    const pulse = recent && !reducedMotion ? 1 + Math.sin(now / 100) * 0.08 : 1
    ctx.save()
    ctx.translate(center.x, center.y)
    ctx.scale(pulse, pulse)
    ctx.strokeStyle = recent ? '#D7FFF1' : '#4a8e80'
    ctx.lineWidth = recent ? 3 : 2
    ctx.beginPath()
    ctx.arc(0, 0, 11, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, 0, 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = '#D7FFF1'
    ctx.font = 'bold 7px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('UPLINK', center.x, y + 30)
  } else if (entity.kind === 'belt' || entity.kind === 'splitter') {
    ctx.fillStyle = entity.kind === 'belt' ? '#1b3038' : '#263d44'
    roundedRect(ctx, x + 3, y + 8, 26, 16, 4)
    ctx.fill()
    const animatedOffset = reducedMotion ? 0 : ((now / 120) % 8) - 4
    drawArrow(ctx, center, entity.orientation, '#7ba2aa', animatedOffset)
    if (entity.kind === 'splitter') drawArrow(ctx, center, ((entity.orientation + 1) % 4) as Orientation, '#b3d0d4', -3)
  } else {
    const definition = DEFINITIONS[entity.kind]
    ctx.fillStyle = definition.color
    roundedRect(ctx, x + 3, y + 3, 26, 26, entity.kind === 'crop' ? 7 : 4)
    ctx.globalAlpha = 0.78
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#a9ccd0'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#071018'
    ctx.font = 'bold 9px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(definition.abbreviation, center.x, center.y)
    if (entity.kind !== 'solarPylon') drawArrow(ctx, center, entity.orientation, '#d9f6f2', 9)
    if (['crate', 'gelRefinery', 'fiberMill', 'coreAssembler'].includes(entity.kind)) {
      for (let direction = 0; direction < 4; direction += 1) {
        if (direction === entity.orientation) continue
        const vector = DIRECTION_VECTORS[direction as Orientation]
        ctx.fillStyle = '#071018'
        ctx.beginPath()
        ctx.arc(center.x + vector.x * 12, center.y + vector.y * 12, 2.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#b4d4d2'
        ctx.stroke()
      }
    }
    const ratio = progressRatio(entity)
    if (ratio > 0) {
      ctx.fillStyle = '#071018'
      ctx.fillRect(x + 4, y + 26, 24, 3)
      ctx.fillStyle = '#d7fff1'
      ctx.fillRect(x + 4, y + 26, 24 * ratio, 3)
    }
    if (['crop', 'waterExtractor', 'crystiteDrill', 'gelRefinery', 'fiberMill', 'coreAssembler'].includes(entity.kind)) {
      const status = getMachineStatus(state, entity).status
      ctx.fillStyle = status === 'WORKING' ? '#67d391' : status === 'READY' ? '#d7fff1' : status === 'STARVED' ? '#ffb84d' : '#ff5d67'
      ctx.beginPath()
      ctx.arc(x + 27, y + 5, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (entity.output && entity.kind !== 'uplink') {
    const progress = entity.kind === 'belt' || entity.kind === 'splitter' ? 1 - entity.transit : 0.5
    const vector = DIRECTION_VECTORS[entity.orientation]
    ctx.fillStyle = ITEM_COLORS[entity.output]
    ctx.beginPath()
    ctx.arc(center.x + vector.x * (progress - 0.5) * 22, center.y + vector.y * (progress - 0.5) * 22, entity.output === 'core' ? 5 : 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#071018'
    ctx.stroke()
  }
  if (selected) {
    ctx.strokeStyle = '#d7fff1'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 2])
    ctx.strokeRect(x + 1.5, y + 1.5, TILE_SIZE - 3, TILE_SIZE - 3)
    ctx.setLineDash([])
  }
}

function drawDrone(ctx: CanvasRenderingContext2D, state: GameState): void {
  const drone = state.drone
  let displayX = drone.x
  let displayY = drone.y
  if (drone.path.length > 0) {
    displayX += (drone.path[0].x - drone.x) * drone.moveProgress
    displayY += (drone.path[0].y - drone.y) * drone.moveProgress
  }
  const x = displayX * TILE_SIZE + TILE_SIZE / 2
  const y = displayY * TILE_SIZE + TILE_SIZE / 2
  ctx.fillStyle = drone.error ? '#ff5d67' : drone.paused ? '#7898a3' : '#d7fff1'
  ctx.beginPath()
  ctx.moveTo(x, y - 10)
  ctx.lineTo(x + 9, y - 2)
  ctx.lineTo(x + 6, y + 8)
  ctx.lineTo(x - 6, y + 8)
  ctx.lineTo(x - 9, y - 2)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#071018'
  ctx.lineWidth = 2
  ctx.stroke()
  for (let index = 0; index < drone.cargo; index += 1) {
    ctx.fillStyle = ITEM_COLORS.xenograin
    ctx.fillRect(x - 7 + index * 4, y + 11, 3, 3)
  }
}

function drawGhosts(ctx: CanvasRenderingContext2D, state: GameState, overlay: CanvasOverlay): void {
  const points = overlay.dragPath.length > 0 ? overlay.dragPath : overlay.hover ? [overlay.hover] : []
  for (const point of points) {
    const entity = state.entities.find((candidate) => candidate.x === point.x && candidate.y === point.y)
    let valid = false
    if (overlay.demolish) valid = !!entity && !entity.protected
    else if (overlay.buildKind) valid = !placementProblem(state, overlay.buildKind, point.x, point.y)
    else continue
    ctx.fillStyle = valid ? 'rgba(79, 231, 171, .24)' : 'rgba(255, 93, 103, .24)'
    ctx.fillRect(point.x * TILE_SIZE + 1, point.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2)
    ctx.strokeStyle = valid ? '#4fe7ab' : '#ff5d67'
    ctx.lineWidth = 2
    ctx.strokeRect(point.x * TILE_SIZE + 2, point.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4)
    if (valid && overlay.buildKind === 'belt') drawArrow(ctx, { x: point.x * TILE_SIZE + 16, y: point.y * TILE_SIZE + 16 }, overlay.orientation, '#d7fff1')
  }
}

export function drawWorld(canvas: HTMLCanvasElement, state: GameState, overlay: CanvasOverlay, now: number): void {
  const ratio = window.devicePixelRatio || 1
  const width = MAP_WIDTH * TILE_SIZE
  const height = MAP_HEIGHT * TILE_SIZE
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio
    canvas.height = height * ratio
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, width, height)
  drawTerrain(ctx)
  drawGrid(ctx, state.settings.showCoordinates)
  for (const entity of state.entities) drawEntity(ctx, state, entity, now, overlay.selectedId === entity.id, overlay.reducedMotion)
  drawDrone(ctx, state)
  drawGhosts(ctx, state, overlay)
}
