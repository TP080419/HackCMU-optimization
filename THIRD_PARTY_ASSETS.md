# Asset provenance

XenoFlow V2 没有捆绑第三方游戏美术、字体或音频文件，运行时也不会从 CDN 请求资源。

`public/assets/v2/sector-01-art-direction.png` 是使用 OpenAI ImageGen 为本项目生成的原创美术标尺，用于启动画面并统一地形、作物、Drone、Belt、Inserter 与机器的材质方向。

游戏世界中的可交互地形、四阶段作物、Drone、双通道 Belt、Inserter、Hopper、Gel Refinery、Fiber Mill、Core Assembler、资源设备、Uplink、阴影和状态反馈均由 `src/v2/rendering/FactoryScene.ts` 本地程序化绘制。

早期调研曾检查 Kenney Tiny Factory 与 Tiny Farm，但未复制或打包其中任何文件。
