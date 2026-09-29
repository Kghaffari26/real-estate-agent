/**
 * The dossier's 3D house (spec M5): a procedural low-poly house on a small plot, lit
 * by the market temperature (cold blue rim for a cold market, warm amber for a hot
 * one) and scaled by median price / U.S. median. Night: dark glass walls with glowing
 * windows; Dawn: matte clay. Slow auto-rotation (off under reduced motion or paused
 * media), drag to turn. An optional wireframe "ghost" shows another scale (the
 * affordability studio's year-ago house). Decorative: the page states every number.
 * Lazy-loaded (three + fiber + drei).
 */
import { ContactShadows, PresentationControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { HouseMesh } from './houseMesh';

export interface House3DProps {
  /** Target scale (house = price / U.S. median, clamped); animated with a spring. */
  scale: number;
  /** Rim light color and how strongly the market leans cold/hot (0–1). */
  rim: [number, number, number];
  lean: number;
  dark: boolean;
  animate: boolean;
  /** A wireframe comparison house at this scale (e.g. a year ago). */
  ghostScale?: number | null;
  onReady?: () => void;
  /** Max device pixel ratio (quality tier). */
  dpr?: number;
}

const rgb = ([r, g, b]: [number, number, number]) => new THREE.Color(r / 255, g / 255, b / 255);

function Scene({ scale, rim, lean, dark, animate, ghostScale, onReady }: House3DProps) {
  const group = useRef<THREE.Group>(null);
  const ghostRef = useRef<THREE.Group>(null);
  const velocity = useRef(0);
  const current = useRef(scale);
  const ready = useRef(false);
  const rimColor = useMemo(() => rgb(rim), [rim]);
  // The camera frames by height; on narrow (phone) canvases zoom out so the width fits too.
  const { camera, size } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  const zoom = Math.min(1, aspect / 1.15);
  if ((camera as THREE.PerspectiveCamera).zoom !== zoom) {
    (camera as THREE.PerspectiveCamera).zoom = zoom;
    camera.updateProjectionMatrix();
  }
  const glowTexture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // Critically damped-ish spring toward the target scale (stiffness ~260, damping ~30).
    if (animate) {
      const force = (scale - current.current) * 260 - velocity.current * 30;
      velocity.current += force * Math.min(dt, 0.05);
      current.current += velocity.current * Math.min(dt, 0.05);
    } else current.current = scale;
    g.scale.setScalar(current.current);
    if (animate) g.rotation.y += dt * 0.18;
    if (ghostRef.current) ghostRef.current.rotation.y = g.rotation.y;
    if (!ready.current) {
      ready.current = true;
      onReady?.();
    }
  });

  return (
    <>
      <ambientLight intensity={dark ? 0.25 : 0.55} />
      <hemisphereLight args={[dark ? '#4A5578' : '#FFFFFF', dark ? '#05070D' : '#D9D3C6', dark ? 0.45 : 0.45]} />
      {/* soft neutral light from above-left keeps the form readable in any temperature */}
      <directionalLight position={[-5, 8, 3]} intensity={dark ? 0.7 : 1.1} color={dark ? '#C9D4F0' : '#FFF8EE'} castShadow />
      {/* the market's temperature: the key light on the two faces the camera sees */}
      <directionalLight position={[6, 3.2, 5]} intensity={(dark ? 1.4 : 1.0) + (dark ? 2.2 : 1.4) * lean} color={rimColor} />
      <pointLight position={[4.5, 1.6, 4]} intensity={(dark ? 20 : 8) * (0.35 + lean)} distance={12} color={rimColor} />
      {/* a thin rim from behind to separate the roofline from the plate */}
      <directionalLight position={[-6, 4, -6]} intensity={0.6 + 1.8 * lean} color={rimColor} />
      <PresentationControls global={false} cursor snap={false} polar={[-0.12, 0.25]} azimuth={[-Infinity, Infinity]} speed={1.4}>
        <group position={[0, -0.9, 0]}>
          {ghostScale != null && (
            <group ref={ghostRef} scale={ghostScale}>
              <HouseMesh dark={dark} ghost windowGlow={0} />
            </group>
          )}
          <group ref={group}>
            <HouseMesh dark={dark} windowGlow={dark ? 1.9 : 0.6} />
            {/* the plot */}
            <mesh position={[0, -0.08, 0.15]} receiveShadow>
              <boxGeometry args={[5.6, 0.16, 4.3]} />
              <meshStandardMaterial color={dark ? '#0E1528' : '#E6E1D6'} roughness={0.95} />
            </mesh>
            <mesh position={[0, 0.005, 1.9]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.7, 1.0]} />
              <meshStandardMaterial color={dark ? '#1A233B' : '#D8D2C6'} roughness={1} />
            </mesh>
          </group>
          {/* a pool of the market's light on the ground: the temperature at a glance */}
          <mesh position={[0, -0.2, 0.1]} rotation={[-Math.PI / 2, 0, 0]} scale={scale}>
            {/* ≤ 3.4 × 1.6 ≈ 5.4 units: stays inside the frame even for the largest house */}
            <circleGeometry args={[3.4, 48]} />
            <meshBasicMaterial map={glowTexture} color={rimColor} transparent opacity={(dark ? 0.35 : 0.22) + 0.45 * lean} depthWrite={false} toneMapped={false} />
          </mesh>
          <ContactShadows position={[0, -0.17, 0]} opacity={dark ? 0.6 : 0.35} scale={12} blur={2.6} far={3} color={dark ? '#000000' : '#2A2620'} />
        </group>
      </PresentationControls>
    </>
  );
}

export default function House3D(props: House3DProps) {
  return (
    <Canvas
      data-testid="house-canvas"
      aria-hidden="true"
      dpr={[1, props.dpr ?? 2]}
      // Framed for the largest house (1.6×) with room for its glow.
      camera={{ position: [11.2, 7.2, 12.4], fov: 30 }}
      onCreated={({ camera }) => camera.lookAt(0, 0.4, 0)}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      frameloop={props.animate ? 'always' : 'demand'}
      shadows
      style={{ touchAction: 'pan-y' }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
