import Phaser from 'phaser'
import { ITEM_COLORS, MAP_HEIGHT, MAP_WIDTH, TILE_HEIGHT, TILE_WIDTH } from '../config'
import type { EntityKind, GameCommand, GridPoint, ItemId, RenderEntity, RenderSnapshot } from '../types'

const ORIGIN_X = 1_020
const ORIGIN_Y = 120

export interface SceneBridge {
  snapshot: () => RenderSnapshot
  dispatch: (command: GameCommand) => void
  getBuildTool: () => EntityKind | null
  onToggleCode: () => void
  onWorldReady?: () => void
}

function iso(point: GridPoint) {
  return {
    x: ORIGIN_X + (point.x - point.y) * (TILE_WIDTH / 2),
    y: ORIGIN_Y + (point.x + point.y) * (TILE_HEIGHT / 2),
  }
}

function inverseIso(x: number, y: number) {
  const localX = x - ORIGIN_X
  const localY = y - ORIGIN_Y
  return {
    x: Math.floor(localY / TILE_HEIGHT + localX / TILE_WIDTH),
    y: Math.floor(localY / TILE_HEIGHT - localX / TILE_WIDTH),
  }
}

function hash(x: number, y: number, salt = 0) {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 71.3) * 43758.5453
  return value - Math.floor(value)
}

function itemColor(item: ItemId) {
  return ITEM_COLORS[item]
}

export class FactoryScene extends Phaser.Scene {
  private terrain!: Phaser.GameObjects.Graphics
  private world!: Phaser.GameObjects.Graphics
  private effects!: Phaser.GameObjects.Graphics
  private labels = new Map<string, Phaser.GameObjects.Text>()
  private lastSnapshot!: RenderSnapshot
  private dragging = false
  private dragDistance = 0
  private lastPointer = { x: 0, y: 0 }
  private lastClickAt = 0
  private lastClickedId = ''
  private currentTick = -1
  private movingEntityId: string | null = null
  private buildStart: GridPoint | null = null

  constructor(private readonly bridge: SceneBridge) {
    super({ key: 'factory' })
  }

  create() {
    this.terrain = this.add.graphics().setDepth(0)
    this.world = this.add.graphics().setDepth(10)
    this.effects = this.add.graphics().setDepth(30)
    this.drawTerrain()
    this.configureCamera()
    this.configureInput()
    this.lastSnapshot = this.bridge.snapshot()
    this.bridge.onWorldReady?.()
  }

  update(time: number) {
    const snapshot = this.bridge.snapshot()
    if (snapshot.tick !== this.currentTick || !snapshot.mission || !this.lastSnapshot) {
      this.currentTick = snapshot.tick
      this.lastSnapshot = snapshot
    }
    this.drawWorld(this.lastSnapshot, this.lastSnapshot.settings.reducedMotion ? 0 : time)
  }

  private configureCamera() {
    const camera = this.cameras.main
    camera.setBackgroundColor('#1b211d')
    camera.setBounds(-600, -200, 3_200, 1_850)
    camera.centerOn(ORIGIN_X + 180, ORIGIN_Y + 540)
    camera.setZoom(this.coverZoom(this.scale.width, this.scale.height))
    camera.roundPixels = true
    this.scale.on('resize', (size: Phaser.Structs.Size) => camera.setZoom(this.coverZoom(size.width, size.height)))
  }

  private coverZoom(width: number, height: number) {
    return Phaser.Math.Clamp(Math.max(width / 2_300, height / 1_150), 0.58, 1.12)
  }

  private configureInput() {
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _deltaX: number, deltaY: number) => {
      const camera = this.cameras.main
      camera.setZoom(Phaser.Math.Clamp(camera.zoom - deltaY * 0.0008, 0.42, 1.45))
    })
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const grid = inverseIso(worldPoint.x, worldPoint.y)
      const snapshot = this.bridge.snapshot()
      const hit = [...snapshot.entities].reverse().find((candidate) => grid.x >= candidate.x && grid.x < candidate.x + candidate.width && grid.y >= candidate.y && grid.y < candidate.y + candidate.height)
      const tool = this.bridge.getBuildTool()
      if (tool) {
        this.buildStart = grid
        this.dragging = false
        return
      }
      if (pointer.event.shiftKey && hit && !['crop', 'ruin', 'uplink'].includes(hit.kind)) {
        this.movingEntityId = hit.id
        this.dragging = false
        return
      }
      this.dragging = true
      this.dragDistance = 0
      this.lastPointer = { x: pointer.x, y: pointer.y }
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging || !pointer.isDown) return
      const dx = pointer.x - this.lastPointer.x
      const dy = pointer.y - this.lastPointer.y
      this.dragDistance += Math.abs(dx) + Math.abs(dy)
      this.cameras.main.scrollX -= dx / this.cameras.main.zoom
      this.cameras.main.scrollY -= dy / this.cameras.main.zoom
      this.lastPointer = { x: pointer.x, y: pointer.y }
    })
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.dragging = false
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      const grid = inverseIso(worldPoint.x, worldPoint.y)
      if (this.movingEntityId) {
        this.bridge.dispatch({ type: 'moveEntity', entityId: this.movingEntityId, x: grid.x, y: grid.y })
        this.bridge.dispatch({ type: 'selectEntity', entityId: this.movingEntityId })
        this.movingEntityId = null
        return
      }
      const tool = this.bridge.getBuildTool()
      if (tool && this.buildStart) {
        if (tool === 'belt') {
          const start = this.buildStart
          const stepX = grid.x >= start.x ? 1 : -1
          for (let x = start.x; x !== grid.x + stepX; x += stepX) this.bridge.dispatch({ type: 'build', kind: tool, x, y: start.y })
          const stepY = grid.y >= start.y ? 1 : -1
          for (let y = start.y + stepY; y !== grid.y + stepY; y += stepY) this.bridge.dispatch({ type: 'build', kind: tool, x: grid.x, y })
        } else this.bridge.dispatch({ type: 'build', kind: tool, x: grid.x, y: grid.y })
        this.buildStart = null
        return
      }
      if (this.dragDistance > 9) return
      const snapshot = this.bridge.snapshot()
      const hit = [...snapshot.entities].reverse().find((candidate) => grid.x >= candidate.x && grid.x < candidate.x + candidate.width && grid.y >= candidate.y && grid.y < candidate.y + candidate.height)
      this.bridge.dispatch({ type: 'selectEntity', entityId: hit?.id ?? null })
      const now = performance.now()
      if (hit && hit.id === this.lastClickedId && now - this.lastClickAt < 330) {
        const center = iso({ x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 })
        this.cameras.main.pan(center.x, center.y, 360, 'Sine.easeInOut')
      }
      this.lastClickAt = now
      this.lastClickedId = hit?.id ?? ''
    })
    const keyboard = this.input.keyboard
    const isTyping = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      return Boolean(target?.closest('input, textarea, [contenteditable="true"], .cm-editor'))
    }
    keyboard?.on('keydown-TAB', (event: KeyboardEvent) => {
      if (isTyping(event)) return
      event.preventDefault()
      this.bridge.dispatch({ type: 'toggleFlowVision' })
    })
    keyboard?.on('keydown-C', (event: KeyboardEvent) => {
      if (!isTyping(event)) this.bridge.onToggleCode()
    })
    keyboard?.on('keydown-R', (event: KeyboardEvent) => {
      if (isTyping(event)) return
      const selected = this.bridge.snapshot().entities.find((candidate) => candidate.selected)
      if (selected) this.bridge.dispatch({ type: 'rotateEntity', entityId: selected.id })
    })
    keyboard?.on('keydown-DELETE', (event: KeyboardEvent) => {
      if (isTyping(event)) return
      const selected = this.bridge.snapshot().entities.find((candidate) => candidate.selected)
      if (selected) this.bridge.dispatch({ type: 'demolish', entityId: selected.id })
    })
  }

  private diamond(graphics: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, fill: number, alpha = 1, stroke?: number) {
    graphics.fillStyle(fill, alpha)
    graphics.beginPath()
    graphics.moveTo(x, y - height / 2)
    graphics.lineTo(x + width / 2, y)
    graphics.lineTo(x, y + height / 2)
    graphics.lineTo(x - width / 2, y)
    graphics.closePath()
    graphics.fillPath()
    if (stroke !== undefined) {
      graphics.lineStyle(1.4, stroke, 0.75)
      graphics.strokePath()
    }
  }

  private isWater(x: number, y: number) {
    return (x >= 9 && x <= 14 && y <= 2) || (x >= 24 && y >= 13) || (x >= 26 && y >= 11)
  }

  private drawTerrain() {
    this.terrain.clear()
    this.terrain.fillStyle(0x151a17, 1)
    this.terrain.fillRect(-600, -200, 3_200, 1_850)
    for (let sum = 0; sum < MAP_WIDTH + MAP_HEIGHT; sum += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const y = sum - x
        if (y < 0 || y >= MAP_HEIGHT) continue
        const point = iso({ x: x + 0.5, y: y + 0.5 })
        const water = this.isWater(x, y)
        const variation = Math.floor(hash(x, y) * 3)
        const soil = [0x625d50, 0x6d6657, 0x58574c][variation]
        this.diamond(this.terrain, point.x, point.y, TILE_WIDTH + 1, TILE_HEIGHT + 1, water ? 0x267f88 : soil, 1, water ? 0x5bc4c7 : 0x807563)
        if (water) {
          const glint = hash(x, y, 2)
          this.terrain.lineStyle(1.4, 0x98f5ed, 0.22 + glint * 0.18)
          this.terrain.lineBetween(point.x - 21, point.y + (glint - 0.5) * 8, point.x + 12, point.y + (glint - 0.5) * 8)
        } else {
          const pebbleX = point.x + (hash(x, y, 3) - 0.5) * 54
          const pebbleY = point.y + (hash(x, y, 4) - 0.5) * 20
          this.terrain.fillStyle(0x302f2c, 0.24)
          this.terrain.fillCircle(pebbleX, pebbleY, 1.5 + hash(x, y, 5) * 2)
          if (hash(x, y, 6) > 0.84) this.drawAlienTuft(this.terrain, pebbleX + 10, pebbleY - 2, 0.7, 0x39b6a3)
        }
      }
    }
    this.drawCliffEdge()
  }

  private drawCliffEdge() {
    this.terrain.lineStyle(5, 0x252824, 0.9)
    const first = iso({ x: 0, y: MAP_HEIGHT })
    const middle = iso({ x: MAP_WIDTH, y: MAP_HEIGHT })
    const last = iso({ x: MAP_WIDTH, y: 0 })
    this.terrain.lineBetween(first.x, first.y + 3, middle.x, middle.y + 3)
    this.terrain.lineBetween(middle.x, middle.y + 3, last.x, last.y + 3)
  }

  private drawWorld(snapshot: RenderSnapshot, time: number) {
    this.world.clear()
    this.effects.clear()
    const sorted = [...snapshot.entities].sort((a, b) => (a.x + a.y + a.height) - (b.x + b.y + b.height))
    for (const candidate of sorted) this.drawEntity(candidate, time, snapshot.flowVision)
    this.drawConstructionHints(snapshot, time)
    this.drawDrone(snapshot, time)
    if (snapshot.flowVision) this.drawFlowVision(snapshot, time)
    this.drawWorldFeedback(snapshot)
    this.updateLabels(snapshot)
  }

  private drawEntity(entity: RenderEntity, time: number, flowVision: boolean) {
    const center = iso({ x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 })
    if (entity.kind === 'crop') this.drawCrop(entity, center, time)
    else if (entity.kind === 'belt') this.drawBelt(entity, center, time)
    else if (entity.kind === 'inserter') this.drawInserter(entity, center, time)
    else if (entity.kind === 'hopper') this.drawHopper(entity, center)
    else if (entity.kind === 'gelRefinery') this.drawGelRefinery(entity, center, time)
    else if (entity.kind === 'fiberMill') this.drawFiberMill(entity, center, time)
    else if (entity.kind === 'coreAssembler') this.drawAssembler(entity, center, time)
    else if (entity.kind === 'waterExtractor') this.drawExtractor(entity, center, time)
    else if (entity.kind === 'crystiteDrill') this.drawDrill(entity, center, time)
    else if (entity.kind === 'uplink') this.drawUplink(entity, center, time)
    else if (entity.kind === 'pylon') this.drawPylon(entity, center, time)
    else if (entity.kind === 'ruin') this.drawRuin(entity, center)
    if (entity.selected) {
      this.effects.lineStyle(3, 0xffd889, 0.92)
      this.effects.strokeEllipse(center.x, center.y - 12, entity.width * 70, entity.height * 34)
    }
    if (flowVision && (entity.status === 'starved' || entity.status === 'blocked')) {
      const color = entity.status === 'starved' ? 0xffc15a : 0xff6672
      const pulse = 0.45 + Math.sin(time * 0.007) * 0.25
      this.effects.lineStyle(4, color, pulse)
      this.effects.strokeEllipse(center.x, center.y - 12, entity.width * 76, entity.height * 38)
      this.effects.fillStyle(color, 0.75 + pulse * 0.2)
      this.effects.fillCircle(center.x + (entity.status === 'starved' ? -1 : 1) * entity.width * 37, center.y - 10, 7 + pulse * 2)
    }
  }

  private drawCrop(entity: RenderEntity, center: GridPoint, time: number) {
    this.diamond(this.world, center.x, center.y, 78, 39, 0x463528, 1, 0x8d7555)
    this.world.lineStyle(2, 0x251d18, 0.55)
    this.world.lineBetween(center.x - 27, center.y - 2, center.x + 4, center.y + 13)
    this.world.lineBetween(center.x - 7, center.y - 12, center.x + 25, center.y + 4)
    const stage = entity.cropStage ?? 'empty'
    if (stage === 'empty') return
    const growth = stage === 'planted' ? 0.32 : stage === 'growing' ? 0.68 : 1
    const sway = Math.sin(time * 0.002 + entity.x * 1.7 + entity.y) * (stage === 'ripe' ? 2 : 0.7)
    const color = stage === 'ripe' ? 0x7be3be : 0x3cad84
    const glow = stage === 'ripe' ? 0.24 + Math.sin(time * 0.004 + entity.x) * 0.08 : 0
    if (glow) {
      this.world.fillStyle(0x6dffdb, glow)
      this.world.fillCircle(center.x, center.y - 13, 23)
    }
    this.world.lineStyle(3.5 * growth, 0x194f40, 1)
    this.world.lineBetween(center.x, center.y + 6, center.x + sway, center.y - 22 * growth)
    for (let index = 0; index < Math.ceil(growth * 5); index += 1) {
      const side = index % 2 === 0 ? -1 : 1
      const y = center.y - 2 - index * 4 * growth
      this.world.fillStyle(index === 4 && stage === 'ripe' ? 0xb5f26b : color, 1)
      this.world.fillEllipse(center.x + side * (7 + index) + sway, y, 16 * growth, 7 * growth)
    }
  }

  private drawBelt(entity: RenderEntity, center: GridPoint, time: number) {
    this.diamond(this.world, center.x, center.y, 86, 40, 0x313b38, 1, 0xb77845)
    this.world.lineStyle(2.2, 0xd08d52, 0.9)
    this.world.lineBetween(center.x - 34, center.y - 10, center.x + 34, center.y + 7)
    this.world.lineBetween(center.x - 34, center.y - 2, center.x + 34, center.y + 15)
    for (let index = -2; index <= 2; index += 1) {
      const offset = ((time * 0.025 + index * 17) % 66) - 33
      this.world.lineStyle(1.5, 0x8a9690, 0.5)
      this.world.lineBetween(center.x + offset, center.y - 8 + offset * 0.24, center.x + offset - 5, center.y + 6 + offset * 0.24)
    }
    for (const item of entity.beltItems ?? []) {
      const along = (item.progress - 0.5) * 66
      const laneOffset = item.lane === 0 ? -5 : 5
      const x = center.x + along - laneOffset * 1.8
      const y = center.y + along * 0.24 + laneOffset - 8
      this.world.fillStyle(0x101816, 0.4)
      this.world.fillEllipse(x + 2, y + 4, 15, 8)
      this.world.fillStyle(itemColor(item.item), 1)
      if (item.item === 'core') {
        this.world.fillTriangle(x, y - 8, x + 8, y, x, y + 8)
        this.world.fillTriangle(x, y - 8, x - 8, y, x, y + 8)
      } else this.world.fillCircle(x, y, item.item === 'gel' ? 7 : 5.5)
    }
  }

  private drawInserter(entity: RenderEntity, center: GridPoint, time: number) {
    const cycle = entity.progress || ((time / 1100 + entity.x * 0.1) % 1)
    const angle = -2.5 + Math.sin(cycle * Math.PI) * 1.2
    const elbowX = center.x + Math.cos(angle) * 18
    const elbowY = center.y - 15 + Math.sin(angle) * 9
    const handX = elbowX + Math.cos(angle + 0.55) * 18
    const handY = elbowY + Math.sin(angle + 0.55) * 10
    this.world.fillStyle(0x202824, 0.55)
    this.world.fillEllipse(center.x + 2, center.y + 5, 30, 15)
    this.world.fillStyle(0xc57a42, 1)
    this.world.fillCircle(center.x, center.y - 4, 10)
    this.world.lineStyle(7, 0xd38a4f, 1)
    this.world.lineBetween(center.x, center.y - 8, elbowX, elbowY)
    this.world.lineStyle(5, 0xf0b268, 1)
    this.world.lineBetween(elbowX, elbowY, handX, handY)
    this.world.fillStyle(0x342923, 1)
    this.world.fillCircle(elbowX, elbowY, 4)
    if (entity.carriedItem) {
      this.world.fillStyle(itemColor(entity.carriedItem), 1)
      this.world.fillCircle(handX, handY - 2, 6)
    }
  }

  private drawHopper(_entity: RenderEntity, center: GridPoint) {
    this.world.fillStyle(0x202724, 0.55)
    this.world.fillEllipse(center.x + 5, center.y + 8, 48, 22)
    this.world.fillStyle(0xe4ddc8, 1)
    this.world.fillTriangle(center.x - 25, center.y - 25, center.x + 25, center.y - 14, center.x + 18, center.y + 10)
    this.world.fillTriangle(center.x - 25, center.y - 25, center.x - 18, center.y, center.x + 18, center.y + 10)
    this.world.fillStyle(0x382f29, 1)
    this.world.fillEllipse(center.x, center.y - 20, 43, 18)
    this.world.lineStyle(3, 0xb26f3e, 1)
    this.world.strokeEllipse(center.x, center.y - 20, 43, 18)
  }

  private machineBase(center: GridPoint, width: number, height: number) {
    this.world.fillStyle(0x151a18, 0.5)
    this.world.fillEllipse(center.x + 8, center.y + 16, width * 0.9, height * 0.45)
    this.diamond(this.world, center.x, center.y + 4, width, height * 0.46, 0x423a31, 1, 0x9a623b)
  }

  private drawGelRefinery(entity: RenderEntity, center: GridPoint, time: number) {
    this.machineBase(center, 205, 104)
    this.world.fillStyle(0xe9e2cf, 1)
    this.world.fillRoundedRect(center.x - 72, center.y - 88, 144, 93, 24)
    this.world.fillStyle(0xc67a43, 1)
    this.world.fillRect(center.x - 68, center.y - 16, 136, 16)
    this.world.fillStyle(0x1b4949, 1)
    this.world.fillRoundedRect(center.x - 38, center.y - 74, 76, 62, 20)
    this.world.fillStyle(0x59e2df, 0.77)
    this.world.fillRoundedRect(center.x - 32, center.y - 66 + (1 - entity.progress) * 9, 64, 48 - (1 - entity.progress) * 9, 16)
    this.world.lineStyle(3, 0xa7ffff, 0.85)
    const waveY = center.y - 39 + Math.sin(time * 0.006) * 3
    this.world.lineBetween(center.x - 25, waveY, center.x + 25, waveY)
    this.world.fillStyle(0x8a532f, 1)
    this.world.fillCircle(center.x, center.y - 93, 19)
    this.world.lineStyle(4, 0xf2b566, 1)
    const angle = time * 0.003
    this.world.lineBetween(center.x, center.y - 93, center.x + Math.cos(angle) * 14, center.y - 93 + Math.sin(angle) * 14)
    this.drawStatusLamp(entity, center.x + 55, center.y - 58)
  }

  private drawFiberMill(entity: RenderEntity, center: GridPoint, time: number) {
    this.machineBase(center, 195, 98)
    this.world.fillStyle(0xddd8c8, 1)
    this.world.fillRoundedRect(center.x - 78, center.y - 76, 156, 75, 18)
    this.world.fillStyle(0x292e2c, 1)
    this.world.fillRoundedRect(center.x - 50, center.y - 61, 100, 38, 9)
    const spin = time * (entity.status === 'working' ? 0.006 : 0.001)
    for (const offset of [-26, 26]) {
      this.world.lineStyle(6, 0xc77c43, 1)
      this.world.strokeCircle(center.x + offset, center.y - 42, 15)
      this.world.lineBetween(center.x + offset, center.y - 42, center.x + offset + Math.cos(spin + offset) * 14, center.y - 42 + Math.sin(spin + offset) * 14)
    }
    this.world.lineStyle(5, 0xf3b969, 0.9)
    this.world.lineBetween(center.x - 27, center.y - 42, center.x + 27, center.y - 42)
    this.world.fillStyle(0xc77c43, 1)
    this.world.fillRect(center.x - 78, center.y - 14, 156, 13)
    this.drawStatusLamp(entity, center.x + 61, center.y - 52)
  }

  private drawAssembler(entity: RenderEntity, center: GridPoint, time: number) {
    this.machineBase(center, 205, 110)
    this.world.fillStyle(0xece6d4, 1)
    this.world.fillTriangle(center.x, center.y - 105, center.x + 82, center.y - 57, center.x + 62, center.y + 4)
    this.world.fillTriangle(center.x, center.y - 105, center.x - 82, center.y - 57, center.x - 62, center.y + 4)
    this.world.fillStyle(0x263c3a, 1)
    this.world.fillCircle(center.x, center.y - 50, 35)
    const pulse = 0.7 + Math.sin(time * 0.008) * 0.2
    this.world.fillStyle(0xe8ffff, pulse)
    this.world.fillTriangle(center.x, center.y - 78, center.x + 26, center.y - 50, center.x, center.y - 22)
    this.world.fillTriangle(center.x, center.y - 78, center.x - 26, center.y - 50, center.x, center.y - 22)
    this.world.lineStyle(5, 0xc57a42, 1)
    this.world.strokeCircle(center.x, center.y - 50, 42)
    this.drawStatusLamp(entity, center.x + 55, center.y - 76)
  }

  private drawExtractor(entity: RenderEntity, center: GridPoint, time: number) {
    this.machineBase(center, 130, 74)
    this.world.fillStyle(0xe9e1cf, 1)
    this.world.fillRoundedRect(center.x - 47, center.y - 69, 94, 64, 19)
    this.world.fillStyle(0x1e5c60, 1)
    this.world.fillCircle(center.x, center.y - 36, 27)
    this.world.lineStyle(5, 0x62e8e6, 1)
    this.world.strokeCircle(center.x, center.y - 36, 18 + Math.sin(time * 0.004) * 2)
    this.world.fillStyle(0xc67a43, 1)
    this.world.fillRect(center.x - 5, center.y - 93, 10, 27)
    this.drawStatusLamp(entity, center.x + 32, center.y - 52)
  }

  private drawDrill(entity: RenderEntity, center: GridPoint, time: number) {
    this.machineBase(center, 135, 76)
    this.world.fillStyle(0xe8e0cf, 1)
    this.world.fillRoundedRect(center.x - 48, center.y - 66, 96, 58, 14)
    this.world.fillStyle(0x3a2b4f, 1)
    this.world.fillTriangle(center.x - 16, center.y - 23, center.x + 16, center.y - 23, center.x, center.y + 24)
    this.world.fillStyle(0xa878ff, 0.92)
    const bob = Math.sin(time * 0.01) * 4
    this.world.fillTriangle(center.x, center.y - 79 + bob, center.x + 14, center.y - 46 + bob, center.x - 14, center.y - 46 + bob)
    this.world.fillStyle(0xc67a43, 1)
    this.world.fillRect(center.x - 48, center.y - 17, 96, 10)
    this.drawStatusLamp(entity, center.x + 33, center.y - 48)
  }

  private drawUplink(entity: RenderEntity, center: GridPoint, time: number) {
    this.machineBase(center, 96, 82)
    this.world.fillStyle(0xece6d8, 1)
    this.world.fillRoundedRect(center.x - 31, center.y - 98, 62, 90, 22)
    this.world.fillStyle(0x283a38, 1)
    this.world.fillCircle(center.x, center.y - 60, 20)
    this.world.lineStyle(4, 0x6ffff0, 0.8)
    this.world.strokeCircle(center.x, center.y - 60, 10 + Math.sin(time * 0.006) * 3)
    this.world.lineStyle(3, 0xc9844d, 1)
    this.world.lineBetween(center.x, center.y - 99, center.x, center.y - 126)
    this.world.strokeCircle(center.x, center.y - 133, 9)
    this.drawStatusLamp(entity, center.x + 21, center.y - 84)
  }

  private drawPylon(_entity: RenderEntity, center: GridPoint, time: number) {
    this.world.fillStyle(0x202723, 0.5)
    this.world.fillEllipse(center.x + 3, center.y + 7, 52, 23)
    this.world.fillStyle(0xded8c8, 1)
    this.world.fillRoundedRect(center.x - 15, center.y - 62, 30, 62, 7)
    this.world.fillStyle(0xc67a43, 1)
    this.world.fillRect(center.x - 21, center.y - 39, 42, 9)
    this.world.fillStyle(0x6fffe9, 0.72 + Math.sin(time * 0.005) * 0.2)
    this.world.fillCircle(center.x, center.y - 72, 10)
  }

  private drawRuin(entity: RenderEntity, center: GridPoint) {
    this.world.fillStyle(0x181c1a, 0.45)
    this.world.fillEllipse(center.x, center.y + 8, 110 * entity.width, 35 * entity.height)
    this.world.lineStyle(11, 0x403f39, 1)
    if (entity.decorativeVariant === 0) {
      this.world.strokeCircle(center.x, center.y - 30, 47)
      this.world.lineStyle(5, 0x816044, 0.5)
      this.world.strokeCircle(center.x, center.y - 30, 32)
    } else if (entity.decorativeVariant === 1) {
      this.world.lineBetween(center.x - 90, center.y - 18, center.x + 90, center.y + 18)
      this.world.lineStyle(3, 0xa96e42, 0.55)
      for (let offset = -60; offset <= 60; offset += 30) this.world.strokeCircle(center.x + offset, center.y + offset * 0.2, 9)
    } else {
      this.world.lineBetween(center.x - 28, center.y, center.x, center.y - 78)
      this.world.strokeEllipse(center.x + 19, center.y - 82, 55, 22)
    }
    this.drawAlienTuft(this.world, center.x - 22, center.y - 2, 0.9, 0x32a891)
  }

  private drawStatusLamp(entity: RenderEntity, x: number, y: number) {
    const color = entity.status === 'working' ? 0x63e49e : entity.status === 'starved' ? 0xffbf58 : entity.status === 'blocked' ? 0xff6672 : 0x76908a
    this.world.fillStyle(0x212724, 1)
    this.world.fillCircle(x, y, 7)
    this.world.fillStyle(color, 1)
    this.world.fillCircle(x, y, 3.5)
  }

  private drawAlienTuft(graphics: Phaser.GameObjects.Graphics, x: number, y: number, scale: number, color: number) {
    graphics.lineStyle(2.4 * scale, color, 0.85)
    graphics.lineBetween(x, y, x - 7 * scale, y - 14 * scale)
    graphics.lineBetween(x, y, x + 2 * scale, y - 18 * scale)
    graphics.lineBetween(x, y, x + 10 * scale, y - 11 * scale)
    graphics.fillStyle(0x75e7ce, 0.8)
    graphics.fillCircle(x + 2 * scale, y - 19 * scale, 2.6 * scale)
  }

  private drawDrone(snapshot: RenderSnapshot, time: number) {
    const drone = snapshot.drone
    let x = drone.x
    let y = drone.y
    if (drone.action?.kind === 'move' && drone.action.from && drone.action.to) {
      const progress = 1 - drone.action.remainingMs / drone.action.totalMs
      x = Phaser.Math.Linear(drone.action.from.x, drone.action.to.x, progress)
      y = Phaser.Math.Linear(drone.action.from.y, drone.action.to.y, progress)
    }
    const center = iso({ x: x + 0.5, y: y + 0.5 })
    const hover = snapshot.mission.phase && !snapshot.drone.action && snapshot.drone.status === 'idle' ? Math.sin(time * 0.005) * 2 : Math.sin(time * 0.012) * 3
    const bodyY = center.y - 54 + hover
    this.world.fillStyle(0x121917, 0.35)
    this.world.fillEllipse(center.x + 7, center.y + 7, 58, 22)
    this.world.fillStyle(0xded9c8, 1)
    this.world.fillRoundedRect(center.x - 30, bodyY - 14, 60, 28, 12)
    this.world.fillStyle(0xc47741, 1)
    this.world.fillRoundedRect(center.x - 12, bodyY - 19, 24, 38, 7)
    this.world.fillStyle(0x254d4b, 1)
    this.world.fillCircle(center.x - 19, bodyY, 7)
    this.world.fillStyle(0x77f7e6, 1)
    this.world.fillCircle(center.x - 19, bodyY, 3.5)
    for (const side of [-1, 1]) {
      const rotorX = center.x + side * 36
      this.world.lineStyle(4, 0x51473e, 1)
      this.world.lineBetween(center.x + side * 22, bodyY, rotorX, bodyY - 4)
      this.world.lineStyle(2, 0xe7f8ed, 0.45)
      this.world.strokeEllipse(rotorX, bodyY - 5, 32 + Math.sin(time * 0.08) * 3, 8)
    }
    const cargo = drone.cargo.reduce((total, stack) => total + stack.amount, 0)
    if (cargo > 0) {
      this.world.fillStyle(0x24312d, 1)
      this.world.fillRoundedRect(center.x + 12, bodyY + 4, 22, 18, 4)
      this.world.fillStyle(0xc9f06d, 1)
      for (let index = 0; index < Math.min(3, cargo); index += 1) this.world.fillCircle(center.x + 18 + index * 5, bodyY + 9, 3)
    }
    if (drone.status === 'harvesting') {
      this.effects.lineStyle(3, 0x8dffe5, 0.55 + Math.sin(time * 0.02) * 0.2)
      this.effects.lineBetween(center.x, bodyY + 18, center.x, center.y - 2)
      this.effects.strokeCircle(center.x, center.y - 2, 13 + Math.sin(time * 0.015) * 4)
    }
  }

  private drawFlowVision(snapshot: RenderSnapshot, time: number) {
    for (let index = 1; index < snapshot.drone.pathHistory.length; index += 1) {
      const previous = snapshot.drone.pathHistory[index - 1]
      const current = snapshot.drone.pathHistory[index]
      const a = iso({ x: previous.x + 0.5, y: previous.y + 0.5 })
      const b = iso({ x: current.x + 0.5, y: current.y + 0.5 })
      this.effects.lineStyle(current.loaded ? 4 : 2, current.loaded ? 0x69f0bf : 0x9bb3ad, Math.max(0.12, 1 - current.ageMs / 12_000))
      this.effects.lineBetween(a.x, a.y - 33, b.x, b.y - 33)
    }
    const pulse = 0.55 + Math.sin(time * 0.006) * 0.2
    const uplink = snapshot.entities.find((candidate) => candidate.kind === 'uplink')
    if (uplink) {
      const center = iso({ x: uplink.x + 0.5, y: uplink.y + 1 })
      this.effects.lineStyle(2, 0x8df6e6, pulse)
      this.effects.strokeCircle(center.x, center.y - 62, 38)
    }
  }

  private drawWorldFeedback(snapshot: RenderSnapshot) {
    const delivery = [...snapshot.events].reverse().find((event) => event.type === 'coreDelivered')
    if (!delivery) return
    const age = snapshot.tick - delivery.tick
    if (age < 0 || age > 24) return
    const uplink = snapshot.entities.find((candidate) => candidate.kind === 'uplink')
    if (!uplink) return
    const center = iso({ x: uplink.x + 0.5, y: uplink.y + 1 })
    const progress = age / 24
    this.effects.lineStyle(7 * (1 - progress), 0xd8fff8, 1 - progress)
    this.effects.strokeCircle(center.x, center.y - 65, 28 + progress * 120)
    this.effects.fillStyle(0x91ffe5, (1 - progress) * 0.2)
    this.effects.fillCircle(center.x, center.y - 65, 34 + progress * 45)
  }

  private drawConstructionHints(snapshot: RenderSnapshot, time: number) {
    if (snapshot.mission.phase !== 3) return
    const slots = [
      { x: 11, y: 6, connected: snapshot.entities.some((entry) => entry.kind === 'inserter' && entry.x === 11 && entry.y === 6) },
      { x: 11, y: 11, connected: snapshot.entities.some((entry) => entry.kind === 'inserter' && entry.x === 11 && entry.y === 11) },
    ]
    for (const slot of slots) {
      if (slot.connected) continue
      const center = iso({ x: slot.x + 0.5, y: slot.y + 0.5 })
      const pulse = 0.65 + Math.sin(time * 0.008 + slot.y) * 0.2
      this.effects.lineStyle(3, 0xffc861, pulse)
      this.effects.strokeEllipse(center.x, center.y - 5, 56 + pulse * 8, 28 + pulse * 4)
      this.effects.lineBetween(center.x - 8, center.y - 5, center.x + 8, center.y - 5)
      this.effects.lineBetween(center.x, center.y - 13, center.x, center.y + 3)
    }
  }

  private updateLabels(snapshot: RenderSnapshot) {
    const visible = new Set<string>()
    for (const entity of snapshot.entities) {
      const meteredBelt = snapshot.flowVision && (/-(belt)-16$/.test(entity.id) || entity.id === 'core-belt-25')
      if (!entity.selected && !(snapshot.flowVision && ['gelRefinery', 'fiberMill', 'coreAssembler', 'uplink'].includes(entity.kind)) && !meteredBelt) continue
      visible.add(entity.id)
      let label = this.labels.get(entity.id)
      if (!label) {
        label = this.add.text(0, 0, '', {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          fontStyle: '600',
          color: '#f5f0df',
          backgroundColor: '#19221fd9',
          padding: { x: 8, y: 5 },
        }).setOrigin(0.5, 1).setDepth(40)
        this.labels.set(entity.id, label)
      }
      const center = iso({ x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 })
      const status = entity.status === 'starved' ? ' · 缺料' : entity.status === 'blocked' ? ' · 堵塞' : ''
      const movingRate = Math.round((entity.beltItems?.length ?? 0) * (60 / 1.35))
      label.setText(meteredBelt ? `${movingRate} items/min` : `${entity.name}${status}`).setPosition(center.x, center.y - entity.height * 45 - 42).setVisible(true)
    }
    for (const [id, label] of this.labels) if (!visible.has(id)) label.setVisible(false)
  }
}
