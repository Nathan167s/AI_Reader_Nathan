import { uid } from '../utils.js';

/**
 * 创建概念树节点。root 与普通节点共用同一结构：
 * { id, concept, definition, relation, quotes, children }
 */
export function makeConceptNode(concept = '新概念', patch = {}) {
  return {
    id: uid('c'),
    concept,
    definition: '',
    relation: '',
    quotes: [],
    children: [],
    ...patch,
  };
}

/** 修正后端返回的树：补齐 id / quotes / children，并保证 id 唯一。 */
export function ensureNodeIds(root, seen = new Set()) {
  if (!root || typeof root !== 'object') return null;
  let id = typeof root.id === 'string' && root.id.trim() ? root.id.trim() : uid('c');
  if (seen.has(id)) id = uid('c');
  seen.add(id);
  return {
    ...root,
    id,
    concept: typeof root.concept === 'string' ? root.concept : String(root.text || '新概念'),
    definition: typeof root.definition === 'string' ? root.definition : '',
    relation: typeof root.relation === 'string' ? root.relation : '',
    quotes: Array.isArray(root.quotes) ? root.quotes : [],
    children: Array.isArray(root.children)
      ? root.children.map((child) => ensureNodeIds(child, seen)).filter(Boolean)
      : [],
  };
}

export function findNode(root, id) {
  if (!root || !id) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function findParent(root, id, parent = null) {
  if (!root || !id) return null;
  if (root.id === id) return parent;
  for (const child of root.children || []) {
    const found = findParent(child, id, root);
    if (found) return found;
  }
  return null;
}

/** 返回从根节点到目标节点的路径，可用于面包屑与父概念定位。 */
export function findPath(root, id, trail = []) {
  if (!root || !id) return null;
  const next = [...trail, root];
  if (root.id === id) return next;
  for (const child of root.children || []) {
    const found = findPath(child, id, next);
    if (found) return found;
  }
  return null;
}

/** 不可变更新：只重建目标节点到根节点之间的分支。 */
export function updateNode(root, id, patch) {
  if (!root || !id) return root;
  if (root.id === id) {
    return {
      ...root,
      ...patch,
      children: patch && 'children' in patch ? patch.children : root.children || [],
    };
  }
  let changed = false;
  const children = (root.children || []).map((child) => {
    const next = updateNode(child, id, patch);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

/** 不可变插入：把 child 追加为 parentId 节点的最后一个子节点。 */
export function insertChild(root, parentId, child) {
  if (!root || !parentId || !child) return root;
  if (root.id === parentId) {
    return { ...root, children: [...(root.children || []), child] };
  }
  let changed = false;
  const children = (root.children || []).map((node) => {
    const next = insertChild(node, parentId, child);
    if (next !== node) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

/** 不可变删除。根节点永远不被删除，返回 { root, removed }。 */
export function removeNode(root, id) {
  if (!root || !id) return { root, removed: false };
  if (root.id === id) return { root, removed: false };
  let removed = false;
  const children = [];
  for (const child of root.children || []) {
    if (child.id === id) {
      removed = true;
      continue;
    }
    const result = removeNode(child, id);
    if (result.removed) removed = true;
    children.push(result.root);
  }
  return removed
    ? { root: { ...root, children }, removed: true }
    : { root, removed: false };
}

export function collectIds(root, ids = []) {
  if (!root) return ids;
  ids.push(root.id);
  (root.children || []).forEach((child) => collectIds(child, ids));
  return ids;
}

export function collectConceptNames(root, names = new Set()) {
  if (!root) return names;
  names.add(String(root.concept || '').trim());
  (root.children || []).forEach((child) => collectConceptNames(child, names));
  return names;
}

/** 生成不与现有节点重名的默认概念名：新概念 / 新概念 2 / 新概念 3 … */
export function uniqueConceptName(root, base = '新概念') {
  const names = collectConceptNames(root);
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function countNodes(root) {
  if (!root) return 0;
  return 1 + (root.children || []).reduce((sum, child) => sum + countNodes(child), 0);
}

export function countQuotes(root) {
  if (!root) return 0;
  return (
    (root.quotes?.length || 0) +
    (root.children || []).reduce((sum, child) => sum + countQuotes(child), 0)
  );
}

/**
 * 保存前清洗树数据：
 * - 空概念名补成可读的占位名（后端会丢弃空名节点）；
 * - 去重概念名（后端 normalize 会去重，重名节点会丢失）；
 * - 去掉定义/关系两端的空白。
 */
export function sanitizeRoot(root, used = new Set(), depth = 0) {
  if (!root) return root;
  let concept = String(root.concept || '').replace(/\s+/g, ' ').trim();
  if (!concept) concept = depth === 0 ? '未命名概念树' : '未命名概念';
  if (used.has(concept)) {
    const base = concept;
    let index = 2;
    while (used.has(`${base} ${index}`)) index += 1;
    concept = `${base} ${index}`;
  }
  used.add(concept);
  return {
    ...root,
    concept,
    definition: String(root.definition || '').trim(),
    relation: String(root.relation || '').trim(),
    quotes: Array.isArray(root.quotes) ? root.quotes : [],
    children: (root.children || []).map((child) => sanitizeRoot(child, used, depth + 1)),
  };
}
