#!/usr/bin/env node
/**
 * Validates the privacy plugin without installing it into Claude Code.
 * Checks: manifest fields, .mcp.json points at a real server, the server starts
 * over stdio exactly as configured, read-only mode exposes only read tools,
 * and each skill has name/description frontmatter matching its folder.
 * Exit: 0 valid · 1 invalid
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
// Claude Code substitutes ${CLAUDE_PLUGIN_ROOT} with the plugin folder at run time.
const expand = (s) => s.replaceAll('${CLAUDE_PLUGIN_ROOT}', ROOT);
const problems = [];
const fail = (m) => problems.push(m);

// 1. manifest
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  for (const k of ['name', 'version', 'description']) if (!manifest[k]) fail(`plugin.json missing "${k}"`);
  if (manifest.name && !/^[a-z0-9-]+$/.test(manifest.name)) fail('plugin name must be lowercase letters, digits, hyphens');
} catch (e) {
  fail(`plugin.json unreadable: ${e.message}`);
}

// 2. MCP config and server path
let server;
try {
  const mcp = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8'));
  server = mcp.mcpServers?.pdfstudio;
  if (!server) fail('.mcp.json has no mcpServers.pdfstudio entry');
  else {
    const entry = server.args?.find((a) => a.endsWith('.mjs') || a.endsWith('.js'));
    if (!entry) fail('pdfstudio server args have no .js/.mjs entry point');
    else if (!existsSync(resolve(expand(entry)))) fail(`server entry not found: ${entry}`);
    if (server.args?.some((a) => /^[A-Za-z]:[\\/]|^\/(?!\$\{)/.test(a))) fail('server args contain an absolute machine path; use ${CLAUDE_PLUGIN_ROOT}');
    if (!server.args?.includes('--read-only')) fail('server is not configured read-only');
  }
} catch (e) {
  fail(`.mcp.json unreadable: ${e.message}`);
}

// 3. skills
const skillsDir = join(ROOT, 'skills');
if (existsSync(skillsDir)) {
  for (const name of readdirSync(skillsDir)) {
    const file = join(skillsDir, name, 'SKILL.md');
    if (!existsSync(file) || !statSync(file).isFile()) {
      fail(`skill folder "${name}" has no SKILL.md`);
      continue;
    }
    // Normalize CRLF so the frontmatter check works on Windows-checked-out files too.
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const fm = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!fm) {
      fail(`${name}/SKILL.md has no frontmatter`);
      continue;
    }
    const fmName = /^name:\s*(.+)$/m.exec(fm[1])?.[1].trim();
    const fmDesc = /^description:\s*(.+)$/m.exec(fm[1])?.[1].trim();
    if (fmName !== name) fail(`${name}/SKILL.md name "${fmName}" must match its folder`);
    if (!fmDesc) fail(`${name}/SKILL.md has no description`);
  }
} else {
  fail('no skills/ folder');
}

// 4. start the server exactly as configured and list its tools
async function listTools() {
  if (!server?.args) return null;
  const p = spawn(server.command, server.args.map(expand), { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiters = new Map();
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && waiters.has(msg.id)) waiters.get(msg.id)(msg);
      } catch {
        /* ignore non-JSON lines */
      }
    }
  });
  let id = 0;
  const call = (method, params) =>
    new Promise((res, rej) => {
      const k = ++id;
      waiters.set(k, res);
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n');
      setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), 15000);
    });
  try {
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plugin-validate', version: '0' } });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    const res = await call('tools/list', {});
    return res.result.tools.map((t) => t.name);
  } finally {
    p.kill();
  }
}

try {
  const tools = await listTools();
  if (tools) {
    for (const t of ['pdf_info', 'pdf_extract_text', 'pdf_search_text']) {
      if (!tools.includes(t)) fail(`read tool missing from server: ${t}`);
    }
    const writes = tools.filter((t) => !['pdf_info', 'pdf_extract_text', 'pdf_search_text'].includes(t));
    if (writes.length) fail(`read-only server exposes write tools: ${writes.join(', ')}`);
  }
} catch (e) {
  fail(`server did not start over stdio: ${e.message}`);
}

if (problems.length) {
  console.log('INVALID');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`VALID: ${manifest.name} ${manifest.version}`);
process.exit(0);
