import { ToolResult } from '../types'
import { WorkspaceInstance } from '../workspace/types'

interface AssembleXMLInput {
  xml_path: string
  manifest_path: string
  conversation_id: string
  output_path?: string
}

/**
 * Replace icon placeholders in Draw.io mxGraph XML with actual icon images.
 *
 * Finds mxCell elements with value containing "icon_N" (various formats) and
 * replaces them with image cells using `shape=image;image=data:...` style
 * with embedded base64 data URIs.
 *
 * ⚠️ mxGraph style parser splits on `;` — so `data:image/png;base64,...`
 * would be truncated at the `;base64,` part. Draw.io's solution: encode the
 * semicolons in data URIs as `%3B`. Draw.io decodes them back when loading.
 * Format: `image=data:image/png%3Bbase64,{base64data}`
 */
export async function executeAssembleXML(
  input: AssembleXMLInput,
  workspace: WorkspaceInstance
): Promise<ToolResult> {
  const { xml_path, manifest_path, output_path } = input
  const finalPath = output_path || xml_path

  console.log(`[assemble-xml] XML: ${xml_path} | manifest: ${manifest_path}`)

  try {
    const xmlContent = await workspace.read(xml_path)
    if (!xmlContent) {
      return { content: `XML file not found: ${xml_path}`, is_error: true }
    }

    const manifestContent = await workspace.read(manifest_path)
    if (!manifestContent) {
      return { content: `Manifest not found: ${manifest_path}`, is_error: true }
    }

    const manifest = JSON.parse(manifestContent)
    const regions: Array<{
      id: number
      x: number
      y: number
      width: number
      height: number
      icon_path: string
    }> = manifest.regions

    if (!regions || regions.length === 0) {
      return { content: 'Manifest contains no regions', is_error: true }
    }

    let xml = xmlContent
    let replacedCount = 0
    const results: string[] = []

    for (const region of regions) {
      // Read icon base64 from workspace — required for data URI embedding
      const iconBase64 = await workspace.read(region.icon_path)
      if (!iconBase64) {
        results.push(`icon_${region.id}: SKIP (file not found: ${region.icon_path})`)
        continue
      }

      // Encode `;` as `%3B` in the data URI to avoid mxGraph style parser splitting
      // Draw.io decodes `%3B` → `;` when loading the image, so the browser gets a valid data URI
      const encodedDataUri = `data:image/png%3Bbase64,${iconBase64}`
      const imageStyle = `shape=image;aspect=fixed;imageAlign=center;imageValign=middle;image=${encodedDataUri}`

      // Strategy 1: Match by value containing icon_N in various formats
      // Handles: [icon_N], icon_N, [icon N], etc.
      const valuePatterns = [
        new RegExp(`(<mxCell[^>]*?)\\bvalue=["']\\[icon_${region.id}\\]["']([^>]*?)\\bstyle=["']([^"']*?)["']`, 'i'),
        new RegExp(`(<mxCell[^>]*?)\\bstyle=["']([^"']*?)["']([^>]*?)\\bvalue=["']\\[icon_${region.id}\\]["']`, 'i'),
        // Also match value="[icon_N]" with style containing shape=image (already partially replaced by agent)
        new RegExp(`(<mxCell[^>]*?)\\bvalue=["']\\[?icon_${region.id}\\]?["']([^>]*?)\\bstyle=["']([^"']*?)["']`, 'i'),
        new RegExp(`(<mxCell[^>]*?)\\bstyle=["']([^"']*?)["']([^>]*?)\\bvalue=["']\\[?icon_${region.id}\\]?["']`, 'i'),
      ]

      let matched = false
      for (const pattern of valuePatterns) {
        const match = xml.match(pattern)
        if (match) {
          const oldFragment = match[0]
          // Replace style and clear value
          const newFragment = oldFragment
            .replace(/\bstyle=["'][^"']*?["']/, `style="${imageStyle}"`)
            .replace(/\bvalue=["'][^"']*?["']/, 'value=""')
          xml = xml.replace(oldFragment, newFragment)
          results.push(`icon_${region.id}: replaced (value match)`)
          replacedCount++
          matched = true
          break
        }
      }

      if (matched) continue

      // Strategy 2: Match by URL-based image that references this icon (agent may have used Edit to insert URLs)
      const urlPatterns = [
        new RegExp(`(<mxCell[^>]*?style=["'][^"']*?shape=image;image=[^"']*?icon_${region.id}[^"']*?["'][^>]*?)`, 'i'),
        new RegExp(`(<mxCell[^>]*?style=["'][^"']*?icon_${region.id}\\.png[^"']*?["'][^>]*?)`, 'i'),
      ]

      for (const pattern of urlPatterns) {
        const match = xml.match(pattern)
        if (match) {
          const oldFragment = match[0]
          const newFragment = oldFragment.replace(
            /\bstyle=["'][^"']*?["']/,
            `style="${imageStyle}"`
          )
          xml = xml.replace(oldFragment, newFragment)
          results.push(`icon_${region.id}: replaced (URL→data URI)`)
          replacedCount++
          matched = true
          break
        }
      }

      if (matched) continue

      // Strategy 3: Match by approximate geometry (dashed placeholder cells)
      const geoPattern = /<mxCell[^>]*?style=["'][^"']*?dashed=1[^"']*?fillColor=none[^"']*?["'][^>]*?>[\s\S]*?<mxGeometry\s+x=["']?([\d.]+)["']?\s+y=["']?([\d.]+)["']?\s+width=["']?([\d.]+)["']?\s+height=["']?([\d.]+)["']?/gi

      let geoMatch: RegExpExecArray | null
      let bestGeoMatch: { fullMatch: string; dist: number } | null = null
      const tolerance = 20

      geoPattern.lastIndex = 0
      while ((geoMatch = geoPattern.exec(xml)) !== null) {
        const gx = parseFloat(geoMatch[1])
        const gy = parseFloat(geoMatch[2])
        const dx = Math.abs(gx - region.x)
        const dy = Math.abs(gy - region.y)
        if (dx <= tolerance && dy <= tolerance) {
          const dist = dx + dy
          if (!bestGeoMatch || dist < bestGeoMatch.dist) {
            bestGeoMatch = { fullMatch: geoMatch[0], dist }
          }
        }
      }

      if (bestGeoMatch) {
        const replaced = bestGeoMatch.fullMatch
          .replace(/style=["'][^"']*?["']/, `style="${imageStyle}"`)
          .replace(/value=["'][^"']*?["']/, 'value=""')
        xml = xml.replace(bestGeoMatch.fullMatch, replaced)
        results.push(`icon_${region.id}: replaced (geo match, dist=${bestGeoMatch.dist.toFixed(0)})`)
        replacedCount++
        continue
      }

      results.push(`icon_${region.id}: SKIP (no matching placeholder found)`)
    }

    await workspace.write(finalPath, xml)

    const summary = `Assembly complete: ${replacedCount}/${regions.length} icons replaced with data URIs`
    console.log(`[assemble-xml] ${summary}`)
    for (const r of results) {
      console.log(`  ${r}`)
    }

    return {
      content: `${summary}\n\nDetails:\n${results.join('\n')}\n\nSaved to ${finalPath}`,
    }
  } catch (err) {
    const errMsg = (err as Error).message
    console.error('[assemble-xml] Error:', errMsg)
    return { content: `AssembleXML error: ${errMsg}`, is_error: true }
  }
}
