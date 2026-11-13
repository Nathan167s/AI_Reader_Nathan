import { uid } from '../utils.js';

export function makeNode(text = '新想法', children = []) {
  return { id: uid('m'), text, note: '', children };
}

export function ensureNodeIds(node) {
  if (!node) return makeNode('中心主题');
  return {
    ...node,
    id: node.id || uid('m'),
    text: String(node.text || '新节点').slice(0, 200),
    note: String(node.note || ''),
    children: Array.isArray(node.children) ? node.children.map(ensureNodeIds) : [],
  };
}

export function findNode(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function findParent(root, id) {
  if (!root) return null;
  for (const child of root.children || []) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

export function updateNode(root, id, updater) {
  if (!root) return root;
  if (root.id === id) {
    const next = typeof updater === 'function' ? updater(root) : { ...root, ...updater };
    return { ...root, ...next };
  }
  return {
    ...root,
    children: (root.children || []).map((child) => updateNode(child, id, updater)),
  };
}

export function insertChild(root, parentId, node) {
  return updateNode(root, parentId, (parent) => ({
    ...parent,
    children: [...(parent.children || []), node],
  }));
}

export function insertSibling(root, id, node) {
  if (!root || root.id === id) return root;
  const children = root.children || [];
  const index = children.findIndex((child) => child.id === id);
  if (index >= 0) {
    const next = [...children];
    next.splice(index + 1, 0, node);
    return { ...root, children: next };
  }
  return { ...root, children: children.map((child) => insertSibling(child, id, node)) };
}

export function removeNode(root, id) {
  if (!root || root.id === id) return { root, removed: null };
  let removed = null;
  const walk = (node) => {
    const children = [];
    for (const child of node.children || []) {
      if (child.id === id) {
        removed = child;
        continue;
      }
      children.push(walk(child));
    }
    return { ...node, children };
  };
  const next = walk(root);
  return { root: next, removed };
}

export function moveNode(root, id, delta) {
  if (!root || root.id === id) return root;
  const children = root.children || [];
  const index = children.findIndex((child) => child.id === id);
  if (index >= 0) {
    const target = index + delta;
    if (target < 0 || target >= children.length) return root;
    const next = [...children];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    return { ...root, children: next };
  }
  return { ...root, children: children.map((child) => moveNode(child, id, delta)) };
}

export function countTree(root) {
  if (!root) return 0;
  return 1 + (root.children || []).reduce((sum, child) => sum + countTree(child), 0);
}

export function maxDepth(root, depth = 0) {
  if (!root?.children?.length) return depth;
  return Math.max(...root.children.map((child) => maxDepth(child, depth + 1)));
}
