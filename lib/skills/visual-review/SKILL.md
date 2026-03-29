---
name: visual-review
description: >
  视觉一致性审核技能 — 对比 AI 生成的原图与逆向工程产出的可编辑图表（SVG 或 Draw.io XML），
  识别视觉差异并自动修正。由主 Agent 执行审核判断，通过 AnalyzeImage 工具进行图像对比。
---

# 视觉一致性审核 (Visual Review)

## 触发时机

在 scientific-drawing 工作流的 Step 7e（逆向生成 XML）完成后，**Step 7f（AssembleXML 嵌入 icon）之前**执行。

⚠️ **必须在 icon 嵌入之前审核** — AssembleXML 会将 base64 图片数据嵌入文件，导致文件从几 KB 膨胀到 500KB-1MB+。嵌入后的文件无法被 Read 到上下文中（会撑爆 token 限制并触发无限压缩循环）。

## 审核流程

### 1. 渲染预览图

将生成的图表渲染为 PNG，用于与原图对比：

```
RenderSvg(
  svg_path="output/diagram.xml",
  output_path="output/diagram_preview.png"
)
```

### 2. 视觉对比审核

调用 AnalyzeImage 对渲染结果进行审核。使用 custom instruction 模式，传入具体的审核指令：

**若为 SVG 格式：**
```
AnalyzeImage(
  image_path="output/diagram_preview.png",
  instruction="请仔细对比这张 SVG 渲染图与原始科研图表，列出所有视觉不一致之处。

重点检查项（按优先级排序）：

1. ⚠️ 箭头头部对齐（最高优先级）：
   - 箭头三角形是否紧贴在线条端点上？还是存在明显偏移/错位？
   - 检查 <marker> 的 refX/refY 是否正确
   - 箭头方向是否正确

2. 箭头和连线：样式、粗细、颜色、起止位置、曲线弧度是否一致

3. 文字：内容、位置、大小、颜色是否一致，是否有文字被裁切或溢出

4. 线条/边框：样式、颜色、粗细是否一致

5. 背景色块：颜色、形状、圆角是否一致

6. 整体布局比例是否匹配

7. 占位符位置是否与原图中图标区域对应

对于每个问题，说明：
- 问题描述（越具体越好）
- 涉及的 SVG 元素（给出具体的元素标签、id 或属性）
- 具体的修改建议（如：将 refX 从 0 改为 10）

如果一切正确，回复「审核通过」。"
)
```

**若为 Draw.io XML 格式：**
```
AnalyzeImage(
  image_path="output/diagram_preview.png",
  instruction="请仔细对比这张 Draw.io 图表渲染图与原始科研图表，列出所有视觉不一致之处。

重点检查项（按优先级排序）：

1. ⚠️ 箭头/连线（最高优先级）：
   - 连线是否正确连接了源节点和目标节点
   - 箭头方向是否正确
   - 线条样式（直线/曲线/虚线）是否与原图一致

2. 颜色：节点 fillColor、strokeColor、fontColor 是否与原图匹配

3. 文字：内容、位置、大小是否一致

4. 布局：节点位置、大小、间距是否与原图匹配

5. 容器/背景区域：颜色、层级是否正确

6. 占位符位置是否与原图中图标区域对应

对于每个问题，说明：
- 问题描述
- 涉及的 mxCell（给出 id 和当前 style/value）
- 具体的修改建议（如：将 id=5 的 fillColor 从 #FFFFFF 改为 #E8F0FE）

如果一切正确，回复「审核通过」。"
)
```

### 3. 修正问题

根据 AnalyzeImage 返回的问题列表：

1. Read 当前图表文件用于定位需要修改的代码
2. 针对每个问题，使用 Edit 工具精确修改对应的代码
3. 修改完成后，可选择重新执行步骤 1-2 验证修改效果

⚠️ **上下文安全注意事项**：
- Read XML/SVG 文件时，系统会自动剥离嵌入的 base64 图片数据（替换为占位符），防止撑爆上下文
- 如果文件尚未嵌入 icon（在 AssembleXML 之前），文件较小，可以安全读取
- 如果文件已嵌入 icon，Read 返回的是剥离后的结构代码，仍可用于 Edit 修改
- **永远不要尝试在一次对话中多次 Read 大型 XML/SVG 文件**

### 4. 迭代限制

- 最多迭代 **2 轮**（渲染→审核→修改）
- 如果第 2 轮仍有问题，记录残留问题并继续后续步骤
- 不要陷入无限审核循环

## 注意事项

- ⚠️ **不要直接 Read 图片文件** — 图片 base64 会撑爆上下文。始终使用 AnalyzeImage 工具（走独立 API 调用）
- 审核由主 Agent 发起，通过 AnalyzeImage 的 custom instruction 模式执行
- 审核结果返回后，由主 Agent 判断哪些问题需要修复、如何修复
- **推荐在 icon 嵌入前进行审核**，此时文件体积小，修改更安全
