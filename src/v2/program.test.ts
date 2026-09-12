import { describe, expect, it } from 'vitest'
import { createProgramRuntime, executeProgram, parseProgram, resumeProgramAfterAction } from './program'
import type { ProgramValue } from './types'

const context = {
  readSensor(name: string): ProgramValue {
    if (name === 'farm_zone') return ['a', 'b']
    if (name === 'is_ripe') return true
    if (name === 'cargo_free') return 3
    throw new Error(`unknown sensor ${name}`)
  },
  createAction(name: string, args: ProgramValue[], line: number) {
    if (name === 'move_to' || name === 'harvest' || name === 'plant' || name === 'load' || name === 'unload' || name === 'wait') return { name, args, line } as const
    return null
  },
}

describe('safe Python-like runtime', () => {
  it('parses nested demand-driven control flow', () => {
    const ast = parseProgram(`while True:\n    for plot in farm_zone():\n        if is_ripe(plot):\n            move_to(plot)\n            harvest()`)
    expect(ast.diagnostics).toEqual([])
    expect(ast.body[0]?.kind).toBe('while')
  })

  it('rejects imports and attribute access', () => {
    expect(parseProgram('import os').diagnostics[0]?.message).toContain('不支持 import')
    expect(parseProgram('window.location').diagnostics[0]?.message).toContain('属性访问')
  })

  it('yields one deterministic world action at a time', () => {
    const runtime = createProgramRuntime(`for plot in farm_zone():\n    move_to(plot)\n    harvest()`)
    runtime.mode = 'running'
    expect(executeProgram(runtime, context)).toMatchObject({ name: 'move_to', args: ['a'] })
    expect(executeProgram(runtime, context)).toBeNull()
    resumeProgramAfterAction(runtime)
    expect(executeProgram(runtime, context)).toMatchObject({ name: 'harvest' })
    resumeProgramAfterAction(runtime)
    expect(executeProgram(runtime, context)).toMatchObject({ name: 'move_to', args: ['b'] })
  })

  it('blocks recursion before accessing the host environment', () => {
    const runtime = createProgramRuntime(`def again():\n    again()\nagain()`)
    runtime.mode = 'running'
    expect(executeProgram(runtime, context)).toBeNull()
    expect(runtime.mode).toBe('error')
    expect(runtime.lastError).toContain('递归')
  })
})
