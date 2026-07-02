'use client'

import { useRef, useEffect, useState, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  // Simplex-like noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime * 0.08;

    // Layered noise for organic flow
    float n1 = snoise(uv * 1.5 + t * 0.5) * 0.5 + 0.5;
    float n2 = snoise(uv * 3.0 - t * 0.3 + 10.0) * 0.5 + 0.5;
    float n3 = snoise(uv * 0.8 + t * 0.2 + vec2(5.0, 3.0)) * 0.5 + 0.5;

    // Color palette: deep dark, lime accent, subtle purple
    vec3 darkBase = vec3(0.024, 0.024, 0.039);
    vec3 limeAccent = vec3(0.82, 1.0, 0.102);
    vec3 deepPurple = vec3(0.545, 0.36, 0.965);
    vec3 limeLight = vec3(0.894, 1.0, 0.4);

    // Mix colors based on noise layers
    vec3 color = darkBase;

    // Lime glow - top left area
    float limeMask = smoothstep(0.55, 0.85, n1) * smoothstep(0.3, 0.0, length(uv - vec2(0.15, 0.85)));
    color += limeAccent * limeMask * 0.12;

    // Purple glow - right area
    float purpleMask = smoothstep(0.5, 0.8, n2) * smoothstep(0.4, 0.0, length(uv - vec2(0.9, 0.6)));
    color += deepPurple * purpleMask * 0.08;

    // Light lime accent - center top
    float limeLightMask = smoothstep(0.6, 0.9, n3) * smoothstep(0.35, 0.0, length(uv - vec2(0.5, 0.9)));
    color += limeLight * limeLightMask * 0.06;

    // Subtle center glow
    float centerGlow = smoothstep(0.7, 0.0, length(uv - vec2(0.5, 0.5))) * 0.015;
    color += limeAccent * centerGlow;

    // Vignette
    float vignette = smoothstep(0.0, 0.7, length(uv - vec2(0.5)));
    color *= (1.0 - vignette * 0.3);

    gl_FragColor = vec4(color, 1.0);
  }
`

function GradientMesh() {
  const mesh = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  }), [])

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <mesh ref={mesh} position={[0, 0, 0]}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        depthWrite={false}
      />
    </mesh>
  )
}

export default function ParticleBackground() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 0,
      pointerEvents: 'none',
      opacity: 0.85,
    }}>
      <Canvas
        camera={{ position: [0, 0, 1], fov: 90 }}
        dpr={[1, 1]}
        gl={{ antialias: false, alpha: false, powerPreference: 'low-power' }}
      >
        <GradientMesh />
      </Canvas>
    </div>
  )
}
