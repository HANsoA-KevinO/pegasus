import { ToolResult } from '../types'
import { WorkspaceInstance } from '../workspace/types'

/** Detect image MIME from base64 magic bytes */
function detectImageMime(base64: string): string {
  const p = base64.slice(0, 16)
  if (p.startsWith('/9j/')) return 'image/jpeg'
  if (p.startsWith('iVBOR')) return 'image/png'
  if (p.startsWith('R0lG')) return 'image/gif'
  if (p.startsWith('UklG')) return 'image/webp'
  return 'image/png'
}

interface AnalyzeImageInput {
  image_path: string
  instruction?: string
  /** Built-in mode for reverse-engineering image → code */
  mode?: 'reverse_xml'
  /** For reverse modes: icon placeholder info from manifest */
  icons?: Array<{ id: number; x: number; y: number; width: number; height: number }>
  /** For reverse modes: original image dimensions */
  image_width?: number
  image_height?: number
}

const VISION_MODEL = 'google/gemini-3.1-pro-preview'

/**
 * Build the Draw.io mxGraph XML reverse-engineering prompt with icon placeholders.
 */
function buildReverseXmlPrompt(
  icons: Array<{ id: number; x: number; y: number; width: number; height: number }>,
  width: number,
  height: number,
): string {
  const iconList = icons
    .map(i => `  - icon_${i.id}: x="${i.x}" y="${i.y}" width="${i.width}" height="${i.height}"`)
    .join('\n')

  // Scale factor: image pixels → draw.io coordinate space (target ~1000x wide)
  const scale = Math.min(1000 / width, 1500 / height, 1)
  const dxW = Math.round(width * scale)
  const dxH = Math.round(height * scale)

  return `# Role
你是一位 Draw.io（mxGraph）Uncompressed XML 代码生成专家，同时具备精确的图像空间感知能力与颜色辨识能力。你生成的 XML 必须可被 draw.io 直接导入并正确渲染。

# Task
请你深入分析此科研图表图片，并输出一份 Uncompressed mxGraph XML，目标是：
在结构、空间布局与配色方案上，尽可能忠实复刻原图，而非仅表达逻辑关系。

原图尺寸：${width} x ${height} 像素
目标画布尺寸：约 ${dxW} x ${dxH}（缩放比例 ${scale.toFixed(2)}）

# Critical Rules（必须严格执行）

## 1. 颜色提取与应用
你必须从图片中识别不同视觉元素的颜色，并转换为 Hex 颜色值，准确映射到 mxCell 的 style 属性中：
- 容器/背景区域：使用准确的 fillColor，设置 container="1"
- 节点：禁止使用白色或默认样式，必须设置 fillColor、strokeColor、fontColor
- 边框：明确区分黑色、灰色或彩色边框，禁止统一使用默认黑色
- 兜底规则：若颜色无法精准判断，选择最接近的中性色，禁止省略 fillColor

## 2. 强制绝对坐标估算
- 所有节点必须使用绝对坐标
- 每个 vertex 必须包含：<mxGeometry x="…" y="…" width="…" height="…" as="geometry"/>
- 禁止将多个节点堆叠在 (0,0)
- 禁止节点之间发生明显重叠

## 3. 箭头与连线（极其重要）
- 使用 edge="1" 表示连线，必须指定 source 和 target
- 箭头样式通过 style 属性控制：endArrow=block/classic/open/none, startArrow=...
- 线条样式：strokeColor、strokeWidth、dashed=1（虚线）
- 曲线连线：使用 curved=1 或 edgeStyle=...
- ⚠️ 禁止用独立的三角形 vertex 模拟箭头 — 必须使用 edge 的 endArrow 属性

## 4. Icon 占位符（共 ${icons.length} 个）
图中的非文字图像元素（icon/图标/照片）用虚线矩形占位符表示：
- style 必须严格使用: rounded=0;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=#666666;
- value 格式: [icon_N]
- 占位符坐标（已按缩放比例 ${scale.toFixed(2)} 换算）：
${iconList.split('\n').map(line => {
    const match = line.match(/x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/)
    if (match) {
      return `  - ${line.split(':')[0].trim()}: x="${Math.round(parseFloat(match[1]) * scale)}" y="${Math.round(parseFloat(match[2]) * scale)}" width="${Math.round(parseFloat(match[3]) * scale)}" height="${Math.round(parseFloat(match[4]) * scale)}"`
    }
    return line
  }).join('\n')}
- ⚠️ 其他文字和元素必须避让占位符区域

## 5. 容器结构与层级
- 背景区域作为最底层容器（vertex="1" container="1"）
- 容器必须先于内部节点出现在 XML 中

## 6. XML 结构强制约束
输出必须且只能遵循以下结构：
<mxGraphModel dx="${dxW}" dy="${dxH}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <!-- 所有其他 mxCell 从 id=2 开始 -->
  </root>
</mxGraphModel>
- 所有可见节点 parent="1" 或 parent 为某个容器节点
- id 必须为递增整数（2, 3, 4, …），禁止重复

## 7. Vertex / Edge 规范
- 所有可见元素：vertex="1"
- 连线：edge="1"，不允许省略 source/target
- 禁止生成与图片无关的多余元素

# Output Format
- 仅输出 XML 代码
- 禁止任何解释性文字
- 禁止 Markdown 包裹（不要用 \`\`\`xml）
- 输出以 <mxGraphModel 开头，以 </mxGraphModel> 结尾`
}

/**
 * Analyze an image using multimodal vision via OpenRouter.
 * Supports built-in modes for reverse-engineering (image → SVG/XML code).
 */
export async function executeAnalyzeImage(
  input: AnalyzeImageInput,
  workspace: WorkspaceInstance
): Promise<ToolResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return { content: 'OPENROUTER_API_KEY is not set', is_error: true }
  }

  // Determine the instruction text
  let instruction: string
  if (input.mode === 'reverse_xml') {
    if (!input.icons || !input.image_width || !input.image_height) {
      return {
        content: 'reverse_xml mode requires icons, image_width, and image_height parameters',
        is_error: true,
      }
    }
    instruction = buildReverseXmlPrompt(input.icons, input.image_width, input.image_height)
  } else if (input.instruction) {
    instruction = input.instruction
  } else {
    return { content: 'Either instruction or mode must be provided', is_error: true }
  }

  // Read the image from workspace (stored as base64)
  const imageBase64 = await workspace.read(input.image_path)
  if (!imageBase64) {
    return { content: `Image not found: ${input.image_path}`, is_error: true }
  }

  console.log(`[analyze-image] Analyzing ${input.image_path} with ${VISION_MODEL} (mode=${input.mode ?? 'custom'})`)

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://pegasus.local',
        'X-Title': 'Pegasus',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${detectImageMime(imageBase64)};base64,${imageBase64}` },
              },
              {
                type: 'text',
                text: instruction,
              },
            ],
          },
        ],
        temperature: 1,
        max_tokens: 20000,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`OpenRouter API error ${res.status}: ${errText}`)
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content

    if (!text) {
      return { content: 'No analysis result returned', is_error: true }
    }

    console.log(`[analyze-image] Result: ${text.length} chars`)
    return { content: text }
  } catch (err) {
    const errMsg = (err as Error).message
    console.error('[analyze-image] Error:', errMsg)
    return {
      content: `Image analysis error: ${errMsg}`,
      is_error: true,
    }
  }
}
