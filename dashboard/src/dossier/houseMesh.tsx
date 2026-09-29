/** The procedural low-poly house (walls, gable roof, chimney, door, windows), shared by the dossier, the studio and the compare arena. */
import { useMemo } from 'react';
import * as THREE from 'three';

function roofGeometry() {
  // A gable: a triangle (width across the house, rise) extruded along the ridge.
  const w = 2.9;
  const rise = 1.25;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 3.9, bevelEnabled: false });
  g.translate(0, 0, -3.9 / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

export function HouseMesh({ dark, ghost = false, windowGlow }: { dark: boolean; ghost?: boolean; windowGlow: number }) {
  const roof = useMemo(roofGeometry, []);
  const m = useMemo(() => {
    if (ghost) {
      // Drawn over the house (no depth test) so the year-ago outline shows whether it's smaller or larger.
      const line = new THREE.MeshBasicMaterial({ color: dark ? '#9FD0FF' : '#3A4458', wireframe: true, transparent: true, opacity: 0.32, depthTest: false });
      return { walls: line, roof: line, trim: line, window: line, door: line };
    }
    return dark
      ? {
          // Neutral slate so the temperature light, not the material, sets the color.
          walls: new THREE.MeshPhysicalMaterial({ color: '#5A6070', roughness: 0.45, metalness: 0.1, clearcoat: 0.45, clearcoatRoughness: 0.35 }),
          roof: new THREE.MeshStandardMaterial({ color: '#3C4252', roughness: 0.6, metalness: 0.1 }),
          trim: new THREE.MeshStandardMaterial({ color: '#2E3340', roughness: 0.6 }),
          window: new THREE.MeshStandardMaterial({ color: '#FFD9A0', emissive: new THREE.Color('#FFB86B'), emissiveIntensity: windowGlow, roughness: 0.2 }),
          door: new THREE.MeshStandardMaterial({ color: '#0B101F', roughness: 0.5 }),
        }
      : {
          walls: new THREE.MeshStandardMaterial({ color: '#F4F1EA', roughness: 0.92 }),
          roof: new THREE.MeshStandardMaterial({ color: '#E3DED3', roughness: 0.95 }),
          trim: new THREE.MeshStandardMaterial({ color: '#D6D0C4', roughness: 0.95 }),
          window: new THREE.MeshStandardMaterial({ color: '#8FA4C2', roughness: 0.2, metalness: 0.1 }),
          door: new THREE.MeshStandardMaterial({ color: '#5A5F6B', roughness: 0.7 }),
        };
  }, [dark, ghost, windowGlow]);

  const windows: Array<[number, number, number, number, number, number]> = [
    // x, y, z, w, h, rotY  (front face at z = 1.21, side face at x = 1.96)
    [-1.05, 1.15, 1.21, 0.7, 0.62, 0],
    [1.05, 1.15, 1.21, 0.7, 0.62, 0],
    [1.96, 1.15, -0.1, 1.2, 0.62, Math.PI / 2],
    [1.96, 2.25, 0, 0.42, 0.42, Math.PI / 2],
  ];
  return (
    <group>
      {/* walls */}
      <mesh material={m.walls} position={[0, 0.95, 0]} castShadow>
        <boxGeometry args={[3.9, 1.9, 2.4]} />
      </mesh>
      {/* roof with a small overhang */}
      <mesh geometry={roof} material={m.roof} position={[0, 1.9, 0]} scale={[1.06, 1, 1.02]} castShadow />
      {/* chimney */}
      <mesh material={m.trim} position={[-0.9, 2.55, -0.55]} castShadow>
        <boxGeometry args={[0.36, 1.1, 0.36]} />
      </mesh>
      {/* door and step */}
      <mesh material={m.door} position={[0, 0.62, 1.205]}>
        <planeGeometry args={[0.52, 1.1]} />
      </mesh>
      <mesh material={m.trim} position={[0, 0.03, 1.45]}>
        <boxGeometry args={[0.9, 0.06, 0.45]} />
      </mesh>
      {windows.map(([x, y, z, w, h, r], i) => (
        <mesh key={i} material={m.window} position={[x, y, z]} rotation={[0, r, 0]}>
          <planeGeometry args={[w, h]} />
        </mesh>
      ))}
    </group>
  );
}
