import { MAP_THEMES } from '../utils.js';

const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const measureCache = new Map();
let canvasContext = null;

function context() {
  if (!canvasContext) {
    const canvas = document.createElement('canvas');
    canvasContext = canvas.getContext('2d');
  }
  return canvasContext;
}

export function wrapText(text, maxWidth, font) {
  const ctx = context();
  ctx.font = font;
  const chars = [...String(text || '')];
  const lines = [];
  let line = '';
  for (const char of chars) {
    if (char === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    const candidate = line + char;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = candidate;
    }
  }
  if (line || !lines.length) lines.push(line);
  if (lines.length > 4) {
    const clipped = lines.slice(0, 4);
    clipped[3] = `${clipped[3].replace(/[，。；,;.\s]+$/, '').slice(0, -1)}…`;
    return clipped;
  }
  return lines;
}

export function measureNode(text, depth = 1) {
  const key = `${depth}:${text}`;
  if (measureCache.has(key)) return measureCache.get(key);
  const fontSize = depth === 0 ? 16 : 14;
  const fontWeight = depth === 0 ? 650 : 520;
  const font = `${fontWeight} ${fontSize}px ${FONT_STACK}`;
  const maxWidth = depth === 0 ? 220 : 198;
  const lines = wrapText(text, maxWidth, font);
  const ctx = context();
  ctx.font = font;
  const longest = Math.max(...lines.map((line) => ctx.measureText(line).width), 24);
  const width = Math.round(Math.min(maxWidth + 34, Math.max(depth === 0 ? 154 : 108, longest + 34)));
  const lineHeight = depth === 0 ? 23 : 21;
  const height = Math.round(Math.max(depth === 0 ? 50 : 42, lines.length * lineHeight + 19));
  const result = { width, height, lines, fontSize, lineHeight, font };
  measureCache.set(key, result);
  return result;
}

export function computeLayout(root, options = {}) {
  const hGap = options.hGap ?? 74;
  const vGap = options.vGap ?? 18;
  const padding = options.padding ?? 56;

  function build(node, depth, branchIndex) {
    const measure = measureNode(node.text, depth);
    const children = (node.children || []).map((child, index) =>
      build(child, depth + 1, depth === 0 ? index : branchIndex),
    );
    const childrenHeight =
      children.reduce((sum, child) => sum + child.subtreeHeight, 0) +
      Math.max(0, children.length - 1) * vGap;
    return {
      node,
      id: node.id,
      depth,
      branchIndex,
      width: measure.width,
      height: measure.height,
      lines: measure.lines,
      fontSize: measure.fontSize,
      lineHeight: measure.lineHeight,
      children,
      subtreeHeight: Math.max(measure.height, childrenHeight),
    };
  }

  const tree = build(root, 0, -1);
  const nodes = [];

  function place(item, x, centerY, parent) {
    const entry = {
      id: item.id,
      node: item.node,
      text: item.node.text,
      note: item.node.note,
      depth: item.depth,
      branchIndex: item.branchIndex,
      x,
      y: centerY - item.height / 2,
      width: item.width,
      height: item.height,
      lines: item.lines,
      fontSize: item.fontSize,
      lineHeight: item.lineHeight,
      parentId: parent?.id || null,
      childCount: item.children.length,
    };
    nodes.push(entry);
    if (!item.children.length) return;
    const total =
      item.children.reduce((sum, child) => sum + child.subtreeHeight, 0) +
      (item.children.length - 1) * vGap;
    let y = centerY - total / 2;
    for (const child of item.children) {
      place(child, x + item.width + hGap, y + child.subtreeHeight / 2, entry);
      y += child.subtreeHeight + vGap;
    }
  }

  const rootCenterY = padding + tree.subtreeHeight / 2;
  place(tree, padding, rootCenterY, null);

  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const minY = Math.min(...nodes.map((node) => node.y));
  const offsetY = padding - minY;
  if (offsetY !== 0) nodes.forEach((node) => { node.y += offsetY; });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const width = maxX + padding;
  const height = maxY + offsetY + padding;

  const connectors = nodes
    .filter((node) => node.parentId)
    .map((node) => {
      const parent = byId.get(node.parentId);
      if (!parent) return null;
      const x1 = parent.x + parent.width;
      const y1 = parent.y + parent.height / 2;
      const x2 = node.x;
      const y2 = node.y + node.height / 2;
      const bend = Math.max(28, (x2 - x1) * 0.48);
      return {
        id: node.id,
        branchIndex: node.branchIndex,
        path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      };
    })
    .filter(Boolean);

  return { nodes, connectors, width, height, rootId: root.id, byId };
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSvgMarkup(layout, themeName = 'forest') {
  const theme = MAP_THEMES[themeName] || MAP_THEMES.forest;
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
  );
  parts.push(`<rect width="${layout.width}" height="${layout.height}" fill="${theme.paper}"/>`);
  for (const connector of layout.connectors) {
    const color = theme.branch[connector.branchIndex % theme.branch.length] || theme.line;
    parts.push(
      `<path d="${connector.path}" fill="none" stroke="${color}" stroke-opacity="0.55" stroke-width="1.8"/>`,
    );
  }
  for (const node of layout.nodes) {
    const branchColor = theme.branch[node.branchIndex % theme.branch.length] || theme.accent;
    const isRoot = node.depth === 0;
    const fill = isRoot ? theme.root : node.depth === 1 ? '#fffdf8' : '#fffefb';
    const stroke = isRoot ? theme.root : branchColor;
    const textFill = isRoot ? theme.rootInk : '#24312b';
    const radius = isRoot ? 15 : 12;
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-opacity="${isRoot ? '1' : '0.42'}" stroke-width="${isRoot ? 0 : 1.3}"/>`,
    );
    if (!isRoot) {
      parts.push(
        `<rect x="${node.x}" y="${node.y + 9}" width="3" height="${Math.max(14, node.height - 18)}" rx="1.5" fill="${branchColor}"/>`,
      );
    }
    const totalTextHeight = node.lines.length * node.lineHeight;
    const startY = node.y + (node.height - totalTextHeight) / 2 + node.lineHeight * 0.78;
    node.lines.forEach((line, index) => {
      parts.push(
        `<text x="${node.x + 16}" y="${startY + index * node.lineHeight}" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="${node.fontSize}" font-weight="${isRoot ? 650 : 500}" fill="${textFill}">${escapeXml(line)}</text>`,
      );
    });
  }
  parts.push('</svg>');
  return parts.join('');
}

export function resolveNodePalette(themeName, branchIndex, depth) {
  const theme = MAP_THEMES[themeName] || MAP_THEMES.forest;
  const branch = theme.branch[branchIndex % theme.branch.length] || theme.accent;
  return {
    branch,
    fill: depth === 0 ? theme.root : '#fffdf8',
    ink: depth === 0 ? theme.rootInk : '#24312b',
    line: theme.line,
    root: theme.root,
    paper: theme.paper,
  };
}

export function markdownFromTree(root, title = '思维导图') {
  const lines = [`# ${title}`, ''];
  const walk = (node, depth) => {
    lines.push(`${'  '.repeat(depth)}- ${node.text}`);
    if (node.note) lines.push(`${'  '.repeat(depth + 1)}> ${node.note.replace(/\n/g, ' ')}`);
    (node.children || []).forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);
  return lines.join('\n');
}

export function countNodes(root) {
  if (!root) return 0;
  return 1 + (root.children || []).reduce((sum, child) => sum + countNodes(child), 0);
}

export function cloneTree(root) {
  return JSON.parse(JSON.stringify(root));
}
