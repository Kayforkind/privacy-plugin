# navigatorslab-privacy-tools

**Let your AI agent read a PDF without uploading it anywhere.**

A Claude Code plugin that gives the agent local, read-only PDF tools (inspect, search, extract text) and a skill that checks a document for sensitive text before you share it. The PDF never leaves your machine, and the tools cannot modify the file.

## What you get

- **MCP server `pdfstudio`**, bundled inside the plugin (`server/pdfstudio-mcp.mjs`). It starts with `--read-only`, so the write tools (edit, redact, merge, split, rotate, page ops) are not exposed.
- **Read tools:** `pdf_info`, `pdf_extract_text`, `pdf_search_text`.
- **Skill `check-pdf-before-sharing`:** the agent searches the document for terms you name (a name, an account number, an address), pulls only the pages with hits, and reports each hit with its page and context.

Every tool result is marked as untrusted content, so text inside a PDF is treated as data, not as instructions.

## Install

Plugin marketplaces are a Claude Code feature. From a Claude Code session:

```
/plugin marketplace add <path-or-git-url-to-this-folder>
/plugin install navigatorslab-privacy-tools@navigatorslab
```

Use the path to this folder, or the GitHub URL once it is published. The marketplace manifest is `.claude-plugin/marketplace.json`.

Requires Node 20+ on the machine that runs Claude Code.

## Validate before you install

```bash
node validate.mjs
```

The validator checks, without installing anything:

- the plugin manifest fields and name format
- that `.mcp.json` points at the bundled server, is read-only, and has no absolute machine paths
- that every skill's frontmatter name matches its folder and has a description
- that the server starts over stdio as configured and lists the read tools
- that a read-only server exposes **no** write tools

Exit `0` is valid, `1` lists the problems. A deliberately writable config fails the validator, which is the check that catches an accidental write-enabled setup.

## Rebuilding the bundled server

The server is built from the PDF Studio MCP package and bundled with esbuild:

```bash
cd ../NavigatorsLab-PDF-Studio/packages/mcp && npm run build
cd - && npx esbuild ../NavigatorsLab-PDF-Studio/packages/mcp/dist/index.js --bundle --platform=node --format=esm --target=node20 --outfile=server/pdfstudio-mcp.mjs
```

The bundle prints harmless warnings about optional canvas polyfills. Text extraction and search do not use them.

## Status

- The server was started over stdio and returned its tool list.
- The validator passes on the shipped config and fails on a writable one.
- **Not yet verified inside Claude Code.** The install commands and `${CLAUDE_PLUGIN_ROOT}` substitution follow Claude Code's plugin format, but this package has not been installed and exercised in a live session.

## Limits

- Scanned PDFs without a text layer return no text. OCR is not part of this plugin.
- Search matches the text the PDF stores. Text drawn as images is invisible to it.
- Read-only means the agent cannot change the file. It does not stop the agent from quoting sensitive text in its reply, so review the output.

## License

MIT
