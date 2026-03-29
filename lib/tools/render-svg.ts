import puppeteer from 'puppeteer'
import { ToolResult } from '../types'
import { WorkspaceInstance } from '../workspace/types'

interface RenderSvgInput {
  svg_path: string
  output_path?: string
  scale?: number
}

/**
 * Render an SVG or Draw.io XML file to PNG using Puppeteer (headless Chrome).
 * - SVG: renders directly in the page
 * - mxGraph XML: uses draw.io's viewer JS to render
 */
export async function executeRenderSvg(
  input: RenderSvgInput,
  workspace: WorkspaceInstance
): Promise<ToolResult> {
  const { svg_path, scale = 1 } = input
  const defaultExt = svg_path.endsWith('.xml') ? '.png' : '.png'
  const output_path = input.output_path || svg_path.replace(/\.(svg|xml)$/i, defaultExt)

  console.log(`[render-svg] Rendering ${svg_path} → ${output_path} (scale=${scale})`)

  try {
    const content = await workspace.read(svg_path)
    if (!content) {
      return { content: `File not found: ${svg_path}`, is_error: true }
    }

    const trimmed = content.trim()
    const isMxGraph = trimmed.startsWith('<mxGraphModel') || trimmed.includes('<mxGraphModel')
    const isSvg = trimmed.startsWith('<svg') || trimmed.startsWith('<?xml')

    if (!isMxGraph && !isSvg) {
      return { content: `File does not appear to be SVG or mxGraph XML: ${svg_path}`, is_error: true }
    }

    if (isMxGraph) {
      return await renderMxGraphXml(content, output_path, scale, workspace)
    } else {
      return await renderSvg(content, output_path, scale, workspace)
    }
  } catch (err) {
    const errMsg = (err as Error).message
    console.error('[render-svg] Error:', errMsg)
    return {
      content: `RenderSvg error: ${errMsg}`,
      is_error: true,
    }
  }
}

/** Render SVG content to PNG */
async function renderSvg(
  svgText: string,
  output_path: string,
  scale: number,
  workspace: WorkspaceInstance
): Promise<ToolResult> {
  const wMatch = svgText.match(/width="(\d+(?:\.\d+)?)"/)
  const hMatch = svgText.match(/height="(\d+(?:\.\d+)?)"/)
  const svgWidth = wMatch ? Math.ceil(parseFloat(wMatch[1])) : 1024
  const svgHeight = hMatch ? Math.ceil(parseFloat(hMatch[1])) : 768

  const viewportWidth = Math.ceil(svgWidth * scale)
  const viewportHeight = Math.ceil(svgHeight * scale)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor: scale })

    const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; }
  body { width: ${svgWidth}px; height: ${svgHeight}px; overflow: hidden; }
  body > svg { display: block; }
</style></head>
<body>${svgText}</body></html>`

    await page.setContent(html, { waitUntil: 'networkidle0' })

    const pngBuffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: svgWidth, height: svgHeight },
      omitBackground: false,
    })

    const pngBuf = Buffer.from(pngBuffer)
    const pngBase64 = pngBuf.toString('base64')
    const sizeKB = (pngBuf.length / 1024).toFixed(0)

    await workspace.write(output_path, pngBase64)

    console.log(`[render-svg] Saved ${output_path} (${svgWidth}x${svgHeight}, ${sizeKB}KB)`)

    return {
      content: `SVG rendered to PNG: ${output_path} (${svgWidth}×${svgHeight}, ${sizeKB}KB)`,
      images: [{ base64: pngBase64, mimeType: 'image/png' as const }],
    }
  } finally {
    await browser.close()
  }
}

/** Render mxGraph XML to PNG using draw.io's viewer JS */
async function renderMxGraphXml(
  xmlContent: string,
  output_path: string,
  scale: number,
  workspace: WorkspaceInstance
): Promise<ToolResult> {
  // Extract approximate canvas size from mxGraphModel dx/dy attributes
  const dxMatch = xmlContent.match(/dx="(\d+)"/)
  const dyMatch = xmlContent.match(/dy="(\d+)"/)
  const canvasW = dxMatch ? parseInt(dxMatch[1]) + 200 : 1200
  const canvasH = dyMatch ? parseInt(dyMatch[1]) + 200 : 1000

  const viewportWidth = Math.ceil(canvasW * scale)
  const viewportHeight = Math.ceil(canvasH * scale)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor: scale })

    // Escape XML for embedding in JS string
    const escapedXml = xmlContent
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '')

    // Use draw.io's viewer library to render mxGraph XML
    // The viewer.min.js is loaded from the CDN and renders the XML into a div
    const html = `<!DOCTYPE html>
<html><head>
<style>
  * { margin: 0; padding: 0; }
  body { background: white; overflow: hidden; }
  .mxgraph { max-width: 100%; }
</style>
<script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
</head>
<body>
<div class="mxgraph" style="max-width:100%;border:none;" data-mxgraph='{"highlight":"#0000ff","nav":true,"resize":true,"xml":"${escapedXml.replace(/"/g, '\\"')}"}'></div>
</body></html>`

    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 30000 })

    // Wait for the viewer to render
    await page.waitForSelector('.geDiagramContainer, svg', { timeout: 15000 }).catch(() => {
      console.log('[render-svg] Warning: diagram container not found, taking screenshot anyway')
    })

    // Small delay for rendering to complete
    await new Promise(r => setTimeout(r, 1000))

    // Get the actual rendered content bounds
    const bounds = await page.evaluate(() => {
      const svg = document.querySelector('svg')
      if (svg) {
        const rect = svg.getBoundingClientRect()
        return { x: 0, y: 0, width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
      }
      return { x: 0, y: 0, width: document.body.scrollWidth, height: document.body.scrollHeight }
    })

    const clipW = Math.min(bounds.width || canvasW, viewportWidth)
    const clipH = Math.min(bounds.height || canvasH, viewportHeight)

    const pngBuffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: clipW, height: clipH },
      omitBackground: false,
    })

    const pngBuf = Buffer.from(pngBuffer)
    const pngBase64 = pngBuf.toString('base64')
    const sizeKB = (pngBuf.length / 1024).toFixed(0)

    await workspace.write(output_path, pngBase64)

    console.log(`[render-svg] Saved ${output_path} (mxGraph XML, ${clipW}x${clipH}, ${sizeKB}KB)`)

    return {
      content: `mxGraph XML rendered to PNG: ${output_path} (${clipW}×${clipH}, ${sizeKB}KB)`,
      images: [{ base64: pngBase64, mimeType: 'image/png' as const }],
    }
  } finally {
    await browser.close()
  }
}
