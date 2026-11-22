// Entry for the vendored three.js bundle (tools/build_three.sh → js/three.min.js): three with WebGPURenderer and the
// node materials as one global THREE, TSL as THREE.TSL, plus the bloom add-on
export * from 'three/webgpu';
export * as TSL from 'three/tsl';
export { bloom } from 'three/addons/tsl/display/BloomNode.js';
