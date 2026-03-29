import { WorkspaceDefinition } from '../../types'

export const scientificDiagramWorkspace: WorkspaceDefinition = {
  name: 'scientific-diagram',
  description: '科研绘图工作区，包含从输入分析到图片生成的完整文件结构',
  files: [
    // === Read-only Guide ===
    {
      path: 'GUIDE.md',
      description: '科研绘图工作流指南（只读）',
      readOnly: true,
      resolver: {
        type: 'static',
        content: `# 科研绘图工作区

## 文件结构
- \`input/user-content.md\` — 用户原始输入
- \`analysis/\` — 分析结果（领域分类、逻辑结构、风格指南、视觉规格）
- \`output/\` — 生成产物（绘图 prompt、图片、SVG）
  - \`output/image.png\` — 生成的完整科研图
  - \`output/image_icons_only.png\` — Icons-only 版本（白底）
  - \`output/icons_transparent.png\` — 透明背景 icons
  - \`output/icons/manifest.json\` — Icon 区域检测结果
  - \`output/icons/icon_N.png\` — 单个 icon 图片
  - \`output/diagram.xml\` — Draw.io mxGraph XML 图表（可编辑）
- \`settings/config.md\` — 配置信息（目标会议、图片尺寸等）

## 工作流
1. Read input/user-content.md 了解需求
2. 分析领域和逻辑结构，写入 analysis/
3. 提取视觉风格，生成视觉规格书
4. 编写绘图 prompt，写入 output/draw-prompt.md
5. 使用 GenerateImage 生成图片
6. Icon 提取与 SVG 合成（可选）：
   a. GenerateImage(edit_previous=true) → icons-only 版本
   b. ImageProcessor(remove_white_background) → 透明 PNG
   c. ImageProcessor(detect_regions) → manifest.json
   d. ImageProcessor(crop) × N → 单个 icon
   e. AnalyzeImage → Draw.io XML 模板（带占位符）
   e-2. 视觉一致性审核
   f. AssembleXML → 嵌入 icon 的最终 XML
   g. Edit 微调细节

⚠️ 关键确认节点（不可跳过）：
$1. 生图前：向用户展示完整方案并确认
$2. Icon 提取/逆向前：确认用户对预览图满意
$3. 所有特定功能工具执行前：使用 AskUserQuestion 获得用户授权
$1. 生图前：向用户展示完整方案并确认
$2. Icon 提取/逆向前：确认用户对预览图满意
$3. 所有特定功能工具执行前：使用 AskUserQuestion 获得用户授权
$1. 生图前：向用户展示完整方案并确认
$2. Icon 提取/逆向前：确认用户对预览图满意
$3. 所有特定功能工具执行前：使用 AskUserQuestion 获得用户授权

## 多轮修改
- 先 Read 已有文件，再 Edit 修改需要变更的部分
- 不要从头重写，只修改用户要求变更的内容
`,
      },
    },

    // === Input ===
    {
      path: 'input/user-content.md',
      description: '用户原始输入内容',
      resolver: { type: 'field', field: 'user_input' },
    },

    // === Analysis ===
    {
      path: 'analysis/domain-classification.md',
      description: '领域分类结果（如 CS、生物学、经济学等）',
      resolver: { type: 'field', field: 'analysis.domain_classification' },
    },
    {
      path: 'analysis/logic-structure.md',
      description: '逻辑结构分析（核心方法、组件、流程、依赖关系）',
      resolver: { type: 'field', field: 'analysis.logic_structure' },
    },
    {
      path: 'analysis/style-guide.md',
      description: '视觉风格指南（基于目标会议/期刊的规范）',
      resolver: { type: 'field', field: 'analysis.style_guide' },
    },
    {
      path: 'analysis/visual-spec.md',
      description: '视觉规格书（具体的视觉元素、颜色、布局规格）',
      resolver: { type: 'field', field: 'analysis.visual_spec' },
    },

    // === Output ===
    {
      path: 'output/draw-prompt.md',
      description: 'Agent 生成的英文绘图 prompt',
      resolver: { type: 'field', field: 'output.draw_prompt' },
    },
    {
      path: 'output/image.png',
      description: '生成的科研图片（base64 编码）',
      resolver: { type: 'generated', field: 'output.image_base64' },
    },
    // === Icon Extraction Pipeline ===
    {
      path: 'output/image_icons_only.png',
      description: 'Icons-only 版本（白底，无背景/箭头/文字）',
      resolver: { type: 'generated', field: 'output.image_icons_only_base64' },
    },
    {
      path: 'output/icons_transparent.png',
      description: '透明背景的 icons PNG',
      resolver: { type: 'generated', field: 'output.icons_transparent_base64' },
    },
    {
      path: 'output/icons/manifest.json',
      description: 'Icon 区域检测结果（bbox 列表）',
      resolver: { type: 'field', field: 'output.icons_manifest' },
    },
    {
      path: 'output/diagram.xml',
      description: 'Draw.io mxGraph XML 图表（可编辑）',
      resolver: { type: 'field', field: 'output.diagram_xml' },
    },
    {
      path: 'output/diagram_preview.png',
      description: 'SVG 渲染预览图（用于视觉审核）',
      resolver: { type: 'generated', field: 'output.diagram_preview_base64' },
    },
    // Individual icon slots (1-20)
    ...Array.from({ length: 20 }, (_, i) => ({
      path: `output/icons/icon_${i + 1}.png`,
      description: `提取的第 ${i + 1} 个 icon`,
      resolver: { type: 'generated' as const, field: `output.icon_${i + 1}_base64` },
    })),

    // === Settings ===
    {
      path: 'settings/config.md',
      description: '项目配置（目标会议、图片尺寸等）',
      resolver: { type: 'field', field: 'settings.target_conference' },
    },
  ],
}
