/** Regenerate the authored technical diagrams. No external layout service is used. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(repository, 'assets/diagrams');
const previewDirectory = path.join(repository, 'output/docs-diagrams-v2');
const names = ['system-context', 'components', 'request-sequence', 'conversation', 'installation', 'isolation'];
const variants = names.flatMap(name => ['en', 'zh-CN'].map(locale => ({
  locale, stem: name + (locale === 'en' ? '' : '.zh-CN'),
})));
const color = {
  white: '#FFFFFF', navy: '#18324F', text: '#334155', muted: '#64748B',
  border: '#CBD5E1', fill: '#F4F6F8', remote: '#EDF2F7', error: '#9C4B4B',
};
const font = { family: 'Arial, "Microsoft YaHei", "Noto Sans CJK SC", sans-serif', title: 25, group: 16, node: 18, body: 15, edge: 14, note: 14 };
const tolerance = 1;

function fail(context, message) { throw new Error(`${context}: ${message}`); }
function requireText(value, context) {
  if (typeof value !== 'string' || !value.trim()) fail(context, 'expected non-empty text');
}
function requireNumber(value, context, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) fail(context, `expected a number >= ${minimum}`);
}
function requireArray(value, context) {
  if (!Array.isArray(value)) fail(context, 'expected an array');
}
function requireStyle(value, styles, context) {
  if (value !== undefined && !styles.includes(value)) fail(context, `unsupported style ${value}`);
}
function inRange(value, low, high) { return value >= low - tolerance && value <= high + tolerance; }
function onBoundary([x, y], anchor) {
  if ('y1' in anchor) return Math.abs(x - anchor.x) <= tolerance && inRange(y, anchor.y1, anchor.y2);
  const vertical = (Math.abs(x - anchor.x) <= tolerance || Math.abs(x - anchor.x - anchor.width) <= tolerance)
    && inRange(y, anchor.y, anchor.y + anchor.height);
  const horizontal = (Math.abs(y - anchor.y) <= tolerance || Math.abs(y - anchor.y - anchor.height) <= tolerance)
    && inRange(x, anchor.x, anchor.x + anchor.width);
  return vertical || horizontal;
}
function crossesInterior([x1, y1], [x2, y2], box) {
  if (x1 === x2) return x1 > box.x + tolerance && x1 < box.x + box.width - tolerance
    && Math.max(y1, y2) > box.y + tolerance && Math.min(y1, y2) < box.y + box.height - tolerance;
  return y1 > box.y + tolerance && y1 < box.y + box.height - tolerance
    && Math.max(x1, x2) > box.x + tolerance && Math.min(x1, x2) < box.x + box.width - tolerance;
}

function validateSource(spec, variant) {
  const context = variant.stem;
  if (!spec || typeof spec !== 'object' || spec.schemaVersion !== 1) fail(context, 'expected schemaVersion 1');
  if (!['architecture', 'sequence', 'workflow', 'isolation'].includes(spec.kind)) fail(context, 'unknown kind');
  if (spec.locale !== variant.locale) fail(context, `locale must be ${variant.locale}`);
  requireText(spec.title, `${context}.title`);
  requireText(spec.description, `${context}.description`);
  if (spec.width !== 1000) fail(context, 'width must be 1000');
  requireNumber(spec.height, `${context}.height`, 180);
  if (spec.height > 5000) fail(context, 'height exceeds preview limits');
  for (const key of ['groups', 'nodes', 'edges', 'notes']) requireArray(spec[key], `${context}.${key}`);
  if (spec.lifelines !== undefined) requireArray(spec.lifelines, `${context}.lifelines`);
  const ids = new Set(['diagram-title', 'diagram-description', 'arrow-request', 'arrow-return', 'arrow-error', 'arrow-dependency']);
  const anchors = new Map();
  function identify(item, collection) {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.id)) fail(`${context}.${collection}`, 'invalid identifier');
    if (ids.has(item.id)) fail(context, `duplicate or reserved identifier ${item.id}`);
    ids.add(item.id);
    return `${context}.${item.id}`;
  }
  function rectangle(item, label) {
    for (const key of ['x', 'y']) requireNumber(item[key], `${label}.${key}`);
    for (const key of ['width', 'height']) requireNumber(item[key], `${label}.${key}`, 1);
    if (item.x + item.width > spec.width || item.y + item.height > spec.height) fail(label, 'rectangle exceeds canvas');
    if (item.y < 78) fail(label, 'rectangle overlaps title area');
    anchors.set(item.id, item);
  }
  for (const group of spec.groups) {
    const label = identify(group, 'groups');
    rectangle(group, label);
    requireText(group.label, `${label}.label`);
    requireStyle(group.style, ['local', 'remote', 'optional', 'exception'], label);
  }
  for (const node of spec.nodes) {
    const label = identify(node, 'nodes');
    rectangle(node, label);
    requireText(node.title, `${label}.title`);
    requireArray(node.body, `${label}.body`);
    node.body.forEach((line, index) => requireText(line, `${label}.body[${index}]`));
    requireStyle(node.style, ['default', 'decision', 'error', 'remote'], label);
  }
  for (const lifeline of spec.lifelines ?? []) {
    const label = identify(lifeline, 'lifelines');
    for (const key of ['x', 'y1', 'y2']) requireNumber(lifeline[key], `${label}.${key}`);
    if (lifeline.x > spec.width || lifeline.y2 > spec.height || lifeline.y1 < 78 || lifeline.y2 <= lifeline.y1) fail(label, 'invalid lifeline bounds');
    anchors.set(lifeline.id, lifeline);
  }
  for (const edge of spec.edges) {
    const label = identify(edge, 'edges');
    if (!anchors.has(edge.from) || !anchors.has(edge.to)) fail(label, 'from/to must name existing anchors');
    requireStyle(edge.style, ['request', 'return', 'error', 'dependency'], label);
    if (edge.bidirectional !== undefined && typeof edge.bidirectional !== 'boolean') fail(label, 'bidirectional must be boolean');
    requireArray(edge.points, `${label}.points`);
    if (edge.points.length < 2) fail(label, 'needs at least two authored points');
    edge.points.forEach((point, index) => {
      if (!Array.isArray(point) || point.length !== 2) fail(label, `point ${index} must be [x, y]`);
      requireNumber(point[0], `${label}.points[${index}].x`);
      requireNumber(point[1], `${label}.points[${index}].y`, 78);
      if (point[0] > spec.width || point[1] > spec.height) fail(label, `point ${index} exceeds canvas`);
      if (!index) return;
      const previous = edge.points[index - 1];
      if ((previous[0] === point[0]) === (previous[1] === point[1])) fail(label, `segment ${index} must be non-zero and orthogonal`);
      for (const node of spec.nodes) if (crossesInterior(previous, point, node)) fail(label, `segment ${index} crosses node ${node.id}`);
    });
    if (!onBoundary(edge.points[0], anchors.get(edge.from))) fail(label, 'first point does not touch source anchor');
    if (!onBoundary(edge.points.at(-1), anchors.get(edge.to))) fail(label, 'last point does not touch target anchor');
    if (edge.label !== undefined) {
      requireText(edge.label, `${label}.label`);
      for (const key of ['labelX', 'labelY']) requireNumber(edge[key], `${label}.${key}`);
      if (edge.labelWidth !== undefined) requireNumber(edge.labelWidth, `${label}.labelWidth`, 24);
    } else if (['labelX', 'labelY', 'labelWidth'].some(key => edge[key] !== undefined)) fail(label, 'coordinates require a label');
  }
  spec.notes.forEach((note, index) => requireText(note, `${context}.notes[${index}]`));
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}
function number(value) { return String(Math.round(value * 100) / 100); }
function tag(name, attributes, content) {
  const serialized = Object.entries(attributes).filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${escapeXml(typeof value === 'number' ? number(value) : value)}"`).join(' ');
  return content === undefined ? `<${name} ${serialized}/>` : `<${name} ${serialized}>${content}</${name}>`;
}

// Conservative width estimates keep line breaks deterministic across platforms.
// Browser preview verifies actual font metrics. Text is never clipped or reduced.
function textWidth(text, size, bold = false) {
  let units = 0;
  for (const character of text) {
    if (/\p{Mark}/u.test(character)) continue;
    if (/\s/u.test(character)) units += 0.29;
    else if (/[ilI!|.,:;'`]/.test(character)) units += 0.29;
    else if (/[fjrt()[\]{}]/.test(character)) units += 0.39;
    else if (/[MW@%&#]/.test(character)) units += 0.95;
    else if (character === 'm') units += 0.86;
    else if (character === 'w') units += 0.76;
    else if (/[A-Z]/.test(character)) units += 0.7;
    else if (/[a-z0-9/\\_+\-=]/.test(character)) units += 0.57;
    else units += 1.03;
  }
  return units * size * (bold ? 1.06 : 1);
}
function wrapText(text, width, size, bold = false) {
  if (width <= size) fail('text layout', `insufficient width ${width}`);
  const lines = [];
  for (const paragraph of text.split('\n')) {
    const tokens = paragraph.match(/[A-Za-z0-9][A-Za-z0-9_./:@%+\-=']*|\s+|[^\s]/gu) ?? [];
    let line = '';
    function append(token) {
      const candidate = (line + token).trimStart();
      if (textWidth(candidate.trimEnd(), size, bold) <= width) line = candidate;
      else { if (line.trim()) lines.push(line.trim()); line = token.trimStart(); }
    }
    for (const token of tokens) {
      if (textWidth(token.trim(), size, bold) > width) for (const character of token) append(character);
      else append(token);
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines;
}
function textLine(text, x, y, size, box, label, options = {}) {
  return tag('text', {
    // Some Arial and CJK glyphs extend left of the text origin. Reserve ink
    // bearing space inside the authored fit box instead of relaxing validation.
    x: options.center ? x : x + 2, y, 'font-size': size, fill: options.color ?? color.text,
    'font-weight': options.bold ? 600 : 400, 'text-anchor': options.center ? 'middle' : 'start',
    'data-fit': label, 'data-fit-x': box.x, 'data-fit-y': box.y,
    'data-fit-width': box.width, 'data-fit-height': box.height,
  }, escapeXml(text));
}
function renderGroup(group) {
  const error = group.style === 'exception';
  const box = { x: group.x + 14, y: group.y + 10, width: group.width - 28, height: group.height - 20 };
  const lines = wrapText(group.label, box.width - 4, font.group, true);
  if (lines.length * 21 > box.height) fail(group.id, 'label exceeds rectangle');
  return tag('g', { id: group.id, 'data-group': group.id }, [
    tag('rect', { x: group.x, y: group.y, width: group.width, height: group.height,
      fill: group.style === 'remote' ? color.remote : color.white,
      stroke: error ? color.error : color.border, 'stroke-width': 1.4,
      'stroke-dasharray': ['remote', 'optional', 'exception'].includes(group.style) ? '7 5' : undefined }),
    ...lines.map((line, index) => textLine(line, box.x, box.y + font.group + index * 21,
      font.group, box, `${group.id} label`, { bold: true, color: error ? color.error : color.navy })),
  ].join('\n'));
}
function renderNode(node) {
  const box = { x: node.x + 14, y: node.y + 10, width: node.width - 28, height: node.height - 20 };
  const title = wrapText(node.title, box.width, font.node, true);
  const body = node.body.flatMap(line => wrapText(line, box.width, font.body));
  const contentHeight = title.length * 24 + body.length * 20 + (body.length ? 7 : 0);
  if (contentHeight > box.height) fail(node.id, `text needs ${contentHeight}px; only ${box.height}px available`);
  let top = node.y + (node.height - contentHeight) / 2;
  const content = [tag('rect', { x: node.x, y: node.y, width: node.width, height: node.height,
    fill: node.style === 'remote' ? color.remote : color.fill,
    stroke: node.style === 'error' ? color.error : color.navy, 'stroke-width': node.style === 'decision' ? 2 : 1.4 })];
  for (const line of title) {
    content.push(textLine(line, node.x + node.width / 2, top + font.node, font.node, box,
      `${node.id} title`, { bold: true, center: true, color: node.style === 'error' ? color.error : color.navy }));
    top += 24;
  }
  if (body.length) top += 7;
  for (const line of body) {
    content.push(textLine(line, node.x + node.width / 2, top + font.body, font.body, box, `${node.id} body`, { center: true }));
    top += 20;
  }
  return tag('g', { id: node.id, 'data-node': node.id }, content.join('\n'));
}
function edgeLabel(edge) {
  const width = edge.labelWidth ?? 140;
  const lines = wrapText(edge.label, width, font.edge);
  const height = lines.length * 20;
  const box = { x: edge.labelX - width / 2, y: edge.labelY - height / 2, width, height };
  const maskWidth = Math.min(width, Math.max(...lines.map(line => textWidth(line, font.edge))) + 4) + 12;
  const mask = { x: edge.labelX - maskWidth / 2, y: box.y - 3, width: maskWidth, height: box.height + 6 };
  return {
    box: mask,
    svg: tag('g', { 'data-edge-label': edge.id }, [
      tag('rect', { ...mask, fill: color.white }),
      ...lines.map((line, index) => textLine(line, edge.labelX, box.y + font.edge + index * 20,
        font.edge, box, `${edge.id} label`, { center: true, color: edge.style === 'error' ? color.error : color.text })),
    ].join('\n')),
  };
}
function renderEdge(edge) {
  const style = edge.style ?? 'request';
  return tag('path', {
    id: edge.id, 'data-edge': edge.id, 'data-from': edge.from, 'data-to': edge.to,
    d: edge.points.map(([x, y], index) => `${index ? 'L' : 'M'} ${number(x)} ${number(y)}`).join(' '),
    fill: 'none', stroke: style === 'error' ? color.error : style === 'dependency' ? color.muted : color.navy,
    'stroke-width': 1.6, 'stroke-linejoin': 'miter', 'stroke-dasharray': ['return', 'dependency'].includes(style) ? '6 4' : undefined,
    'marker-end': `url(#arrow-${style})`, 'marker-start': edge.bidirectional ? `url(#arrow-${style})` : undefined,
  });
}
function markerDefinitions() {
  return tag('defs', {}, ['request', 'return', 'error', 'dependency'].map(style => tag('marker', {
    id: `arrow-${style}`, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 8, markerHeight: 8,
    markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
  }, tag('path', { d: 'M 0 0 L 8 4 L 0 8 Z', fill: style === 'error' ? color.error : style === 'dependency' ? color.muted : color.navy }))).join('\n'));
}
function renderDiagram(spec) {
  if (textWidth(spec.title, font.title, true) > spec.width - 52) fail(spec.title, 'title exceeds width');
  const nodeElements = [];
  const nodeErrors = [];
  for (const node of spec.nodes) {
    try { nodeElements.push(renderNode(node)); }
    catch (error) { nodeErrors.push(error.message); }
  }
  if (nodeErrors.length) fail(spec.title, nodeErrors.join('; '));
  const labels = spec.edges.filter(edge => edge.label !== undefined).map(edgeLabel);
  for (const { box } of labels) {
    if (box.x < 0 || box.y < 78 || box.x + box.width > spec.width || box.y + box.height > spec.height) fail(spec.title, 'edge label exceeds diagram area');
  }
  const noteLines = spec.notes.map(note => wrapText(note, spec.width - 52, font.note));
  const noteHeight = noteLines.reduce((total, lines) => total + lines.length * 20 + 6, 0);
  const noteTop = spec.height - 22 - noteHeight;
  const contentBottom = Math.max(78, ...spec.groups.map(group => group.y + group.height),
    ...spec.nodes.map(node => node.y + node.height), ...(spec.lifelines ?? []).map(lifeline => lifeline.y2),
    ...spec.edges.flatMap(edge => edge.points.map(point => point[1])), ...labels.map(label => label.box.y + label.box.height));
  if (spec.notes.length && contentBottom + 28 > noteTop) fail(spec.title, `diagram ends at ${contentBottom}px; notes begin at ${noteTop}px; increase height or adjust layout`);
  const content = [
    tag('title', { id: 'diagram-title' }, escapeXml(spec.title)),
    tag('desc', { id: 'diagram-description' }, escapeXml(spec.description)),
    tag('style', {}, `text{font-family:${font.family}}`), markerDefinitions(),
    tag('rect', { x: 0, y: 0, width: spec.width, height: spec.height, fill: color.white }),
    textLine(spec.title, 24, 45, font.title, { x: 24, y: 16, width: spec.width - 48, height: 40 }, 'main title', { bold: true, color: color.navy }),
    tag('line', { x1: 24, y1: 66, x2: spec.width - 24, y2: 66, stroke: color.border, 'stroke-width': 1 }),
    ...spec.groups.map(renderGroup),
    ...(spec.lifelines ?? []).map(lifeline => tag('line', { id: lifeline.id, x1: lifeline.x, y1: lifeline.y1, x2: lifeline.x, y2: lifeline.y2,
      stroke: color.border, 'stroke-width': 1.3, 'stroke-dasharray': '5 5' })),
    ...spec.edges.map(renderEdge), ...nodeElements, ...labels.map(label => label.svg),
  ];
  if (spec.notes.length) {
    content.push(tag('line', { x1: 24, y1: noteTop - 12, x2: spec.width - 24, y2: noteTop - 12, stroke: color.border }));
    let y = noteTop;
    noteLines.forEach((lines, index) => {
      for (const line of lines) {
        content.push(textLine(line, 24, y + font.note, font.note,
          { x: 24, y: noteTop, width: spec.width - 48, height: noteHeight }, `note ${index + 1}`, { color: color.muted }));
        y += 20;
      }
      y += 6;
    });
  }
  return `${tag('svg', { xmlns: 'http://www.w3.org/2000/svg', width: spec.width, height: spec.height,
    viewBox: `0 0 ${spec.width} ${spec.height}`, role: 'img', lang: spec.locale, 'aria-labelledby': 'diagram-title diagram-description',
  }, `\n${content.join('\n')}\n`)}\n`;
}

async function preview(diagrams) {
  const { chromium } = await import('playwright-core');
  fs.mkdirSync(previewDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.DIAGRAM_BROWSER ? { executablePath: process.env.DIAGRAM_BROWSER } : { channel: 'chrome' }) });
  const context = await browser.newContext({ colorScheme: 'light', deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.route('**/*', route => route.abort());
  const results = [];
  try {
    const page = await context.newPage();
    for (const { stem, spec, svg } of diagrams) {
      await page.setViewportSize({ width: spec.width, height: spec.height });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="margin:0;background:#fff">${svg}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const issues = await page.evaluate(({ width, height, nodes, edges }) => {
        const problems = [];
        const svgElement = document.querySelector('svg');
        if (!svgElement || document.querySelector('parsererror')) return ['SVG did not parse'];
        if (svgElement.querySelectorAll('[data-node]').length !== nodes) problems.push('node count differs from source');
        if (svgElement.querySelectorAll('[data-edge]').length !== edges) problems.push('edge count differs from source');
        for (const element of svgElement.querySelectorAll('[data-fit]')) {
          const actual = element.getBBox();
          const expected = { x: +element.dataset.fitX, y: +element.dataset.fitY, width: +element.dataset.fitWidth, height: +element.dataset.fitHeight };
          if (actual.x < expected.x - 0.75 || actual.y < expected.y - 0.75
            || actual.x + actual.width > expected.x + expected.width + 0.75
            || actual.y + actual.height > expected.y + expected.height + 0.75) problems.push(`${element.dataset.fit}: text exceeds authored bounds (${element.textContent})`);
        }
        for (const element of svgElement.querySelectorAll('rect,path,line,text')) {
          if (element.closest('defs')) continue;
          const box = element.getBBox();
          if (box.x < -0.75 || box.y < -0.75 || box.x + box.width > width + 0.75 || box.y + box.height > height + 0.75) problems.push(`${element.id || element.dataset.fit || element.tagName}: exceeds canvas`);
          for (const attribute of ['marker-start', 'marker-end']) {
            const match = element.getAttribute(attribute)?.match(/^url\(#(.+)\)$/);
            if (match && !document.getElementById(match[1])) problems.push(`${element.id}: missing marker ${match[1]}`);
          }
        }
        return problems;
      }, { width: spec.width, height: spec.height, nodes: spec.nodes.length, edges: spec.edges.length });
      await page.locator('svg').screenshot({ path: path.join(previewDirectory, `${stem}.static.png`) });
      results.push({ stem, width: spec.width, height: spec.height, issues, automatedTextFit: issues.length ? 'failed' : 'passed', visualReview: 'pending' });
      console.log(`${stem}: preview ${issues.length ? 'FAILED' : 'passed'}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
  fs.writeFileSync(path.join(previewDirectory, 'validation.json'), `${JSON.stringify(results, null, 2)}\n`);
  const failed = results.filter(result => result.issues.length);
  if (failed.length) fail('preview', failed.map(result => `${result.stem}: ${result.issues.join('; ')}`).join('\n'));
}
async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) if (!['--check', '--preview', '--help'].includes(arg)) fail('arguments', `unknown option ${arg}`);
  if (args.has('--help')) {
    console.log('Usage: node scripts/render-technical-diagrams.mjs [--check] [--preview]\n'
      + 'Default: validate authored JSON and regenerate deterministic SVG files.\n'
      + '--check: compare SVG bytes without rewriting artifacts.\n'
      + '--preview: fresh headless Chrome, actual text-fit checks, and local PNG previews.\n'
      + 'DIAGRAM_BROWSER may select an existing Chrome/Chromium executable.');
    return;
  }
  const diagrams = [];
  const sourceErrors = [];
  for (const variant of variants) {
    try {
      const source = path.join(directory, 'sources', `${variant.stem}.json`);
      const spec = JSON.parse(fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, ''));
      validateSource(spec, variant);
      diagrams.push({ ...variant, spec, svg: renderDiagram(spec), destination: path.join(directory, `${variant.stem}.svg`) });
    } catch (error) {
      sourceErrors.push(`${variant.stem}: ${error.message}`);
    }
  }
  if (sourceErrors.length) fail('source validation', sourceErrors.join('\n'));
  if (args.has('--check')) {
    const stale = diagrams.filter(diagram => !fs.existsSync(diagram.destination) || fs.readFileSync(diagram.destination, 'utf8') !== diagram.svg);
    if (stale.length) fail('check', `missing or stale SVG files: ${stale.map(diagram => diagram.stem).join(', ')}; regenerate them`);
  } else for (const diagram of diagrams) fs.writeFileSync(diagram.destination, diagram.svg);
  console.log(`${diagrams.length} sources validated; SVG ${args.has('--check') ? 'byte comparison passed' : 'files regenerated'}.`);
  if (args.has('--preview')) await preview(diagrams);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
