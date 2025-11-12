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
const blocks = [] // array of meshes
const stackMap = new Map() // key: "x,z" -> count
const blockSize = 1

// Ghost (preview) block
const ghostMat = new THREE.MeshStandardMaterial({ color: 0x0077ff, opacity: 0.5, transparent: true })
const ghostGeo = new THREE.BoxGeometry(blockSize, blockSize, blockSize)
const ghost = new THREE.Mesh(ghostGeo, ghostMat)
ghost.visible = true
scene.add(ghost)

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
  blocks.push(mesh)
  // update stack map
  const x = mesh.position.x
  const z = mesh.position.z
  increaseStack(x, z)
}

// Pointer move handler
renderer.domElement.addEventListener('pointermove', (e) => {
  const p = pointerToGround(e)
  updateGhostFromPoint(p)
})

// Click to place
renderer.domElement.addEventListener('pointerdown', (e) => {
  // left button only
  if (e.button === 0) placeBlock()
})

// Keyboard: C to clear
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'c') {
    // remove blocks
    blocks.forEach((m) => scene.remove(m))
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
instr.style.position = 'absolute'
instr.style.top = '8px'
instr.style.left = '8px'
instr.style.padding = '6px 10px'
instr.style.background = 'rgba(255,255,255,0.8)'
instr.style.borderRadius = '6px'
instr.style.fontFamily = 'Arial, sans-serif'
instr.style.fontSize = '13px'
instr.innerHTML = 'Click: place block · C: clear stacks · Drag: orbit camera'
container.appendChild(instr)

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
