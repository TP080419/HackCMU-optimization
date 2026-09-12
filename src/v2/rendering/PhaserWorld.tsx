import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import type { XenoFlowEngine } from '../engine'
import type { EntityKind } from '../types'
import { FactoryScene } from './FactoryScene'

interface PhaserWorldProps {
  engine: XenoFlowEngine
  buildTool: EntityKind | null
  onToggleCode: () => void
  onReady?: () => void
}

export function PhaserWorld({ engine, buildTool, onToggleCode, onReady }: PhaserWorldProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const toolRef = useRef(buildTool)
  const codeRef = useRef(onToggleCode)
  const readyRef = useRef(onReady)
  toolRef.current = buildTool
  codeRef.current = onToggleCode
  readyRef.current = onReady

  useEffect(() => {
    if (!hostRef.current) return
    const scene = new FactoryScene({
      snapshot: () => engine.snapshot(),
      dispatch: (command) => engine.dispatch(command),
      getBuildTool: () => toolRef.current,
      onToggleCode: () => codeRef.current(),
      onWorldReady: () => readyRef.current?.(),
    })
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      width: hostRef.current.clientWidth,
      height: hostRef.current.clientHeight,
      backgroundColor: '#1b211d',
      antialias: true,
      render: { antialias: true, pixelArt: false, roundPixels: true },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene,
      audio: { disableWebAudio: false },
    })
    return () => game.destroy(true)
  }, [engine])

  return <div className="phaser-world" ref={hostRef} aria-label="Sector 01 交互世界" />
}
