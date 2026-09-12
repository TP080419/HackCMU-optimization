# XenoFlow V2 — The Living Line

XenoFlow 是一款本地运行的异星农业 / 工厂自动化编程游戏。玩家不是分别解决“代码题”和“摆产线题”：农业无人机读取作物成熟度与机器实时需求，实体 Hopper、Inserter、双通道 Belt 和多格机器再把同一批物料变成 Terraform Core。

当前版本只实现一个 20–30 分钟的核心章节 `Sector 01 — The Living Line` 和通关后的 Sandbox。项目刻意不加入战斗、多人、后端、随机地图、第二架无人机或大型科技树。

## 本地运行

要求 Node.js 20+ 与 npm。

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

完整验证：

```bash
npm run typecheck
npm test
npm run build
```

## 核心循环

```text
观察作物与机器需求
        ↓
修改 Python-like 调度程序 ←→ 移动机器、端点和物流
        ↓
无人机批量收割 / 混装 / 投递
        ↓
Hopper → Inserter → Machine → 双通道 Belt
        ↓
在同一世界快照上 Benchmark，再继续优化
```

生产链固定为六种物品：

```text
Xenograin + Water → Nutrient Gel
Xenograin + Crystite → Biofiber
Gel + Biofiber → Terraform Core
```

- Crop Plot 具有 `empty → planted → growing → ripe` 生命周期与不同生长速度。
- 收割获得 2 份 Xenograin，其中 1 份立即用于早期自动回种，因此无人机净装载 1 份；空地仍可通过 `plant()` 明确播种。
- Drone 容量为 6，Cargo 使用多物品堆栈。
- 机器有真实输入 / 输出缓存，不能直接从相邻 Belt 吸取物品。
- Inserter 是机器和物流之间唯一的自动搬运方式。
- Belt 以两个独立通道运输逐个物品。
- 玩家拖出的直角 Belt 会按方向自动接线；自由建造的 Inserter 从背面取料、向正面投料，Hopper 可作为中间缓存。

## 五步章节

1. **唤醒农田**：运行六行程序，在首次动作后 5 秒内看到无人机收割。
2. **建立循环**：用 `for`、`while`、`if` 和 `is_ripe()` 替代一次性路线。
3. **接入工厂**：让 Gel Refinery 与 Fiber Mill 都完成加工，解锁实体建造栏。
4. **需求调度**：使用 `need()` 解决两台机器争抢 Xenograin 的问题。
5. **稳定性挑战**：累计交付 6 Core；连续 90 模拟秒保持至少 1 Core/min、空载移动低于 35%、电力稳定不低于 90%。

代码或布局被修改后，稳定性计时会重新开始。完成后只开放 Sector 01 Sandbox。

## 操作

| 操作 | 功能 |
| --- | --- |
| 拖动世界 | 平移镜头 |
| 滚轮 | 缩放镜头 |
| 双击机器 / 告警 | 聚焦目标 |
| `Shift` + 拖动机器 | 重新布置机器或输入端点 |
| 拖动放置 Belt | 建造直角连续 Belt |
| `R` | 旋转选中实体 |
| `Delete` | 拆除选中实体（80% 退款） |
| `Tab` | 开关 Flow Vision |
| `C` | 开关代码工作台 |
| `B` | 开关 Benchmark |
| `Esc` | 取消建造工具 |

## 安全 Python-like 工作台

CodeMirror 6 提供行号、Python 高亮、自动缩进、括号补全、世界 API 自动完成、当前执行行、行内诊断和变量观察。

```python
while True:
    for plot in farm_zone():
        if is_ripe(plot) and cargo_free() > 0:
            move_to(plot)
            harvest()

    if need("gel_refinery", XENOGRAIN) >= 2:
        move_to("gel_input")
        unload("gel_input", XENOGRAIN, 4)
```

支持变量、数字 / 布尔 / 字符串、算术与比较、`if / elif / else`、`for`、`while`、函数、参数与 `return`。世界 API 包括 `move_to`、`harvest`、`plant`、`load`、`unload`、`wait`、`farm_zone`、`is_ripe`、`need`、`cargo_free`、`cargo` 与 `distance_to`。

运行时使用自有 tokenizer、缩进解析器、白名单 AST 和确定性字节码解释器；没有 `eval`。它拒绝 `import`、属性访问、类、异步、生成器、动态执行和递归，并限制每 tick 指令数、循环次数与调用深度，因此无法访问 JavaScript、DOM、网络或文件系统。

## Flow Vision 与 Benchmark

`Tab` 将诊断直接放回世界：

- 产线显示 `items/min`；
- 缺料输入以黄色脉冲标记，堵塞输出使用红色轮廓；
- Drone 载货 / 空载轨迹使用不同线型；
- 工作台统计各行执行成本，Flow Vision 显示最耗时三行；
- 点击机器才打开上下文卡片。

Benchmark 首次打开时锁定当前完整状态，分别从同一 tick 运行固定巡逻基线和当前程序 120 模拟秒；修改代码后仍复用原快照，只有点击“更新基准快照”才重新取样。它比较 Core/min、空载移动、Xenograin 格距、两台机器缺料、Belt 堵塞与能耗，不修改正式存档。测试门槛要求需求驱动程序至少提高 15% 产量并减少 20% 空载移动。

## 架构

- React 19：菜单、悬浮 HUD、任务、建造栏、设置、Benchmark 与 CodeMirror 抽屉。
- Phaser 4.2.1：100dvw × 100dvh 世界、等距镜头、WebGL / Canvas fallback、输入与实体动画。
- Web Audio：只在玩家手势后启动本地合成环境声、机器节奏与操作反馈，并遵循静音 / 音量设置。
- 纯 TypeScript 模拟：严格 100ms 固定步长，不使用 Phaser 物理引擎。
- Vitest：V1 回归、V2 解释器、确定性、存档、优化门槛与 300 Belt / 600 物品压力场景。

关键接口位于 `src/v2/types.ts`：`SimulationStateV2`、`GameCommand`、`SimulationEvent`、`RenderSnapshot`、`ProgramAst`、`ProgramRuntime` 与 `BenchmarkResult`。

边界规则：

- React 只提交 `GameCommand`；
- Phaser 只消费 `RenderSnapshot`，不拥有生产规则；
- 状态保持 JSON 可序列化；
- V2 保存键位于 `xenoflow.v2.*`；V1 存档不会被迁移或删除；
- `src/game/` 中的 V1 模拟与测试保留为冻结回归参考。

当前稳定旧版标记为 Git tag `v1.0`，V2 开发位于 `v2-core` 分支。

## 视觉资源

世界采用原创“明亮异星农业 + 实体工业”方向：暖灰岩土、青绿植被、紫色晶体、浅蓝水面、象牙白机壳和铜色机械结构。建筑依靠轮廓与动画区分，不以字母缩写作为主体。

美术标尺 `public/assets/v2/sector-01-art-direction.png` 由 OpenAI ImageGen 为本项目生成；实际可交互实体由 Phaser 本地程序化图形渲染。项目没有捆绑 Kenney 或其他第三方美术资源，运行时不发起外部网络请求。
