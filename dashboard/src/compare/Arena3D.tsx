/**
 * The compare arena (spec M7): up to three houses on one shared stage, each on a plot
 * in its entity color and sized by median price / U.S. median (0.6–1.6×, the same
 * scale as the dossier), with the camera orbiting slowly (still under reduced motion
 * or paused media). Decorative: the legend under the canvas names each house and its
 * figures. Lazy-loaded; shares three/fiber with the dossier's house.
 */
import { ContactShadows } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { HouseMesh } from '../dossier/houseMesh';

export interface ArenaHouse {
  slug: string;
  scale: number;
  color: [number, number, number];
}

interface Arena3DProps {
  houses: readonly ArenaHouse[];
  dark: boolean;
  animate: boolean;
  onReady?: () => void;
}

const rgb = ([r, g, b]: [number, number, number]) => new THREE.Color(r / 255, g / 255, b / 255);
/** Slot positions along x for 1, 2 or 3 houses (the legend below uses the same thirds). */
const SLOTS: Record<number, number[]> = { 1: [0], 2: [-5.6, 5.6], 3: [-9.6, 0, 9.6] };

function Stage({ houses, dark, animate }: Arena3DProps) {
  const orbit = useRef(0);
  const { camera, size } = useThree();
  const glow = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,.3)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  // Fit the row of houses in the width on narrow canvases.
  const aspect = size.width / Math.max(1, size.height);
  const zoom = Math.min(1, aspect / 2.2);
  if ((camera as THREE.PerspectiveCamera).zoom !== zoom) {
    (camera as THREE.PerspectiveCamera).zoom = zoom;
    camera.updateProjectionMatrix();
  }
  useFrame((_, dt) => {
    // A slow, shallow orbit (±14°) so the trio stays readable left to right.
    if (animate) orbit.current += dt * 0.25;
    const a = Math.sin(orbit.current) * 0.25;
    const R = 33;
    camera.position.set(Math.sin(a) * R, 12, Math.cos(a) * R);
    camera.lookAt(0, 1.4, 0);
  });
  const xs = SLOTS[houses.length] ?? SLOTS[3]!;
  return (
    <>
      <ambientLight intensity={dark ? 0.3 : 0.6} />
      <hemisphereLight args={[dark ? '#4A5578' : '#FFFFFF', dark ? '#05070D' : '#D9D3C6', 0.5]} />
      <directionalLight position={[-6, 10, 8]} intensity={dark ? 1.2 : 1.5} color={dark ? '#DDE6FF' : '#FFF8EE'} />
      {/* the shared stage */}
      <mesh position={[0, -0.32, 0]} receiveShadow>
        <cylinderGeometry args={[14.4, 14.7, 0.3, 72]} />
        <meshStandardMaterial color={dark ? '#0C1224' : '#E7E3DA'} roughness={0.9} />
      </mesh>
      {houses.map((h, i) => {
        const color = rgb(h.color);
        return (
          <group key={h.slug} position={[xs[i] ?? 0, 0, 0]}>
            <pointLight position={[2.5, 3, 4]} intensity={dark ? 16 : 7} distance={12} color={color} />
            <mesh position={[0, -0.15, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[3.2 * h.scale, 48]} />
              <meshBasicMaterial map={glow} color={color} transparent opacity={dark ? 0.55 : 0.4} depthWrite={false} toneMapped={false} />
            </mesh>
            <group scale={h.scale}>
              <HouseMesh dark={dark} windowGlow={dark ? 1.6 : 0.4} />
              <mesh position={[0, -0.08, 0.15]}>
                <boxGeometry args={[5.4, 0.16, 4.2]} />
                <meshStandardMaterial color={color} roughness={0.7} />
              </mesh>
            </group>
          </group>
        );
      })}
      <ContactShadows position={[0, -0.16, 0]} opacity={dark ? 0.55 : 0.3} scale={36} blur={2.4} far={4} />
    </>
  );
}

export default function Arena3D(props: Arena3DProps) {
  return (
    <Canvas data-testid="arena-canvas" aria-hidden="true" dpr={[1, 2]} camera={{ position: [0, 10.5, 26], fov: 30 }} gl={{ antialias: true, alpha: true }} frameloop={props.animate ? 'always' : 'demand'} onCreated={() => props.onReady?.()}>
      <Stage {...props} />
    </Canvas>
  );
}
