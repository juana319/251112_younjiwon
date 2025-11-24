import './style.css'



// Import Three.js modules from local npm package

import * as THREE from 'three'

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'



// Simple block stacking app

const app = document.querySelector('#app')

app.innerHTML = `<div id="three-root" style="width:100vw;height:100vh;overflow:hidden;position:relative"></div>`



const container = document.getElementById('three-root')



// Renderer

const renderer = new THREE.WebGLRenderer({ antialias: true })

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

renderer.setSize(container.clientWidth, container.clientHeight)

container.appendChild(renderer.domElement)



// Scene + Camera

const scene = new THREE.Scene()

scene.background = new THREE.Color(0xf0f0f0)



const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000)

camera.position.set(8, 12, 12)



// Controls

const controls = new OrbitControls(camera, renderer.domElement)

controls.target.set(0, 0.5, 0)

controls.update()



// Lights

const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.8)

scene.add(hemi)

const dir = new THREE.DirectionalLight(0xffffff, 0.6)

dir.position.set(5, 10, 7)

scene.add(dir)



// Grid guide lines

const gridSize = 20

const gridDivisions = 20

const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0xdddddd)

gridHelper.position.y = 0

scene.add(gridHelper)



// Ground plane (invisible) for raycasting

const planeGeo = new THREE.PlaneGeometry(gridSize, gridSize)

const planeMat = new THREE.MeshBasicMaterial({ visible: false })

const ground = new THREE.Mesh(planeGeo, planeMat)

ground.rotateX(-Math.PI / 2)

scene.add(ground)



// Data structures for blocks

// blocks: array of { mesh, edges }
const blocks = []

const stackMap = new Map() // key: "x,z" -> count

const blockSize = 1

const history = [] // for undo/redo

let historyIndex = -1

let mode = 'create' // 'create' or 'select'

let selectState = { pointA: null, pointB: null } // for vertex selection mode; each point will be { pos: Vector3, meshId }



// Ghost (preview) block

const ghostMat = new THREE.MeshStandardMaterial({ color: 0x0077ff, opacity: 0.5, transparent: true })

const ghostGeo = new THREE.BoxGeometry(blockSize, blockSize, blockSize)

const ghost = new THREE.Mesh(ghostGeo, ghostMat)

ghost.visible = true

scene.add(ghost)

// Selection markers (visual feedback for A and B)
const selGeo = new THREE.SphereGeometry(0.12, 12, 12)
const selMatA = new THREE.MeshStandardMaterial({ color: 0xff4444 })
const selMatB = new THREE.MeshStandardMaterial({ color: 0x44cc44 })
const selA = new THREE.Mesh(selGeo, selMatA)
const selB = new THREE.Mesh(selGeo, selMatB)
selA.visible = false
selB.visible = false
scene.add(selA)
scene.add(selB)

// Wireframe edge box shown around selected vertex (12 edges)
function createEdgeBox(size = 1, color = 0x222222) {
  const geo = new THREE.BoxGeometry(size, size, size)
  const edges = new THREE.EdgesGeometry(geo)
  const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 })
  const lines = new THREE.LineSegments(edges, mat)
  return lines
}

const wireA = createEdgeBox(blockSize * 0.9, 0xffcc00)
const wireB = createEdgeBox(blockSize * 0.9, 0x00ccff)
wireA.visible = false
wireB.visible = false
scene.add(wireA)
scene.add(wireB)

let pathLine = null // currently drawn example path
// thumbnail renderers and DOM elements for 사례보기
let thumbRenderers = []
let thumbCanvases = []
let thumbScenes = []
let thumbObjects = []
let thumbsContainer = null



// Helper to snap to integer grid (centered)

function snap(v) {

  return Math.round(v / blockSize) * blockSize

}



// Raycaster and pointer

const raycaster = new THREE.Raycaster()

const pointer = new THREE.Vector2()



function getStackHeight(x, z) {

  const key = `${x},${z}`

  return stackMap.get(key) || 0

}



function increaseStack(x, z) {

  const key = `${x},${z}`

  const v = (stackMap.get(key) || 0) + 1

  stackMap.set(key, v)

  return v

}



function pointerToGround(evt) {

  const rect = renderer.domElement.getBoundingClientRect()

  pointer.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1

  pointer.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1



  raycaster.setFromCamera(pointer, camera)

  const intersects = raycaster.intersectObject(ground)

  if (intersects.length > 0) return intersects[0].point

  return null

}

// Raycast against scene objects (exclude helpers/ground/ghost/selection markers)
function pointerToScene(evt) {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(pointer, camera)
  const intersects = raycaster.intersectObjects(scene.children, true)
  for (let i = 0; i < intersects.length; i++) {
    const it = intersects[i]
    const obj = it.object
    if (obj === ground) continue
    if (obj === ghost) continue
    if (obj === selA || obj === selB) continue
    if (obj.type === 'GridHelper') continue
    if (obj.type === 'HemisphereLight' || obj.type === 'DirectionalLight') continue
    // find a parent that has geometry
    let mesh = obj
    while (mesh && !mesh.geometry && mesh.parent) mesh = mesh.parent
    if (mesh && mesh.geometry) {
      // only allow selecting actual box meshes (our blocks)
      if (mesh.geometry.type !== 'BoxGeometry') continue
      return { point: it.point, mesh }
    }
  }
  return null
}

// Find nearest vertex (8 corners) of a box geometry
function getNearestVertex(mesh, worldPoint) {
  const geom = mesh.geometry
  if (!geom) return null
  
  // Get position attribute
  const posAttr = geom.attributes && geom.attributes.position
  if (!posAttr) return null

  // Box geometry has 8 vertices (corners)
  // Indices: 0-7 represent the 8 corners
  const vertexIndices = [0, 1, 2, 3, 4, 5, 6, 7]

  let minDist = Infinity
  let nearestPoint = null

  for (const i of vertexIndices) {
    // Get vertex in local space
    const vertex = new THREE.Vector3()
    vertex.fromBufferAttribute(posAttr, i)
    
    // Convert to world space
    const wsVertex = vertex.applyMatrix4(mesh.matrixWorld)
    
    // Calculate distance from worldPoint
    const dist = wsVertex.distanceTo(worldPoint)
    
    if (dist < minDist) {
      minDist = dist
      nearestPoint = wsVertex.clone()
    }
  }

  // Only return if within reasonable snapping distance
  return minDist < 0.3 ? nearestPoint : null
}


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
  
  if (!graph.nodes.has(startKey) || !graph.nodes.has(endKey)) {
    console.log('Start or end not in graph')
    return []
  }

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
  if (targetDist === undefined) {
    console.log('No path found')
    return []
  }

  console.log('Shortest distance:', targetDist)

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
  console.log('Generated paths:', allPaths.length)
  return allPaths
}


function showPathLine(path) {
  // clear previous group
  if (pathLine) {
    scene.remove(pathLine)
    // dispose children geometries/materials
    pathLine.traverse((c) => {
      if (c.geometry) c.geometry.dispose()
      if (c.material) c.material.dispose()
    })
    pathLine = null
  }

  const group = new THREE.Group()

  // create a smooth curve and tube for thickness
  const curve = new THREE.CatmullRomCurve3(path)
  const segments = Math.max(path.length * 8, 32)
  const tubeGeo = new THREE.TubeGeometry(curve, segments, 0.08, 8, false)
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 })
  const tube = new THREE.Mesh(tubeGeo, tubeMat)
  group.add(tube)

  // Add A and B markers
  const sphGeo = new THREE.SphereGeometry(0.12, 12, 12)
  const sphA = new THREE.Mesh(sphGeo, new THREE.MeshBasicMaterial({ color: 0xff0000 }))
  const sphB = new THREE.Mesh(sphGeo, new THREE.MeshBasicMaterial({ color: 0x00ff00 }))
  sphA.position.copy(path[0])
  sphB.position.copy(path[path.length - 1])
  group.add(sphA)
  group.add(sphB)

  pathLine = group
  scene.add(pathLine)
}

// Visualize all paths in a grid layout
let pathVisuals = [] // store created visuals for cleanup

function showAllPathsGrid(paths) {
  // remove any previous overlay
  if (thumbsContainer) {
    thumbRenderers.forEach(r => {
      try { r.forceContextLoss && r.forceContextLoss() } catch(e) {}
    })
    thumbRenderers = []
    thumbCanvases.forEach(c => c.remove())
    thumbCanvases = []
    thumbScenes = []
    thumbObjects = []
    thumbsContainer.remove()
    thumbsContainer = null
  }

  if (!paths || paths.length === 0) return

  // full-page overlay
  thumbsContainer = document.createElement('div')
  thumbsContainer.style.position = 'fixed'
  thumbsContainer.style.top = '0'
  thumbsContainer.style.left = '0'
  thumbsContainer.style.width = '100%'
  thumbsContainer.style.height = '100%'
  thumbsContainer.style.background = '#ffffff' // white background
  thumbsContainer.style.zIndex = '9999'
  thumbsContainer.style.overflow = 'auto'
  thumbsContainer.style.padding = '24px'
  document.body.appendChild(thumbsContainer)

  // header with title and button
  const header = document.createElement('div')
  header.style.display = 'flex'
  header.style.justifyContent = 'space-between'
  header.style.alignItems = 'center'
  header.style.marginBottom = '20px'
  header.style.padding = '0 8px'

  const title = document.createElement('h2')
  title.textContent = `최단 경로 사례 (총 ${paths.length}개)`
  title.style.margin = '0'
  title.style.fontSize = '24px'
  title.style.fontWeight = 'bold'
  title.style.color = '#333'
  header.appendChild(title)

  const closeBtn = document.createElement('button')
  closeBtn.textContent = '도형 만들러 가기'
  closeBtn.style.padding = '12px 24px'
  closeBtn.style.fontSize = '16px'
  closeBtn.style.fontWeight = 'bold'
  closeBtn.style.background = '#4CAF50'
  closeBtn.style.color = 'white'
  closeBtn.style.border = 'none'
  closeBtn.style.borderRadius = '6px'
  closeBtn.style.cursor = 'pointer'
  closeBtn.style.transition = 'background 0.3s'
  closeBtn.onmouseover = () => closeBtn.style.background = '#45a049'
  closeBtn.onmouseout = () => closeBtn.style.background = '#4CAF50'
  closeBtn.onclick = () => {
    if (thumbsContainer) {
      thumbRenderers.forEach(r => {
        try { r.forceContextLoss && r.forceContextLoss() } catch(e) {}
      })
      thumbRenderers = []
      thumbCanvases.forEach(c => c.remove())
      thumbCanvases = []
      thumbScenes = []
      thumbObjects = []
      thumbsContainer.remove()
      thumbsContainer = null
      // Restore main renderer
      renderer.render(scene, camera)
    }
  }
  header.appendChild(closeBtn)
  thumbsContainer.appendChild(header)

  // grid container for thumbnails
  const gridContainer = document.createElement('div')
  gridContainer.style.display = 'flex'
  gridContainer.style.flexWrap = 'wrap'
  gridContainer.style.gap = '12px'
  gridContainer.style.justifyContent = 'flex-start'
  gridContainer.style.alignItems = 'flex-start'
  thumbsContainer.appendChild(gridContainer)

  const colors = [
    0xff0000, 0x00aa00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ccff,
    0xff6600, 0x00aaff, 0x6600ff, 0xffcc00, 0xff0099, 0x0099cc
  ]

  console.log('Total paths to render:', paths.length)
  
  // Create single shared renderer
  const sharedCanvas = document.createElement('canvas')
  const w = 250
  const h = 200
  sharedCanvas.width = w
  sharedCanvas.height = h
  const sharedRenderer = new THREE.WebGLRenderer({ canvas: sharedCanvas, antialias: true, alpha: false, preserveDrawingBuffer: true })
  sharedRenderer.setSize(w, h)
  sharedRenderer.setPixelRatio(1)
  
  paths.forEach((path, idx) => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    canvas.style.background = '#ffffff'
    canvas.style.border = '1px solid #ddd'
    canvas.style.borderRadius = '6px'
    canvas.style.flexShrink = '0'
    gridContainer.appendChild(canvas)
    thumbCanvases.push(canvas)

    // mini scene
    const s = new THREE.Scene()
    s.background = new THREE.Color(0xffffff)
    thumbScenes.push(s)

    // camera
    const cam = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000)
    cam.position.set(3, 3, 6)
    cam.lookAt(0, 0, 0)

    // lights
    s.add(new THREE.HemisphereLight(0xffffff, 0xdddddd, 0.8))
    const dl = new THREE.DirectionalLight(0xffffff, 0.6)
    dl.position.set(5, 10, 7)
    s.add(dl)

    // slightly more opaque blocks (scaled down)
    blocks.forEach(b => {
      const geo = new THREE.BoxGeometry(blockSize * 0.6, blockSize * 0.6, blockSize * 0.6)
      const mat = new THREE.MeshStandardMaterial({ color: 0xcc7a00, transparent: true, opacity: 0.55 })
      const m = new THREE.Mesh(geo, mat)
      m.position.copy(b.mesh.position)
      m.position.multiplyScalar(0.6)
      s.add(m)
      thumbObjects.push(m)
    })

    // create thinner tube path
    const pts = path.map(p => new THREE.Vector3(p.x * 0.6, p.y * 0.6, p.z * 0.6))
    const curve = new THREE.CatmullRomCurve3(pts)
    const tubeGeo = new THREE.TubeGeometry(curve, Math.max(pts.length * 6, 24), 0.04, 8, false)
    const tubeMat = new THREE.MeshBasicMaterial({ color: colors[idx % colors.length] })
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat)
    s.add(tubeMesh)
    thumbObjects.push(tubeMesh)

    // A/B markers
    const sphGeo = new THREE.SphereGeometry(0.08, 12, 12)
    const aMesh = new THREE.Mesh(sphGeo, new THREE.MeshBasicMaterial({ color: 0xff0000 }))
    const bMesh = new THREE.Mesh(sphGeo, new THREE.MeshBasicMaterial({ color: 0x00ff00 }))
    aMesh.position.copy(pts[0])
    bMesh.position.copy(pts[pts.length - 1])
    s.add(aMesh)
    s.add(bMesh)
    thumbObjects.push(aMesh, bMesh)

    // Store camera with scene
    s.userData.camera = cam
    s.userData.targetCanvas = canvas
  })

  // Render all scenes using shared renderer and copy to individual canvases
  requestAnimationFrame(() => {
    thumbScenes.forEach((s, i) => {
      if (s && s.userData.camera && s.userData.targetCanvas) {
        sharedRenderer.render(s, s.userData.camera)
        const ctx = s.userData.targetCanvas.getContext('2d')
        ctx.drawImage(sharedCanvas, 0, 0)
      }
    })
    console.log('Rendered', thumbScenes.length, 'thumbnails')
    // Cleanup shared renderer
    sharedRenderer.dispose()
  })
}



function updateGhostFromPoint(point) {

  if (!point) {

    ghost.visible = false

    return

  }

  // snap X/Z to grid

  const gx = snap(point.x)

  const gz = snap(point.z)

  const colHeight = getStackHeight(gx, gz)

  const gy = colHeight * blockSize + blockSize / 2

  ghost.position.set(gx, gy, gz)

  ghost.visible = true

}



// Place a real block at ghost position

function placeBlock() {

  if (!ghost.visible) return

  const mesh = new THREE.Mesh(

    new THREE.BoxGeometry(blockSize, blockSize, blockSize),

    new THREE.MeshStandardMaterial({ color: 0xff8f00 })

  )

  mesh.position.copy(ghost.position)

  scene.add(mesh)

  // add edge lines to make corners visible
  const edges = createEdgeBox(blockSize, 0x5a3b1a)
  edges.position.copy(mesh.position)
  scene.add(edges)

  blocks.push({ mesh, edges })

  // update stack map

  const x = mesh.position.x

  const z = mesh.position.z

  increaseStack(x, z)

  // record action (store primitives for replay)
  pushAction({
    type: 'place',
    position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    color: mesh.material.color.getHex()
  })

}



// Action-based history: each action is a single step (place/select/etc.)
function pushAction(action) {
  // truncate future
  history.length = historyIndex + 1
  history.push(action)
  historyIndex++
}

function applyAction(action) {
  if (!action) return
  if (action.type === 'place') {
    const pos = action.position
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(blockSize, blockSize, blockSize),
      new THREE.MeshStandardMaterial({ color: action.color })
    )
    mesh.position.set(pos.x, pos.y, pos.z)
    scene.add(mesh)
    const edges = createEdgeBox(blockSize, 0x5a3b1a)
    edges.position.copy(mesh.position)
    scene.add(edges)
    blocks.push({ mesh, edges })
    increaseStack(mesh.position.x, mesh.position.z)
  } else if (action.type === 'select') {
    // set selectState exactly as stored
    const ss = action.selectState || { pointA: null, pointB: null }
    selectState = { pointA: null, pointB: null }
    if (ss.pointA) selectState.pointA = { pos: new THREE.Vector3(ss.pointA.x, ss.pointA.y, ss.pointA.z), meshId: ss.pointA.meshId }
    if (ss.pointB) selectState.pointB = { pos: new THREE.Vector3(ss.pointB.x, ss.pointB.y, ss.pointB.z), meshId: ss.pointB.meshId }
    mode = action.mode || mode
    updateSelectionMarkers()
    updateModeUI()
    updateInstructions()
  } else if (action.type === 'clear') {
    // clear all blocks
    blocks.forEach(b => {
      if (b.mesh) scene.remove(b.mesh)
      if (b.edges) scene.remove(b.edges)
    })
    blocks.length = 0
    stackMap.clear()
  } else if (action.type === 'reset') {
    // reset selection and mode
    selectState = { pointA: null, pointB: null }
    mode = 'create'
    updateSelectionMarkers()
    updateModeUI()
    updateInstructions()
  }
}

function replayHistory(upToIndex) {
  // clear scene blocks
  blocks.forEach(b => {
    if (b.mesh) scene.remove(b.mesh)
    if (b.edges) scene.remove(b.edges)
  })
  blocks.length = 0
  stackMap.clear()

  // reset selection/mode
  selectState = { pointA: null, pointB: null }
  mode = 'create'

  // apply actions from 0..upToIndex
  for (let i = 0; i <= upToIndex; i++) {
    applyAction(history[i])
  }

  updateSelectionMarkers()
  updateModeUI()
  updateInstructions()
}

function updateSelectionMarkers() {
  if (selectState.pointA && selectState.pointA.pos) {
    selA.position.copy(selectState.pointA.pos)
    selA.position.y += 0.06
    selA.visible = true
    wireA.position.copy(selectState.pointA.pos)
    wireA.visible = true
  } else {
    selA.visible = false
    wireA.visible = false
  }

  if (selectState.pointB && selectState.pointB.pos) {
    selB.position.copy(selectState.pointB.pos)
    selB.position.y += 0.06
    selB.visible = true
    wireB.position.copy(selectState.pointB.pos)
    wireB.visible = true
  } else {
    selB.visible = false
    wireB.visible = false
  }
}



function undo() {

  if (historyIndex >= 0) {
    historyIndex--
    if (historyIndex >= 0) {
      replayHistory(historyIndex)
    } else {
      // cleared all actions -> empty scene
      blocks.forEach(b => { if (b.mesh) scene.remove(b.mesh); if (b.edges) scene.remove(b.edges) })
      blocks.length = 0
      stackMap.clear()
      selectState = { pointA: null, pointB: null }
      mode = 'create'
      updateSelectionMarkers()
      updateModeUI()
      updateInstructions()
    }
  }

}



function redo() {

  if (historyIndex < history.length - 1) {
    historyIndex++
    replayHistory(historyIndex)
  }

}



function restoreState(state) {

  // Remove all blocks from scene

  blocks.forEach(b => {
    if (b.mesh) scene.remove(b.mesh)
    if (b.edges) scene.remove(b.edges)
  })

  blocks.length = 0

  stackMap.clear()

  

  // Restore blocks

  state.blocks.forEach(blockData => {

    const mesh = new THREE.Mesh(

      new THREE.BoxGeometry(blockSize, blockSize, blockSize),

      new THREE.MeshStandardMaterial({ color: blockData.color })

    )

    mesh.position.copy(blockData.position)

    scene.add(mesh)

    const edges = createEdgeBox(blockSize, 0x5a3b1a)
    edges.position.copy(mesh.position)
    scene.add(edges)

    blocks.push({ mesh, edges })

    increaseStack(blockData.position.x, blockData.position.z)

  })
  
  // Restore selection state and mode
  mode = state.mode || 'create'
  selectState = state.selectState ? {
    pointA: state.selectState.pointA ? { pos: state.selectState.pointA.pos.clone(), meshId: state.selectState.pointA.meshId } : null,
    pointB: state.selectState.pointB ? { pos: state.selectState.pointB.pos.clone(), meshId: state.selectState.pointB.meshId } : null
  } : { pointA: null, pointB: null }
  
  updateModeUI()
  updateInstructions()
  updateSelectionMarkers()

}



function resetApp() {

  blocks.forEach(b => {
    if (b.mesh) scene.remove(b.mesh)
    if (b.edges) scene.remove(b.edges)
  })

  blocks.length = 0

  stackMap.clear()

  history.length = 0

  historyIndex = -1

  selectState = { pointA: null, pointB: null }

  updateModeUI()

  updateInstructions()
  updateSelectionMarkers()

  // remove any thumbnail visuals and renderers
  if (thumbsContainer) {
    thumbRenderers.forEach(r => {
      try { r.forceContextLoss && r.forceContextLoss() } catch (e) {}
    })
    thumbRenderers = []
    thumbCanvases.forEach(c => c.remove())
    thumbCanvases = []
    thumbScenes = []
    thumbObjects = []
    thumbsContainer.remove()
    thumbsContainer = null
  }

}



// Enable touch for OrbitControls
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN
}

// Pointer move handler

renderer.domElement.addEventListener('pointermove', (e) => {

  const p = pointerToGround(e)

  if (mode === 'create') {

    updateGhostFromPoint(p)

  } else if (mode === 'select') {

    // In select mode, we could show a preview, but let's keep it simple for now

    updateGhostFromPoint(null)

  }

})



// Click to place or select

renderer.domElement.addEventListener('pointerdown', (e) => {

  // left button only (mouse) or touch
  if (e.pointerType === 'mouse' && e.button !== 0) return

  // Store initial position for touch/click detection
  const startX = e.clientX
  const startY = e.clientY
  const startTime = Date.now()

  const onPointerUp = (upEvent) => {
    const deltaX = Math.abs(upEvent.clientX - startX)
    const deltaY = Math.abs(upEvent.clientY - startY)
    const deltaTime = Date.now() - startTime
    
    // Only trigger if it's a tap/click (not a drag)
    if (deltaX < 10 && deltaY < 10 && deltaTime < 300) {
      if (mode === 'create') {
        placeBlock()
      } else if (mode === 'select') {
        handleSelectClick(upEvent)
      }
    }
    
    renderer.domElement.removeEventListener('pointerup', onPointerUp)
  }
  
  renderer.domElement.addEventListener('pointerup', onPointerUp)
})

function handleSelectClick(e) {
  const hit = pointerToScene(e)
  if (hit && hit.mesh) {
    const nearest = getNearestVertex(hit.mesh, hit.point)
    if (nearest) {
      if (!selectState.pointA) {
        selectState.pointA = { pos: nearest.clone(), meshId: hit.mesh.id }
        // push select action (store primitives)
        pushAction({
          type: 'select',
          selectState: { pointA: { x: selectState.pointA.pos.x, y: selectState.pointA.pos.y, z: selectState.pointA.pos.z, meshId: selectState.pointA.meshId }, pointB: null },
          mode: mode
        })
        updateInstructions()
        updateSelectionMarkers()
      } else if (!selectState.pointB) {
        selectState.pointB = { pos: nearest.clone(), meshId: hit.mesh.id }
        pushAction({
          type: 'select',
          selectState: { pointA: { x: selectState.pointA.pos.x, y: selectState.pointA.pos.y, z: selectState.pointA.pos.z, meshId: selectState.pointA.meshId }, pointB: { x: selectState.pointB.pos.x, y: selectState.pointB.pos.y, z: selectState.pointB.pos.z, meshId: selectState.pointB.meshId } },
          mode: mode
        })
        updateInstructions()
        updateSelectionMarkers()
        console.log('Selection complete:', selectState)
      } else {
        // reset and start over
        selectState.pointA = { pos: nearest.clone(), meshId: hit.mesh.id }
        selectState.pointB = null
        pushAction({
          type: 'select',
          selectState: { pointA: { x: selectState.pointA.pos.x, y: selectState.pointA.pos.y, z: selectState.pointA.pos.z, meshId: selectState.pointA.meshId }, pointB: null },
          mode: mode
        })
        updateInstructions()
        updateSelectionMarkers()
      }
    }
  }
}



// Keyboard: C to clear

window.addEventListener('keydown', (e) => {

  if (e.key.toLowerCase() === 'c') {

    // remove blocks and their edge helpers

    blocks.forEach((b) => {
      if (b.mesh) scene.remove(b.mesh)
      if (b.edges) scene.remove(b.edges)
    })

    blocks.length = 0

    stackMap.clear()

  }

})


// Resize

window.addEventListener('resize', onWindowResize)

function onWindowResize() {

  camera.aspect = container.clientWidth / container.clientHeight

  camera.updateProjectionMatrix()

  renderer.setSize(container.clientWidth, container.clientHeight)

}



// Simple grid axis labels (small helper)

const axes = new THREE.AxesHelper(5)

scene.add(axes)



// Overlay instructions

const instr = document.createElement('div')

instr.id = 'instructions'

instr.style.position = 'absolute'

instr.style.top = '8px'

instr.style.left = '8px'

instr.style.padding = '6px 10px'

instr.style.background = 'rgba(0,0,0,0.7)'

instr.style.color = '#ffffff'

instr.style.borderRadius = '6px'

instr.style.fontFamily = 'Arial, sans-serif'

instr.style.fontSize = '13px'

container.appendChild(instr)



// Control panel with mode selection buttons

const controlPanel = document.createElement('div')

controlPanel.id = 'control-panel'

controlPanel.style.position = 'absolute'

controlPanel.style.top = '8px'

controlPanel.style.right = '8px'

controlPanel.style.padding = '12px'

controlPanel.style.background = 'rgba(255,255,255,0.95)'

controlPanel.style.borderRadius = '8px'

controlPanel.style.fontFamily = 'Arial, sans-serif'

controlPanel.style.fontSize = '14px'

controlPanel.style.display = 'flex'

controlPanel.style.flexDirection = 'column'

controlPanel.style.gap = '8px'

controlPanel.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)'



// Mode selector

const modeLabel = document.createElement('div')

modeLabel.style.fontWeight = 'bold'

modeLabel.style.marginBottom = '4px'

modeLabel.textContent = '모드 선택:'

controlPanel.appendChild(modeLabel)



const modeButtons = document.createElement('div')

modeButtons.style.display = 'flex'

modeButtons.style.gap = '6px'

modeButtons.style.marginBottom = '8px'



const createBtn = document.createElement('button')

createBtn.textContent = '1) 입체도형 만들기'

createBtn.id = 'mode-create'

createBtn.style.padding = '8px 12px'

createBtn.style.borderRadius = '4px'

createBtn.style.border = 'none'

createBtn.style.cursor = 'pointer'

createBtn.style.fontWeight = 'bold'

createBtn.style.backgroundColor = '#0077ff'

createBtn.style.color = 'white'

createBtn.addEventListener('click', () => {

  mode = 'create'

  selectState = { pointA: null, pointB: null }

  updateModeUI()

  updateInstructions()
  updateSelectionMarkers()

})

modeButtons.appendChild(createBtn)



const selectBtn = document.createElement('button')

selectBtn.textContent = '2) 꼭지점 선택하기'

selectBtn.id = 'mode-select'

selectBtn.style.padding = '8px 12px'

selectBtn.style.borderRadius = '4px'

selectBtn.style.border = 'none'

selectBtn.style.cursor = 'pointer'

selectBtn.style.fontWeight = 'bold'

selectBtn.style.backgroundColor = '#cccccc'

selectBtn.style.color = 'black'

selectBtn.addEventListener('click', () => {

  mode = 'select'

  selectState = { pointA: null, pointB: null }

  updateModeUI()

  updateInstructions()
  updateSelectionMarkers()

})

modeButtons.appendChild(selectBtn)

controlPanel.appendChild(modeButtons)



// Action buttons

const actionLabel = document.createElement('div')

actionLabel.style.fontWeight = 'bold'

actionLabel.style.marginBottom = '4px'

actionLabel.textContent = '작업:'

controlPanel.appendChild(actionLabel)



const actionButtons = document.createElement('div')

actionButtons.style.display = 'flex'

actionButtons.style.gap = '6px'

actionButtons.style.flexWrap = 'wrap'



const undoBtn = document.createElement('button')

undoBtn.textContent = '뒤로가기'

undoBtn.style.padding = '6px 10px'

undoBtn.style.borderRadius = '4px'

undoBtn.style.border = 'none'

undoBtn.style.cursor = 'pointer'

undoBtn.style.backgroundColor = '#f0f0f0'

undoBtn.style.color = 'black'

undoBtn.addEventListener('click', undo)

actionButtons.appendChild(undoBtn)



const redoBtn = document.createElement('button')

redoBtn.textContent = '앞으로가기'

redoBtn.style.padding = '6px 10px'

redoBtn.style.borderRadius = '4px'

redoBtn.style.border = 'none'

redoBtn.style.cursor = 'pointer'

redoBtn.style.backgroundColor = '#f0f0f0'

redoBtn.style.color = 'black'

redoBtn.addEventListener('click', redo)

actionButtons.appendChild(redoBtn)



const resetBtn = document.createElement('button')

resetBtn.textContent = '초기화'

resetBtn.style.padding = '6px 10px'

resetBtn.style.borderRadius = '4px'

resetBtn.style.border = 'none'

resetBtn.style.cursor = 'pointer'

resetBtn.style.backgroundColor = '#ff4444'

resetBtn.style.color = 'white'

resetBtn.addEventListener('click', resetApp)

actionButtons.appendChild(resetBtn)



controlPanel.appendChild(actionButtons)

container.appendChild(controlPanel)

// Result area for path counts / examples
const resultBox = document.createElement('div')
resultBox.id = 'result-box'
resultBox.style.position = 'absolute'
resultBox.style.top = '50px'
resultBox.style.left = '8px'
resultBox.style.padding = '8px 10px'
resultBox.style.background = 'rgba(0,0,0,0.7)'
resultBox.style.color = '#ffffff'
resultBox.style.borderRadius = '6px'
resultBox.style.fontFamily = 'Arial, sans-serif'
resultBox.style.fontSize = '13px'
resultBox.style.maxWidth = '320px'
resultBox.style.overflowWrap = 'break-word'
resultBox.innerHTML = '경로 결과가 여기에 표시됩니다.'
container.appendChild(resultBox)

// Add path action buttons
const pathButtons = document.createElement('div')
pathButtons.style.display = 'flex'
pathButtons.style.gap = '6px'
pathButtons.style.marginTop = '6px'

const countBtn = document.createElement('button')
countBtn.textContent = '경우의 수 구하기'
countBtn.style.padding = '6px 10px'
countBtn.style.borderRadius = '4px'
countBtn.style.border = 'none'
countBtn.style.cursor = 'pointer'
countBtn.style.backgroundColor = '#4CAF50'
countBtn.style.color = 'white'
countBtn.addEventListener('click', () => {
  const res = computePathCounts()
  if (res === null) {
    resultBox.innerHTML = 'A 또는 B가 선택되지 않았습니다.'
  } else {
    const countNum = Math.floor(res.count)
    resultBox.innerHTML = `<strong>최단거리 경우의 수는 ${countNum}가지입니다.</strong><br/>A: (${res.aGrid.x}, ${res.aGrid.y}, ${res.aGrid.z}) → B: (${res.bGrid.x}, ${res.bGrid.y}, ${res.bGrid.z})<br/>최단 거리: ${res.distance}`
  }
})

const exampleBtn = document.createElement('button')
exampleBtn.textContent = '사례보기'
exampleBtn.style.padding = '6px 10px'
exampleBtn.style.borderRadius = '4px'
exampleBtn.style.border = 'none'
exampleBtn.style.cursor = 'pointer'
exampleBtn.style.backgroundColor = '#FF9800'
exampleBtn.style.color = 'white'
exampleBtn.addEventListener('click', () => {
  const paths = generateAllShortestPaths()
  if (!paths || paths.length === 0) {
    resultBox.innerHTML = '경로를 찾을 수 없습니다. A/B를 확인하세요.'
  } else {
    const res = computePathCounts()
    resultBox.innerHTML = `<strong>${paths.length}가지 경로를 시각화했습니다.</strong>`
    showAllPathsGrid(paths)
  }
})

pathButtons.appendChild(countBtn)
pathButtons.appendChild(exampleBtn)
controlPanel.appendChild(pathButtons)



function updateModeUI() {

  const createBtn = document.getElementById('mode-create')

  const selectBtn = document.getElementById('mode-select')

  

  if (mode === 'create') {

    createBtn.style.backgroundColor = '#0077ff'

    createBtn.style.color = 'white'

    selectBtn.style.backgroundColor = '#cccccc'

    selectBtn.style.color = 'black'

  } else {

    createBtn.style.backgroundColor = '#cccccc'

    createBtn.style.color = 'black'

    selectBtn.style.backgroundColor = '#0077ff'

    selectBtn.style.color = 'white'

  }

}



function updateInstructions() {

  const instr = document.getElementById('instructions')

  let text = ''

  

  if (mode === 'create') {

    text = 'Click/Tap: 블록 배치 · Drag: 카메라 회전'

  } else if (mode === 'select') {

    if (!selectState.pointA) {

      text = 'Click: A 시작점 선택'

    } else if (!selectState.pointB) {

      const a = selectState.pointA.pos ? selectState.pointA.pos : selectState.pointA
      text = `A 선택됨 (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) · Click: B 끝점 선택`

    } else {

      const a = selectState.pointA.pos ? selectState.pointA.pos : selectState.pointA
      const b = selectState.pointB.pos ? selectState.pointB.pos : selectState.pointB
      text = `A (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) · B (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) 선택됨`

    }

  }

  

  instr.innerHTML = text

}



updateModeUI()

updateInstructions()



// Animate

function animate() {

  requestAnimationFrame(animate)

  renderer.render(scene, camera)

}

animate()



// When pointer leaves canvas hide ghost

renderer.domElement.addEventListener('pointerleave', () => (ghost.visible = false))



// Initial ghost placement at center

updateGhostFromPoint(new THREE.Vector3(0, 0, 0))



// Export small API for debugging in console

window.__blocksApp = { scene, camera, renderer, placeBlock }