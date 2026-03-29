import { ToolSchema } from '../types'

export const toolSchemas: ToolSchema[] = [
  {
    name: 'Read',
    description: `Reads a file from the workspace or skill references. Returns file content with line numbers (cat -n format).

Usage:
- Workspace files: "analysis/domain-classification.md", "output/diagram.xml", "GUIDE.md", etc.
- Skill references: "/skills/<skill-name>/references/<file>.md" — access detailed skill documentation
- By default, reads the entire file. Use offset/limit for large files (e.g., generated XML that can be thousands of lines)
- Results are returned with line numbers starting at 1, in the format: "  1→content"
- Always Read a file before using Edit on it — Edit will fail if you haven't read the file first
- This tool can read images (PNG, JPG) from the workspace. When reading an image file the contents are presented visually.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- If you read a file that exists but has empty contents you will receive a warning in place of file contents.`,
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description:
            'Path to read. Workspace files: "input/user-content.md", "analysis/domain-classification.md", etc. Skill references: "/skills/<skill-name>/references/<file>.md"',
        },
        offset: {
          type: 'number',
          description:
            'Line number to start reading from (1-based). Only provide if the file is too large to read at once.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of lines to read. Only provide if the file is too large to read at once.',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Write',
    description: `Writes content to a workspace file. Overwrites existing content entirely.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- Files are automatically persisted to the database via the workspace system.`,
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Workspace file path to write to.',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file.',
        },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'Edit',
    description: `Performs exact string replacements in workspace files.

Usage:
- You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- The edit will FAIL if old_string is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all to change every instance of old_string.
- Use replace_all for replacing and renaming strings across the file.`,
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Workspace file path to edit.',
        },
        old_string: {
          type: 'string',
          description:
            'The exact string to find and replace. Must match existing file content exactly.',
        },
        new_string: {
          type: 'string',
          description: 'The replacement string (must be different from old_string).',
        },
        replace_all: {
          type: 'boolean',
          description:
            'Replace all occurrences of old_string (default false). Useful for renaming variables or strings across the file.',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'Glob',
    description: `Search for files in the workspace by glob pattern. Returns matching file paths sorted by modification time.

Usage:
- Supports glob patterns like "analysis/*.md", "output/*", "**/*.md"
- Use this tool when you need to find files by name patterns
- Returns workspace-relative file paths`,
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'The glob pattern to match files against (e.g., "analysis/*.md", "output/*", "**/*.md").',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Grep',
    description: `Search file contents in the workspace using text or regex pattern. Returns matching lines with context.

Usage:
- Supports full regex syntax (e.g., "Transformer", "\\\\bclass\\\\b")
- Optionally limit search to a specific file path
- Use this to find specific content across workspace files`,
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'The text or regex pattern to search for in file contents.',
        },
        path: {
          type: 'string',
          description:
            'Optional: limit search to a specific workspace file path.',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Skill',
    description: `Execute a skill within the current conversation.

When the user's request matches an available skill, check the skill list and invoke accordingly. Skills provide specialized capabilities and domain knowledge.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - skill: "scientific-drawing" — invoke the scientific drawing skill
  - skill: "computer-science", args: "focus on neural architecture" — invoke with arguments
  - skill: "biology" — invoke the biology domain skill

Important:
- Available skills are listed in <system-reminder> messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- If you see a <skill-name> tag in the current conversation turn, the skill has ALREADY been loaded — follow the instructions directly instead of calling this tool again
- Load the core workflow skill first, then load domain-specific skill based on classification`,
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Skill name to load (e.g., "scientific-drawing", "computer-science", "biology", "economics").',
        },
        args: {
          type: 'string',
          description:
            'Optional arguments for the skill. Provide additional context or instructions to guide the skill execution.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'GenerateImage',
    description: `Generate or edit scientific diagram images. Supports multi-turn editing: first call generates a new image, subsequent calls with edit_previous=true continue the conversation with the image generation model, preserving full context.

Usage:
- First call: Detailed English prompt describing the scientific diagram to create
- Edit call (edit_previous=true): Describe the edit to make — the model remembers what it generated, no need to re-describe the image
- Use output_filename to save different versions (e.g., "image_icons_only.png")

Multi-turn editing examples:
1. GenerateImage(prompt="Draw a Transformer architecture diagram...") → output/image.png
2. GenerateImage(prompt="Remove all backgrounds, frames, arrows, and text. Keep only the icons on white background, well separated.", edit_previous=true, output_filename="image_icons_only.png") → output/image_icons_only.png

Important:
- edit_previous=true requires a previous GenerateImage call in the same conversation
- Uses a dedicated image generation model internally, regardless of the orchestrator model
- After initial generation, use AnalyzeImage to reverse-engineer into SVG/XML`,
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Image generation or editing prompt in detailed English.',
        },
        edit_previous: {
          type: 'boolean',
          description:
            'If true, continue editing the image from the previous GenerateImage call. The model preserves full conversation context — just describe the edit, no need to re-describe or re-upload the image.',
        },
        output_filename: {
          type: 'string',
          description:
            'Output filename within output/ directory (default: "image.png"). Use different names for different versions, e.g. "image_icons_only.png".',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'AnalyzeImage',
    description: `Analyze a workspace image using multimodal vision. Supports custom instructions or built-in modes.

Usage modes:
1. **Custom instruction**: Pass image_path + instruction for any analysis task (e.g., visual review, comparison)
2. **reverse_xml mode**: Pass image_path + mode="reverse_xml" + icons + image_width + image_height
   - Generates Draw.io mxGraph XML from image with icon placeholders
   - Uses structured edge objects for accurate arrow/connection handling

Important:
- Uses a dedicated multimodal model internally, regardless of the orchestrator model
- For reverse mode, the tool handles the entire prompt including dimension constraints, arrow styles, text matching, and placeholder formatting
- Save reverse_xml results to output/diagram.xml
- For visual review/comparison tasks, use custom instruction mode with your own prompt`,
    input_schema: {
      type: 'object',
      properties: {
        image_path: {
          type: 'string',
          description:
            'Workspace path to the image file (e.g., "output/image.png").',
        },
        instruction: {
          type: 'string',
          description:
            'Custom task instruction for image analysis. Not needed if using mode parameter.',
        },
        mode: {
          type: 'string',
          enum: ['reverse_xml'],
          description:
            'Built-in reverse-engineering mode. "reverse_xml": generate Draw.io mxGraph XML from image with icon placeholders.',
        },
        icons: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          description:
            'For reverse_xml mode: icon placeholder positions from manifest.json regions.',
        },
        image_width: {
          type: 'number',
          description: 'For reverse_xml mode: original image width in pixels.',
        },
        image_height: {
          type: 'number',
          description: 'For reverse_xml mode: original image height in pixels.',
        },
      },
      required: ['image_path'],
    },
  },
  {
    name: 'WebSearch',
    description: `Search the web for information. Returns search results with titles, URLs, and snippets.

Usage:
- Useful for finding conference/journal style guidelines and visual conventions
- Search for reference diagrams, color schemes, and layout patterns used in target publications
- Use specific queries: "NeurIPS 2024 paper architecture diagram style" rather than generic terms

Important:
- Use this early in the workflow when you need style references for the target conference/journal
- Results inform the style-guide analysis step`,
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The search query. Use specific terms for best results (e.g., "NeurIPS 2024 paper architecture diagram style").',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'AskUserQuestion',
    description: `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Use this proactively BEFORE executing a plan — confirm direction with the user first
- Always provide 2-3 specific options reflecting your best guesses about what the user might want
- The user can also type a custom response beyond your suggested options
- Do not use this for rhetorical questions or status updates — just state those directly
- The agent loop will pause until the user responds, then resume with their answer`,
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user. Be clear and specific about what you need to know.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of 2-3 suggested answer options. The user can pick one or type a custom response. Always provide options when possible.',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'ImageProcessor',
    description: `Perform pixel-level image processing operations on workspace images. Used for icon extraction pipeline.

Operations:
- remove_white_background: Convert white/near-white pixels to transparent. Use after generating an icons-only image.
- detect_regions: Connected component analysis on a transparent PNG — finds bounding boxes of each separate icon. Writes manifest to output/icons/manifest.json.
- crop: Crop a specific region from an image by bounding box coordinates.

Typical workflow:
1. GenerateImage → icons-only version on white background
2. ImageProcessor(remove_white_background) → transparent PNG
3. ImageProcessor(detect_regions) → manifest with bboxes
4. ImageProcessor(crop) for each region → individual icon PNGs`,
    input_schema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['remove_white_background', 'crop', 'detect_regions'],
          description: 'The image processing operation to perform.',
        },
        image_path: {
          type: 'string',
          description: 'Workspace path to input image (e.g., "output/icons_transparent.png").',
        },
        output_path: {
          type: 'string',
          description: 'Workspace path for output image. Required for remove_white_background and crop operations.',
        },
        bbox: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          description: 'Bounding box for crop operation: { x, y, width, height } in pixels.',
        },
        threshold: {
          type: 'number',
          description: 'White threshold for remove_white_background (0-255, default 240). Pixels with R,G,B all above this value become transparent.',
        },
      },
      required: ['operation', 'image_path'],
    },
  },
  {
    name: 'AssembleXML',
    description: `Assemble Draw.io mxGraph XML by replacing icon placeholders with actual icon images embedded as base64 data URIs.

⚠️ You MUST use this tool for XML icon embedding — do NOT manually edit XML to insert image URLs. Draw.io runs in an iframe from embed.diagrams.net, so relative/absolute URLs to our server will NOT resolve. Only data URIs work.

Finds mxCell elements with value="[icon_N]" (the dashed placeholder rectangles from AnalyzeImage reverse_xml mode) and replaces them with shape=image cells containing base64 data URIs.

Also handles cells where URLs were previously inserted (converts URL references to data URIs).

Usage:
- xml_path: path to the XML file with placeholders (e.g., "output/diagram.xml")
- manifest_path: path to the icon manifest (e.g., "output/icons/manifest.json")
- conversation_id: current conversation ID

After assembly, the XML will contain self-contained data URI images that draw.io can render directly.`,
    input_schema: {
      type: 'object',
      properties: {
        xml_path: {
          type: 'string',
          description: 'Workspace path to the Draw.io XML file (e.g., "output/diagram.xml").',
        },
        manifest_path: {
          type: 'string',
          description: 'Workspace path to the icon manifest JSON (e.g., "output/icons/manifest.json").',
        },
        conversation_id: {
          type: 'string',
          description: 'Current conversation ID. Used to construct icon image URLs.',
        },
        output_path: {
          type: 'string',
          description: 'Output path for the assembled XML. Defaults to overwriting xml_path.',
        },
      },
      required: ['xml_path', 'manifest_path', 'conversation_id'],
    },
  },
  {
    name: 'RenderSvg',
    description: `Render an SVG file to PNG image. Uses sharp (librsvg) for high-quality server-side rendering.

Usage:
- svg_path: workspace path to the SVG file (e.g., "output/diagram.svg")
- output_path: workspace path for the output PNG (default: same name with .png extension)
- scale: render scale factor (default: 1, use 2 for higher resolution)

Use cases:
- Visual quality review: render SVG to PNG, then Read both original image and rendered PNG to compare
- Export: generate PNG version for user download
- Validation: verify SVG renders correctly after modifications`,
    input_schema: {
      type: 'object',
      properties: {
        svg_path: {
          type: 'string',
          description: 'Workspace path to the SVG file (e.g., "output/diagram.svg").',
        },
        output_path: {
          type: 'string',
          description: 'Output PNG path in workspace (default: same name with .png extension).',
        },
        scale: {
          type: 'number',
          description: 'Render scale factor (default: 1). Use 2 for higher resolution output.',
        },
      },
      required: ['svg_path'],
    },
  },
]
