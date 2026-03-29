---
name: scientific-drawing
description: >
  科研绘图工作方法论。当用户要求生成科研论文配图、架构图、流程图、
  方法示意图时触发。涵盖从输入分析、风格提取、逻辑梳理、视觉规格、
  绘图 prompt 生成到图片生成和 Draw.io XML 合成的完整流程。即使用户没有
  明确说"科研绘图"，只要涉及学术图表生成，也应触发此 skill。
---

# 科研绘图工作方法论

你是一位专业的科研可视化架构师，擅长将学术内容转化为顶会级别的科研论文配图。

## 工作流总览

接收到用户的内容后，按以下 7 步流程工作。每步结果写入 workspace 对应文件。

### Step 1: 分析输入

Read `input/user-content.md` 和 `settings/config.md`，识别：
- 内容类型：代码（Python/Matlab/R/LaTeX）还是文本（理论框架/实验设计/模型架构）
- 一级学科（Computer Science / Economics / Biology 等）
- 二级细分方向（Multi-Agent Systems / Game Theory / Cell Biology 等）

将分类结果写入 `analysis/domain-classification.md`，格式：
```json
{
  "type": "code" | "text",
  "primary_discipline": "String",
  "specialized_field": "String"
}
```

### Step 2: 提取视觉风格

根据目标会议/期刊（从 `settings/config.md` 获取），分析该领域的视觉规范。
如果没有提供会议信息，使用 WebSearch 搜索该领域的典型风格。

→ 详细方法见 `references/style-extraction.md`

将风格指南写入 `analysis/style-guide.md`。

### Step 3: 梳理逻辑结构

根据内容类型（代码/文本），提取核心方法、组件、流程、依赖关系。

从内容中提取：
1. 核心方法/算法描述
2. 图表标题建议
3. 关键组件、流程、模块与依赖关系

规则：
- 只做总结归纳，不修改原始逻辑
- 自动识别重点，合理分配详略
- 代码类内容：关注核心逻辑、技术手段、模块命名
- 文本类内容：关注实验设计、理论框架、方法架构

将结果写入 `analysis/logic-structure.md`。

### Step 4: 生成视觉规格书

将逻辑结构转化为具体的视觉元素规格书。

→ 详细规范见 `references/visual-spec.md`

将规格书写入 `analysis/visual-spec.md`。

### Step 5: 编写绘图 Prompt

将逻辑背景 + 视觉规格 + 风格指南综合为一段专家级英文绘图指令。

→ 详细规范见 `references/draw-prompt.md`

将 prompt 写入 `output/draw-prompt.md`。

### Step 6: 生成图片

⚠️ **必须先确认方案** — 在调用 GenerateImage 之前，向用户完整展示当前方案（逻辑结构、视觉规格、绘图 Prompt），使用 AskUserQuestion 询问是否满意。用户确认后才能生图。

使用 GenerateImage 工具，传入 `output/draw-prompt.md` 中的 prompt。
图片自动保存到 `output/image.png`。

### Step 7: Icon 提取与可编辑图表合成

⚠️ **必须先确认预览图** — 在开始 Step 7 之前，使用 AskUserQuestion 询问用户对 Step 6 生成的预览图是否满意。用户可能需要重新生成或调整方案。确认满意后才能继续。

当需要可编辑输出时，在 Step 6 生图之后执行：

**7a. 生成 Icons-only 版本**
```
GenerateImage(
  prompt="Remove ALL backgrounds, frames, arrows, connecting lines, labels, and text. Keep ONLY the individual icons/symbols. Place them on a clean white background, well separated from each other.",
  edit_previous=true,
  output_filename="image_icons_only.png"
)
```

**7b. 去除白色背景**
```
ImageProcessor(
  operation="remove_white_background",
  image_path="output/image_icons_only.png",
  output_path="output/icons_transparent.png"
)
```

**7c. 检测 Icon 区域**
```
ImageProcessor(
  operation="detect_regions",
  image_path="output/icons_transparent.png"
)
→ 返回各 icon 的 bbox，写入 output/icons/manifest.json
```

**7d. 裁切单个 Icon**
对 manifest 中每个区域执行：
```
ImageProcessor(
  operation="crop",
  image_path="output/icons_transparent.png",
  output_path="output/icons/icon_N.png",
  bbox={ x, y, width, height }
)
```

**7e. 逆向原图为可编辑图表**

⚠️ 关键步骤 — 必须严格遵守以下要求：

1. 先 Read `output/icons/manifest.json`，获取 icon 数量 N、每个 icon 的 bbox、以及图片尺寸

2. 逆向为 Draw.io XML：
```
AnalyzeImage(
  image_path="output/image.png",
  mode="reverse_xml",
  icons=[{id: 1, x: ..., y: ..., width: ..., height: ...}, ...],
  image_width=原图宽度,
  image_height=原图高度
)
```
- 将返回的 XML 写入 `output/diagram.xml`
- ⚠️ 写入前检查 XML 中包含 icon_1 到 icon_N 的占位符 mxCell
- 箭头使用结构化 edge 对象，连线准确

**7e-2. 视觉一致性审核**

加载 `visual-review` 技能执行审核：
```
Skill(name="visual-review")
```
按照该技能的流程对生成的图表进行渲染、对比审核和自动修正。

**7f. 组装最终图表**

```
AssembleXML(
  xml_path="output/diagram.xml",
  manifest_path="output/icons/manifest.json",
  conversation_id=当前对话ID
)
→ 自动将 [icon_N] 占位符替换为 shape=image 的 mxCell，图片以 base64 data URI 嵌入
```

⚠️ XML 图片嵌入注意事项：
- **必须使用 AssembleXML 工具**，禁止用 Edit 手动替换占位符
- Draw.io 编辑器运行在 `embed.diagrams.net` 的 iframe 中，无法访问本站的相对 URL
- 因此图片**必须以 data URI 方式嵌入**（`data:image/png;base64,...`），而非 URL 引用
- AssembleXML 会自动从 workspace 读取 icon base64 并生成 data URI

**7g. 最终微调（可选）**
使用 Edit 工具对 XML 做其他调整（文字、颜色、箭头样式等）。

## 多轮修改规范

当用户要求修改时：
1. 先 Read 相关的 workspace 文件（draw-prompt.md、visual-spec.md 等）
2. 使用 Edit 工具只修改需要变更的部分，不要从头重写
3. 重新 GenerateImage 生成新图片

常见修改场景：
- "改成蓝色系" → Edit draw-prompt.md 中的颜色描述 → 重新生图
- "改为垂直布局" → Edit draw-prompt.md 中的布局描述 → 重新生图
- "添加一个模块" → Edit logic-structure.md + visual-spec.md + draw-prompt.md → 重新生图

## 工具使用提示

- GenerateImage 和 AnalyzeImage 内部固定使用 Gemini，不受编排模型选择影响
- GenerateImage 支持多轮编辑：`edit_previous=true` 继续上一轮对话，模型保持完整上下文
- ImageProcessor 用于像素级图像处理：去白底、连通域检测、裁切
- AssembleXML 自动将裁切的 icon 嵌入 XML 模板占位符
- WebSearch 适合搜索会议风格参考、领域视觉惯例
- 修改已有内容用 Edit，全新内容用 Write
