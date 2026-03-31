# Pegasus

English | [中文](README.md)

**AI Scientific Diagram Agent** — Fully automated, self-reviewing, interactive scientific paper illustration generation and precise editing system.

Pegasus automatically completes the entire pipeline from content analysis, style extraction, diagram generation to editable Draw.io XML output based on text descriptions or paper content. It's not just a "drawing tool" — it's an autonomous Agent that understands academic context, follows top-venue visual conventions, proactively reviews generation quality, and continuously improves results through dialogue.

![Pegasus Main Interface](docs/screenshots/main.png)

---

## Key Features

- **Fully Automated Workflow** — 7-step pipeline from input analysis to final output, no manual intervention needed
- **Multi-Discipline Adaptation** — Built-in visual convention Skills for CS, Biology, Economics and more, automatically matching target venue/journal styles
- **Self-Review Mechanism** — Automatically compares generated diagrams against originals using vision models, self-corrects discrepancies
- **Interactive Editor** — Built-in Draw.io editor with drag-and-drop, wiring, and style editing (WYSIWYG)
- **Continuous Dialogue Refinement** — Agent proactively asks for confirmation; users can request adjustments to colors, layout, arrow styles, etc. at any time
- **Smart Icon Extraction** — Automatically extracts icon elements from generated images, removes backgrounds, and embeds them into Draw.io XML for editable diagrams
- **Export** — Draw.io XML export

---

## Interface Preview

| Workspace | Editor |
|-----------|--------|
| ![Workspace](docs/screenshots/workspace.png) | ![Editor](docs/screenshots/editor.png) |

![Agent Workflow & Gallery](docs/screenshots/agentflow.png)

---

## High-Fidelity Draw.io Diagram Reconstruction

Pegasus produces editable Draw.io XML with extremely high visual fidelity to the AI-generated original. Through a pipeline of reverse engineering + visual review + automatic correction, the Draw.io version accurately reproduces layout, colors, arrows, and text details while keeping every element independently editable.

| AI Generated Original | Draw.io Editable Version |
|----------------------|--------------------------|
| ![AI Generated](docs/screenshots/AI-geresults.png) | ![Draw.io Editable](docs/screenshots/XML-editable-results.png) |

---

## Workflow

Pegasus's core pipeline consists of 7 steps:

```
User Input → Step 1: Analyze Input (Domain Classification)
           → Step 2: Extract Visual Style (Match Target Venue)
           → Step 3: Extract Logical Structure
           → Step 4: Generate Visual Specification
           → Step 5: Write Drawing Prompt
           → Step 6: Generate Image (Gemini)
           → Step 7: Icon Extraction + Draw.io XML Reverse Engineering + Visual Review + Assembly
                     → Editable Draw.io XML Output
```

### Step 7 Detailed Flow (Draw.io XML Synthesis)

```
Original ──→ Generate icons-only version
         ──→ Remove white background
         ──→ Detect icon regions (bbox)
         ──→ Crop individual icons
         ──→ Reverse-engineer original into Draw.io XML template (AnalyzeImage + Gemini)
         ──→ Visual consistency review
         ──→ Assemble final XML (embed icon data URIs)
```

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **MongoDB** >= 6.0 (local or cloud)
- **OpenRouter API Key** (for LLM and image generation models)

### Installation

```bash
git clone https://github.com/HANsoA-KevinO/pegasus.git
cd pegasus
npm install
```

### Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
OPENROUTER_API_KEY=your-openrouter-api-key
MONGODB_URI=mongodb://localhost:27017/pegasus
```

### Start Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

---

## Feature Details

### Virtual Workspace

Each conversation has an independent virtual workspace with all artifacts persisted in MongoDB. The Agent operates files through `Read`/`Write`/`Edit` tools, writing results to corresponding files at each workflow step. Users can view and edit artifacts in the right panel at any time.

```
workspace/
├── input/user-content.md          # User's original input
├── analysis/
│   ├── domain-classification.md   # Domain classification
│   ├── logic-structure.md         # Logical structure
│   ├── style-guide.md             # Visual style guide
│   └── visual-spec.md             # Visual specification
├── output/
│   ├── draw-prompt.md             # English drawing prompt
│   ├── image.png                  # Generated image
│   ├── diagram.xml                # Draw.io editable diagram
│   └── icons/                     # Extracted icon assets
└── settings/config.md             # Target venue, image dimensions, etc.
```

The workspace panel supports multi-tab switching (images, gallery, Draw.io editor, Markdown, code), automatically switching to the relevant tab when the Agent generates new content.

### Quick Quote Editing

Users can **select any text content** in the workspace panel (analysis documents, XML code, config files, etc.), and the selection is automatically attached to the next chat message as context. The Agent accurately understands what the user is pointing at and makes targeted modifications.

Example: Select an mxCell in XML code → type "make this arrow dashed" → Agent precisely locates and modifies the element.

### Cross-Conversation Persistent Memory

Pegasus features a global memory system that automatically extracts valuable information from conversations and persists it across sessions:

| Memory Type | Description |
|-------------|-------------|
| **User Preferences** | Role, expertise, work habits, visual style preferences |
| **Behavioral Feedback** | User corrections or confirmations of Agent behavior, guiding future performance |
| **Project Context** | Project-level decisions, conventions, deadlines, etc. |
| **External References** | Locations and purposes of external system resources |

Memory is automatically extracted (async after each conversation) and recalled (relevance-matched on each new message), requiring no manual management.

### Proactive Interaction & Decision Confirmation

The Agent doesn't just execute blindly — it proactively pauses at key decision points to ask users:

- Confirms understanding of requirements before starting, offering 2-3 possible directions
- Proactively asks rather than assumes when encountering ambiguity
- Solicits feedback after generating results

Users can click preset options for quick replies or type custom answers. The Agent automatically resumes execution after receiving a response.

### Unlimited Context

Complex drawing tasks may involve extensive tool calls that easily exceed the LLM context window. Pegasus includes a built-in context compression engine:

- Automatically triggers compression when conversation tokens exceed **140K**
- Generates structured summaries (user requirements, workspace state, analysis progress, user preferences)
- Snapshots current workspace file contents to prevent information loss after compression
- Achieves ~64% token reduction, allowing the Agent to continue working seamlessly
- Frontend displays real-time context usage progress bar with yellow/orange warnings

### Multi-Turn Image Editing

Image generation supports multi-turn conversational editing without re-describing from scratch:

```
Round 1: "Generate a Transformer architecture diagram"     → image.png
Round 2: "Remove all backgrounds, keep only icons"         → image_icons_only.png (builds on previous)
Round 3: "Change the color scheme to blue"                 → image_v2.png (maintains full context)
```

Under the hood, image generation sessions (including message history and previous images) are maintained so the vision model understands the complete modification chain.

### Self-Review & Iterative Correction

After generating diagrams, the Agent automatically performs visual consistency review:

1. Renders diagram preview
2. Calls vision model to compare rendered vs. original generated image
3. Checks arrows, text, lines, color blocks, and placeholder positions item by item
4. Automatically fixes XML code using the `Edit` tool when issues are found
5. Up to 2 iteration rounds until review passes

### Draw.io Interactive Editor

Built-in Draw.io editor for WYSIWYG fine-tuning of Agent-generated diagrams:

- **Drag & Drop** — Select nodes, drag to move, resize
- **Connection Editing** — Arrow and connector style/path adjustment
- **Style Panel** — Color, font, border, fill property editing
- **Export** — XML code download

### Pluggable Skill System

Pegasus adapts to different disciplines through its Skill system. The Agent automatically identifies the academic domain from user input and loads matching Skills for discipline-specific drawing conventions and style guides. Skills are freely extensible — add a new `lib/skills/<domain>/SKILL.md` to support additional disciplines.

---

## Project Structure

```
pegasus/
├── app/                    # Next.js App Router
│   ├── api/                # API Routes (chat, conversations, models)
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Main page
├── components/             # React Components
│   ├── chat/               # Chat interface (input, messages, new task form)
│   ├── sidebar/            # Sidebar (conversation history, model selection)
│   └── workspace/          # Workspace panel
│       ├── DrawioEditor.tsx # Draw.io editor
│       ├── ImageGallery.tsx # Multi-image gallery
│       └── WorkspacePanel.tsx
├── hooks/                  # React Hooks
├── lib/
│   ├── agent/              # Agent core (loop, Provider, context compression)
│   ├── db/                 # MongoDB models & data access
│   ├── skills/             # Domain Skill definitions
│   ├── tools/              # Tool implementations & schemas
│   └── workspace/          # Workspace instance & file management
└── public/                 # Static assets
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16, React 19 |
| Styling | Tailwind CSS |
| Database | MongoDB (Mongoose 9) |
| LLM | Claude Opus 4.6 via OpenRouter (recommended) |
| Image Generation | Gemini 3 Pro image preview via OpenRouter |
| Diagram Editor | Draw.io (embed.diagrams.net) |
| Image Processing | Sharp |

---

## License

MIT
