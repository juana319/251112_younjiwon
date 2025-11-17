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
const selGeo = new THREE.SphereGeometry(0.15, 12, 12)
const selMatA = new THREE.MeshStandardMaterial({ color: 0xff4444 })
const selMatB = new THREE.MeshStandardMaterial({ color: 0x44cc44 })
const selA = new THREE.Mesh(selGeo, selMatA)
const selB = new THREE.Mesh(selGeo, selMatB)
selA.visible = false
selB.visible = false
scene.add(selA)
scene.add(selB)



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
      return { point: it.point, mesh }
    }
  }
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

  saveHistory()

}



function saveHistory() {

  // Remove any future history if we're not at the end

  history.length = historyIndex + 1

  // Save current state

  const state = {

    blocks: blocks.map(b => ({

      position: b.position.clone(),

      color: b.material.color.getHex()

    })),

    stackMap: new Map(stackMap)

  }

  history.push(state)

  historyIndex++

}

function updateSelectionMarkers() {
  if (selectState.pointA && selectState.pointA.pos) {
    selA.position.copy(selectState.pointA.pos)
    selA.position.y += 0.06
    selA.visible = true
  } else {
    selA.visible = false
  }

  if (selectState.pointB && selectState.pointB.pos) {
    selB.position.copy(selectState.pointB.pos)
    selB.position.y += 0.06
    selB.visible = true
  } else {
    selB.visible = false
  }
}



function undo() {

  if (historyIndex > 0) {

    historyIndex--

    restoreState(history[historyIndex])

  }

}



function redo() {

  if (historyIndex < history.length - 1) {

    historyIndex++

    restoreState(history[historyIndex])

  }

}



function restoreState(state) {

  // Remove all blocks from scene

  blocks.forEach(m => scene.remove(m))

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

    blocks.push(mesh)

    increaseStack(blockData.position.x, blockData.position.z)

  })

}



function resetApp() {

  blocks.forEach(m => scene.remove(m))

  blocks.length = 0

  stackMap.clear()

  history.length = 0

  historyIndex = -1

  selectState = { pointA: null, pointB: null }

  updateModeUI()

  updateInstructions()
  updateSelectionMarkers()

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

  // left button only

  if (e.button === 0) {

    if (mode === 'create') {

      placeBlock()

    } else if (mode === 'select') {

      const p = pointerToGround(e)

      if (p) {

        const gx = snap(p.x)

        const gz = snap(p.z)

        if (!selectState.pointA) {

          selectState.pointA = { x: gx, z: gz }

          updateInstructions()

        } else if (!selectState.pointB) {

          selectState.pointB = { x: gx, z: gz }

          updateInstructions()
          updateSelectionMarkers()

          // Now we have both points, could do something with them

          console.log('Selection complete:', selectState)

        } else {

          updateSelectionMarkers()
          // Reset and start over

          selectState.pointA = { x: gx, z: gz }

          selectState.pointB = null

          updateInstructions()

        }

      }

    }

    } else if (mode === 'select') {

      const hit = pointerToScene(e)
      if (hit && hit.mesh) {
        const nearest = getNearestVertex(hit.mesh, hit.point)
        if (nearest) {
          if (!selectState.pointA) {
            selectState.pointA = { pos: nearest.clone(), meshId: hit.mesh.id }
            updateInstructions()
            updateSelectionMarkers()
          } else if (!selectState.pointB) {
            selectState.pointB = { pos: nearest.clone(), meshId: hit.mesh.id }
            updateInstructions()
            updateSelectionMarkers()
            console.log('Selection complete:', selectState)
          } else {
            // reset and start over
            selectState.pointA = { pos: nearest.clone(), meshId: hit.mesh.id }
            selectState.pointB = null
            updateInstructions()
            updateSelectionMarkers()
          }
        }
      }

    }

          updateSelectionMarkers()
  }

)



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

instr.id = 'instructions'

instr.style.position = 'absolute'

instr.style.top = '8px'

instr.style.left = '8px'

instr.style.padding = '6px 10px'

instr.style.background = 'rgba(255,255,255,0.8)'

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

    text = 'Click: 블록 배치 · Drag: 카메라 회전'

  } else if (mode === 'select') {

    if (!selectState.pointA) {

      text = 'Click: A 시작점 선택'

    } else if (!selectState.pointB) {

      text = `A 선택됨 (${selectState.pointA.x}, ${selectState.pointA.z}) · Click: B 끝점 선택`

    } else {

      text = `A (${selectState.pointA.x}, ${selectState.pointA.z}) · B (${selectState.pointB.x}, ${selectState.pointB.z}) 선택됨`

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