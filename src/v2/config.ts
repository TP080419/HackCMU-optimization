import type { EntityKind, ItemId } from './types'

export const SIM_STEP_MS = 100
export const MAP_WIDTH = 30
export const MAP_HEIGHT = 18
export const TILE_WIDTH = 96
export const TILE_HEIGHT = 48
export const DRONE_CAPACITY = 6
export const INSTRUCTION_BUDGET_PER_TICK = 240
export const LOOP_BUDGET = 10_000
export const MAX_CALL_DEPTH = 8
export const SAVE_KEY = 'xenoflow.v2.sector-01'
export const SETTINGS_KEY = 'xenoflow.v2.settings'

export const ITEM_COLORS: Record<ItemId, number> = {
  xenograin: 0xc9f06d,
  water: 0x59dce5,
  crystite: 0xa979ff,
  gel: 0x66e0bd,
  biofiber: 0xffb768,
  core: 0xf4fbff,
}

export const BUILD_COSTS: Partial<Record<EntityKind, number>> = {
  belt: 2,
  inserter: 9,
  hopper: 14,
  waterExtractor: 35,
  crystiteDrill: 45,
  gelRefinery: 60,
  fiberMill: 65,
  coreAssembler: 100,
  pylon: 50,
}

export const MACHINE_RECIPES = {
  gel: {
    inputs: { xenograin: 2, water: 1 },
    output: 'gel' as const,
    durationMs: 4_000,
  },
  biofiber: {
    inputs: { xenograin: 1, crystite: 1 },
    output: 'biofiber' as const,
    durationMs: 4_800,
  },
  core: {
    inputs: { gel: 1, biofiber: 1 },
    output: 'core' as const,
    durationMs: 6_000,
  },
} as const

export const PHASES = [
  {
    phase: 1,
    title: '唤醒农田',
    objective: '运行程序，让无人机完成第一次收割与投递',
    hint: '从六行程序开始。世界中的每个动作都会占用模拟时间。',
  },
  {
    phase: 2,
    title: '建立循环',
    objective: '用 is_ripe、for 与 while 建立持续农业循环',
    hint: '不同地块的成熟速度不同；固定等待会浪费大量飞行时间。',
  },
  {
    phase: 3,
    title: '接入工厂',
    objective: '在两个发光接口放置 Inserter，接通 Gel 与 Fiber 输入',
    hint: '先在建造栏选择机械臂，再点击两个黄色施工环；机器不会直接吸取 Hopper。',
  },
  {
    phase: 4,
    title: '需求调度',
    objective: '使用 need() 让两台机器不再争夺 Xenograin',
    hint: '投递给当前最缺料的端点，比轮流送货更稳定。',
  },
  {
    phase: 5,
    title: '稳定性挑战',
    objective: '交付 6 Core，并连续 90 秒维持目标吞吐与效率',
    hint: '代码和布局都会影响结果；修改任意一项会重新计时。',
  },
  {
    phase: 6,
    title: 'Sector 01 稳定',
    objective: 'Sandbox 已开放：继续重构你的活体产线',
    hint: 'Benchmark 可以从相同快照反复比较程序。',
  },
] as const

export const UNLOCKED_BUILDINGS_BY_PHASE: Record<number, EntityKind[]> = {
  1: [],
  2: [],
  3: ['belt', 'inserter', 'hopper', 'waterExtractor', 'crystiteDrill'],
  4: ['belt', 'inserter', 'hopper', 'waterExtractor', 'crystiteDrill', 'gelRefinery', 'fiberMill'],
  5: ['belt', 'inserter', 'hopper', 'waterExtractor', 'crystiteDrill', 'gelRefinery', 'fiberMill', 'coreAssembler', 'pylon'],
  6: ['belt', 'inserter', 'hopper', 'waterExtractor', 'crystiteDrill', 'gelRefinery', 'fiberMill', 'coreAssembler', 'pylon'],
}

export const STARTER_PROGRAM = `# Sector 01 / first contact
move_to("plot-0-0")
harvest()
move_to("gel_input")
unload("gel_input", XENOGRAIN, 1)
move_to("home")`

export const BASELINE_PROGRAM = `# A working but wasteful fixed patrol
while True:
    for plot in farm_zone():
        move_to(plot)
        if is_ripe(plot) and cargo_free() > 0:
            harvest()

    move_to("gel_input")
    unload("gel_input", XENOGRAIN, 4)
    move_to("fiber_input")
    unload("fiber_input", XENOGRAIN, 2)
    wait(1)`

export const LOOP_PROGRAM = `while True:
    for plot in farm_zone():
        if is_ripe(plot) and cargo_free() > 0:
            move_to(plot)
            harvest()

    if need("gel_refinery", XENOGRAIN) >= 2:
        move_to("gel_input")
        unload("gel_input", XENOGRAIN, 4)

    if need("fiber_mill", XENOGRAIN) >= 1:
        move_to("fiber_input")
        unload("fiber_input", XENOGRAIN, 2)

    wait(0.5)`
