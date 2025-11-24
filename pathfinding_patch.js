// --- Block-edge-based pathfinding ---
function posKey(v) {
  return `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`
}

function buildBlockEdgeGraph() {
  const nodes = new Map()
  const adj = new Map()

  const offsets = [
    new THREE.Vector3(-0.5, -0.5, -0.5),
    new THREE.Vector3(0.5, -0.5, -0.5),
    new THREE.Vector3(-0.5, 0.5, -0.5),
    new THREE.Vector3(0.5, 0.5, -0.5),
    new THREE.Vector3(-0.5, -0.5, 0.5),
    new THREE.Vector3(0.5, -0.5, 0.5),
    new THREE.Vector3(-0.5, 0.5, 0.5),
    new THREE.Vector3(0.5, 0.5, 0.5)
  ]

  const edges = [
    [0,1],[1,3],[3,2],[2,0],
    [4,5],[5,7],[7,6],[6,4],
    [0,4],[1,5],[2,6],[3,7]
  ]

  for (const b of blocks) {
    const c = b.mesh.position
    const corners = offsets.map(o => new THREE.Vector3(c.x + o.x * blockSize, c.y + o.y * blockSize, c.z + o.z * blockSize))
    const keys = corners.map(v => posKey(v))
    
    for (let i = 0; i < corners.length; i++) {
      const k = keys[i]
      if (!nodes.has(k)) nodes.set(k, corners[i].clone())
      if (!adj.has(k)) adj.set(k, new Set())
    }
    
    for (const [i0, i1] of edges) {
      const k0 = keys[i0]
      const k1 = keys[i1]
      adj.get(k0).add(k1)
      adj.get(k1).add(k0)
    }
  }

  return { nodes, adj }
}

function computePathCounts() {
  if (!selectState.pointA || !selectState.pointB) return null
  
  const graph = buildBlockEdgeGraph()
  const startKey = posKey(selectState.pointA.pos)
  const endKey = posKey(selectState.pointB.pos)
  
  if (!graph.nodes.has(startKey) || !graph.nodes.has(endKey)) {
    return { distance: Infinity, count: 0, aGrid: selectState.pointA.pos, bGrid: selectState.pointB.pos }
  }

  const dist = new Map()
  const count = new Map()
  const q = []
  dist.set(startKey, 0)
  count.set(startKey, 1)
  q.push(startKey)

  while (q.length) {
    const u = q.shift()
    const d = dist.get(u)
    const neighbors = graph.adj.get(u) || new Set()
    for (const v of neighbors) {
      if (!dist.has(v)) {
        dist.set(v, d + 1)
        count.set(v, count.get(u))
        q.push(v)
      } else if (dist.get(v) === d + 1) {
        count.set(v, count.get(v) + count.get(u))
      }
    }
  }

  const distance = dist.get(endKey) === undefined ? Infinity : dist.get(endKey)
  const pathCount = count.get(endKey) || 0
  
  return { distance, count: pathCount, aGrid: selectState.pointA.pos, bGrid: selectState.pointB.pos }
}

function generateAllShortestPaths() {
  if (!selectState.pointA || !selectState.pointB) return []
  
  const graph = buildBlockEdgeGraph()
  const startKey = posKey(selectState.pointA.pos)
  const endKey = posKey(selectState.pointB.pos)
  
  if (!graph.nodes.has(startKey) || !graph.nodes.has(endKey)) return []

  // BFS to find shortest distance
  const dist = new Map()
  const q = []
  dist.set(startKey, 0)
  q.push(startKey)

  while (q.length) {
    const u = q.shift()
    const d = dist.get(u)
    const neighbors = graph.adj.get(u) || new Set()
    for (const v of neighbors) {
      if (!dist.has(v)) {
        dist.set(v, d + 1)
        q.push(v)
      }
    }
  }

  const targetDist = dist.get(endKey)
  if (targetDist === undefined) return []

  // Backtrack all shortest paths
  const allPaths = []

  function backtrack(path, currentKey) {
    if (currentKey === endKey) {
      allPaths.push(path.map(k => graph.nodes.get(k).clone()))
      return
    }
    const d = dist.get(currentKey)
    const neighbors = graph.adj.get(currentKey) || new Set()
    for (const nk of neighbors) {
      if (dist.get(nk) === d + 1) {
        path.push(nk)
        backtrack(path, nk)
        path.pop()
      }
    }
  }

  backtrack([startKey], startKey)
  return allPaths
}
