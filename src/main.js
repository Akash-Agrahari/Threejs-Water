import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise";
import HeightmapFragment from "../shaders/HeightmapFragment.glsl";
import {GUI} from 'lil-gui'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { PMREMGenerator } from 'three';


// Create scene
const scene = new THREE.Scene();

// Mouse & raycaster setup
let mouseMoved = false;
let pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

const cursor = document.querySelector("#cursor");

window.addEventListener("mousemove", (event) => {
  cursor.style.left = event.clientX - 20 + "px";
  cursor.style.top = event.clientY - 20 + "px";
});


// Create camera
const canvasWidth = window.innerWidth;
const canvasHeight = window.innerHeight;
const aspect = canvasWidth / canvasHeight;
const cameraZ = 300; // Keep far enough to avoid clipping and match desired resolution

const fov = 2 * Math.atan((canvasHeight / 2) / cameraZ) * (180 / Math.PI);

const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 10000);
camera.position.z = 250;

// Canvas setup
const canvas = document.querySelector("#canvas");


// Create renderer
const renderer = new THREE.WebGLRenderer({ canvas,alpha: true, antialias: true  });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));


const textureLoader = new THREE.TextureLoader();
const texture = textureLoader.load('../black.png');


const rgeb = new RGBELoader()
const premreb = new PMREMGenerator(renderer);
premreb.compileEquirectangularShader()
rgeb.load("https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/metro_noord_1k.hdr",(tex)=>{
  const envMap = premreb.fromEquirectangular(tex).texture;

  scene.environment = envMap;

  tex.dispose()
  premreb.dispose();
})


const FBO_WIDTH = 128;
const FBO_HEIGHT = 128;
const GEOM_WIDTH = window.innerWidth;
const GEOM_HEIGHT = window.innerHeight;

const plane = new THREE.PlaneGeometry(
  GEOM_WIDTH,
  GEOM_HEIGHT,
  FBO_WIDTH - 1,
  FBO_HEIGHT - 1
);
const waterMat = new THREE.MeshPhysicalMaterial({
  metalness: 0.,
  map : texture,
  // transparent : true,
  roughness: .0,
  transmission: 1.,           // Makes it transparent like water
  thickness: 1.,              // For refraction depth
  ior: 1.,                  // Index of refraction for water
  clearcoat: .0,              // Extra reflectivity on top
  clearcoatRoughness: 0.0,
  envMapIntensity: 0.,
});

waterMat.userData.heightmap = { value: null };

waterMat.onBeforeCompile = (shader) => {
  shader.uniforms.heightmap = waterMat.userData.heightmap;
  shader.vertexShader = shader.vertexShader.replace(
    "#include <common>",
    ` uniform sampler2D heightmap;
      #include <common>
    `
  );

  shader.vertexShader = shader.vertexShader.replace(
    `#include <beginnormal_vertex>`,
    `
     // Compute normal from heightmap
    vec2 cellSize = vec2( 1.0 / (${FBO_WIDTH.toFixed(
      1
    )}), 1.0 / ${FBO_HEIGHT.toFixed(1)} );
    vec3 objectNormal = vec3(
      ( texture2D( heightmap, uv + vec2( - cellSize.x, 0 ) ).x - texture2D( heightmap, uv + vec2( cellSize.x, 0 ) ).x ) * ${FBO_WIDTH.toFixed(
        1
      )} / ${GEOM_WIDTH.toFixed(1)},
      ( texture2D( heightmap, uv + vec2( 0, - cellSize.y ) ).x - texture2D( heightmap, uv + vec2( 0, cellSize.y ) ).x ) * ${FBO_HEIGHT.toFixed(
        1
      )} / ${GEOM_HEIGHT.toFixed(1)},
      1.0 );
    `
  );
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `
    float heightValue = texture2D( heightmap, uv ).x;
    vec3 transformed = vec3( position.x, position.y, heightValue );
  `
  );
};

const planeMesh = new THREE.Mesh(plane, waterMat);
planeMesh.matrixAutoUpdate = false;
planeMesh.updateMatrix();
planeMesh.position.z = 9.9; // Closer than textMesh (z=10)


scene.add(planeMesh);

window.addEventListener("pointermove", (event) => {
  if (event.isPrimary === false) return;
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  mouseMoved = true;
});


const params = {
  mouseSize: 50.0,
  viscosity: 0.961,
  waveHeight: 1.7,
}

const gpuCompute = new GPUComputationRenderer(FBO_WIDTH, FBO_HEIGHT, renderer);
if (renderer.capabilities.isWebGL2 === false) {
  gpuCompute.setDataType(THREE.HalfFloatType);
}


const fillTexture = (texture) => {
     const waterMaxHeight = 2;
  const simplex = new SimplexNoise()

  function layeredNoise( x, y ) {
    let multR = waterMaxHeight;
    let mult = 0.025;
    let r = 0;
    for ( let i = 0; i < 10; i ++ ) {
      r += multR * simplex.noise( x * mult, y * mult );
      multR *= 0.5;
      mult *= 2;
    }

    return r;
  }

  const pixels = texture.image.data;

  let p = 0;
  for ( let j = 0; j < FBO_HEIGHT; j ++ ) {
    for ( let i = 0; i < FBO_WIDTH; i ++ ) {
      const x = i * 128 / FBO_WIDTH;
      const y = j * 128 / FBO_HEIGHT;

      pixels[ p + 0 ] = layeredNoise( x, y );
      pixels[ p + 1 ] = 0;
      pixels[ p + 2 ] = 0;
      pixels[ p + 3 ] = 1;

      p += 4;
    }
  }
}

const heightmap0 = gpuCompute.createTexture()
fillTexture( heightmap0 )
const heightmapVariable = gpuCompute.addVariable( 'heightmap', HeightmapFragment, heightmap0 )
gpuCompute.setVariableDependencies( heightmapVariable, [ heightmapVariable ] )


heightmapVariable.material.uniforms[ 'mousePos' ] = { value: new THREE.Vector2( 10000, 10000 ) }
heightmapVariable.material.uniforms[ 'mouseSize' ] = { value: params.mouseSize }
heightmapVariable.material.uniforms[ 'viscosityConstant' ] = { value: params.viscosity }
heightmapVariable.material.uniforms[ 'waveheightMultiplier' ] = { value: params.waveHeight }
heightmapVariable.material.defines.GEOM_WIDTH = GEOM_WIDTH.toFixed( 1 )
heightmapVariable.material.defines.GEOM_HEIGHT = GEOM_HEIGHT.toFixed( 1 )

const error = gpuCompute.init()
if ( error !== null ) {
  console.error( error )
}

const gui = new GUI()
gui.add(params, "mouseSize", 1.0, 100.0, 1.0 ).onChange((newVal) => {
  heightmapVariable.material.uniforms[ 'mouseSize' ].value = newVal
})
gui.add(params, "viscosity", 0.9, 0.999, 0.001 ).onChange((newVal) => {
  heightmapVariable.material.uniforms[ 'viscosityConstant' ].value = newVal
})
gui.add(params, "waveHeight", 0.1, 8.0, 0.05 ).onChange((newVal) => {
  heightmapVariable.material.uniforms[ 'waveheightMultiplier' ].value = newVal
})

gpuCompute.compute()
waterMat.userData.heightmap.value = gpuCompute.getCurrentRenderTarget( heightmapVariable ).texture




// Animation loop
function animate() {
  requestAnimationFrame(animate);

  gpuCompute.compute();
  waterMat.userData.heightmap.value =
    gpuCompute.getCurrentRenderTarget(heightmapVariable).texture;

  const uniforms = heightmapVariable.material.uniforms;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObject(planeMesh);
  if (mouseMoved && intersects.length) {
  const { point } = intersects[0];
  planeMesh.worldToLocal(point); // Convert from world to local space
  uniforms.mousePos.value.set(point.x, -point.y); // Flip Y-axis

} else {
  uniforms.mousePos.value.set(10000, 10000);
}
  mouseMoved = false;

  renderer.render(scene, camera);
}


// Handle window resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
