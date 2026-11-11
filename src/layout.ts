// Room-aware layout: reads the table and walls from scene understanding and
// returns a frame for each surface the brief uses, with fallbacks for rooms
// that have no table or no wall in reach.
import { Box3, Matrix4, Object3D, Quaternion, Vector3 } from '@iwsdk/core';

export type SurfaceKind = 'table' | 'facing-wall' | 'side-wall' | 'tray' | 'curved' | 'free';

/** A surface frame: +Z is the side the content faces, +Y is "up" on the content. */
export interface Frame {
  kind: SurfaceKind;
  origin: Vector3;
  quat: Quaternion;
  halfW: number;
  halfH: number;
  source: string;
}

export interface Detected {
  planes: { obj: Object3D; label: string; orientation: string; polygon: { x: number; z: number }[] }[];
  meshes: { obj: Object3D; label: string }[];
}

export interface RoomLayout {
  table: Frame;
  facing: Frame;
  side: Frame;
  head: Vector3;
  forward: Vector3;
  report: {
    planes: number;
    meshes: number;
    labels: Record<string, number>;
    table: string;
    facingWall: string;
    sideWall: string;
    tableDistance: number | null;
    facingWallDistance: number | null;
    sideWallDistance: number | null;
    tables: { center: number[]; hw: number; hd: number; axisX: number[]; edge: number; source: string }[];
  };
}

const UP = new Vector3(0, 1, 0);
/** A table counts as the desk when its near edge is this close (horizontal metres). */
export const REACH_M = 0.8;
const tmpM = new Matrix4();

function frameFrom(kind: SurfaceKind, origin: Vector3, normal: Vector3, up: Vector3, halfW: number, halfH: number, source: string): Frame {
  const z = normal.clone().normalize();
  const y = up.clone().sub(z.clone().multiplyScalar(up.dot(z))).normalize();
  const x = new Vector3().crossVectors(y, z).normalize();
  tmpM.makeBasis(x, y, z);
  return { kind, origin: origin.clone(), quat: new Quaternion().setFromRotationMatrix(tmpM), halfW, halfH, source };
}

export function placeIn(frame: Frame, offset: [number, number, number], outPos: Vector3, outQuat: Quaternion): void {
  outPos.set(offset[0], offset[1], offset[2]).applyQuaternion(frame.quat).add(frame.origin);
  outQuat.copy(frame.quat);
}

export function offsetIn(frame: Frame, worldPos: Vector3): [number, number, number] {
  const v = worldPos.clone().sub(frame.origin).applyQuaternion(frame.quat.clone().invert());
  return [v.x, v.y, v.z];
}

function polyExtent(poly: { x: number; z: number }[]): { cx: number; cz: number; hw: number; hd: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX)) return { cx: 0, cz: 0, hw: 0.5, hd: 0.5 };
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, hw: (maxX - minX) / 2, hd: (maxZ - minZ) / 2 };
}

interface TableCand { top: Vector3; hw: number; hd: number; axisX: Vector3; source: string; dist: number; edge: number }
interface WallCand { center: Vector3; normal: Vector3; right: Vector3; hw: number; hh: number; source: string }

export function computeLayout(det: Detected, head: Vector3, headForward: Vector3): RoomLayout {
  const labels: Record<string, number> = {};
  const fwd = headForward.clone().setY(0);
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();

  // Tables: labelled planes first, then labelled bounded meshes.
  const tables: TableCand[] = [];
  const walls: WallCand[] = [];
  const q = new Quaternion();
  const pos = new Vector3();
  for (const p of det.planes) {
    const label = (p.label || p.orientation || 'unlabeled').toLowerCase();
    labels[`plane:${label}`] = (labels[`plane:${label}`] ?? 0) + 1;
    p.obj.updateWorldMatrix(true, false);
    p.obj.matrixWorld.decompose(pos, q, new Vector3());
    const normal = UP.clone().applyQuaternion(q);
    const ext = polyExtent(p.polygon);
    const center = new Vector3(ext.cx, 0, ext.cz).applyMatrix4(p.obj.matrixWorld);
    if (label.includes('table') || label.includes('desk')) {
      tables.push({
        top: center,
        hw: ext.hw,
        hd: ext.hd,
        axisX: new Vector3(1, 0, 0).applyQuaternion(q),
        source: `plane:${label}`,
        dist: Math.hypot(center.x - head.x, center.z - head.z),
        edge: 0,
      });
    } else if (label.includes('wall') || (p.orientation === 'vertical' && !/door|window/.test(label))) {
      if (Math.abs(normal.y) > 0.3) continue;
      const n = normal.clone().setY(0).normalize();
      if (n.dot(head.clone().sub(center)) < 0) n.negate();
      walls.push({
        center,
        normal: n,
        right: new Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize(),
        hw: ext.hw,
        hh: ext.hd,
        source: `plane:${label}`,
      });
    }
  }
  if (tables.length === 0) {
    for (const m of det.meshes) {
      const label = (m.label || 'unlabeled').toLowerCase();
      labels[`mesh:${label}`] = (labels[`mesh:${label}`] ?? 0) + 1;
      if (!label.includes('table') && !label.includes('desk')) continue;
      const box = new Box3().setFromObject(m.obj);
      if (box.isEmpty()) continue;
      const c = box.getCenter(new Vector3());
      const top = new Vector3(c.x, box.max.y, c.z);
      tables.push({
        top,
        hw: (box.max.x - box.min.x) / 2,
        hd: (box.max.z - box.min.z) / 2,
        axisX: new Vector3(1, 0, 0),
        source: `mesh:${label}`,
        dist: Math.hypot(top.x - head.x, top.z - head.z),
        edge: 0,
      });
    }
  } else {
    for (const m of det.meshes) {
      const label = (m.label || 'unlabeled').toLowerCase();
      labels[`mesh:${label}`] = (labels[`mesh:${label}`] ?? 0) + 1;
    }
  }

  // The desk: the nearest table at desk height whose near edge is within a seated arm's reach.
  for (const t of tables) {
    const a = t.top.clone().sub(head).setY(0);
    if (a.lengthSq() < 1e-6) a.copy(fwd);
    a.normalize();
    const ax = t.axisX.clone().setY(0).normalize();
    const az = new Vector3(-ax.z, 0, ax.x);
    t.edge = t.dist - (Math.abs(a.dot(ax)) * t.hw + Math.abs(a.dot(az)) * t.hd);
  }
  const usable = tables
    .filter((t) => t.top.y > 0.35 && t.top.y < 1.15 && t.edge < REACH_M)
    .sort((a, b) => a.edge - b.edge);
  let table: Frame;
  let tableDistance: number | null = null;
  if (usable.length) {
    const t = usable[0];
    tableDistance = Math.max(0, t.edge);
    // Content faces up; content "up" points away from the user, across the desk.
    const away = t.top.clone().sub(head).setY(0);
    if (away.lengthSq() < 1e-4) away.copy(fwd);
    away.normalize();
    // Anchor tiles along the edge nearest the user, inside the table outline.
    const ax2 = t.axisX.clone().setY(0).normalize();
    const span = Math.abs(away.dot(ax2)) * t.hw + Math.abs(away.dot(new Vector3(-ax2.z, 0, ax2.x))) * t.hd;
    const nearEdge = t.top.clone().addScaledVector(away, -Math.max(0, span - 0.2));
    nearEdge.y = t.top.y + 0.004;
    table = frameFrom('table', nearEdge, UP, away, Math.max(t.hw, t.hd), Math.min(t.hw, t.hd), t.source);
    fwd.copy(away);
  } else {
    // No table: a tray at lap height, tilted toward the user.
    const origin = head.clone().addScaledVector(fwd, 0.42);
    origin.y = Math.max(0.55, head.y - 0.55);
    const normal = UP.clone().applyAxisAngle(new Vector3().crossVectors(fwd, UP).normalize(), (40 * Math.PI) / 180);
    table = frameFrom('tray', origin, normal, fwd.clone().add(new Vector3(0, 0.6, 0)), 0.35, 0.2, 'fallback:lap-tray');
  }

  // The facing wall: the first wall straight ahead along the line through the desk.
  let facing: Frame | null = null;
  let facingDistance: number | null = null;
  let best = Infinity;
  for (const w of walls) {
    const denom = fwd.dot(w.normal);
    if (denom > -0.5) continue;
    const t = w.center.clone().sub(head).dot(w.normal) / denom;
    if (t < 0.4 || t > 4.5 || t >= best) continue;
    const hit = head.clone().addScaledVector(fwd, t);
    const along = hit.clone().sub(w.center).dot(w.right);
    if (Math.abs(along) > w.hw + 0.25) continue;
    best = t;
    const origin = w.center.clone().addScaledVector(w.right, Math.max(-w.hw + 0.7, Math.min(w.hw - 0.7, along)));
    origin.y = Math.min(Math.max(head.y + 0.05, 1.1), 2.0);
    origin.addScaledVector(w.normal, 0.03);
    facing = frameFrom('facing-wall', origin, w.normal, UP, w.hw, w.hh, w.source);
    facingDistance = t;
  }
  if (!facing) {
    const origin = head.clone().addScaledVector(fwd, 1.2);
    origin.y = head.y - 0.05;
    facing = frameFrom('curved', origin, fwd.clone().negate(), UP, 0.7, 0.4, 'fallback:curved-1.2m');
  }

  // The side wall: the nearest wall roughly perpendicular to the view, within reach of a glance.
  let side: Frame | null = null;
  let sideDistance: number | null = null;
  let bestSide = Infinity;
  for (const w of walls) {
    if (Math.abs(fwd.dot(w.normal)) > 0.5) continue;
    const d = head.clone().sub(w.center).dot(w.normal);
    if (d < 0.3 || d > 3.5 || d >= bestSide) continue;
    const foot = head.clone().addScaledVector(w.normal, -d);
    let along = foot.clone().sub(w.center).dot(w.right) + w.right.dot(fwd) * 0.9;
    along = Math.max(-w.hw + 0.4, Math.min(w.hw - 0.4, along));
    const origin = w.center.clone().addScaledVector(w.right, along).addScaledVector(w.normal, 0.03);
    origin.y = Math.min(Math.max(head.y - 0.05, 1.0), 1.9);
    bestSide = d;
    side = frameFrom('side-wall', origin, w.normal, UP, w.hw, w.hh, w.source);
    sideDistance = d;
  }
  if (!side) {
    const right = new Vector3().crossVectors(fwd, UP).normalize();
    const origin = head.clone().addScaledVector(fwd, 0.85).addScaledVector(right, 0.85);
    origin.y = head.y - 0.1;
    const normal = head.clone().sub(origin).setY(0).normalize();
    side = frameFrom('free', origin, normal, UP, 0.4, 0.4, 'fallback:float-right');
  }

  return {
    table,
    facing,
    side,
    head: head.clone(),
    forward: fwd.clone(),
    report: {
      planes: det.planes.length,
      meshes: det.meshes.length,
      labels,
      table: table.source,
      facingWall: facing.source,
      sideWall: side.source,
      tableDistance: tableDistance === null ? null : Math.round(tableDistance * 100) / 100,
      facingWallDistance: facingDistance === null ? null : Math.round(facingDistance * 100) / 100,
      sideWallDistance: sideDistance === null ? null : Math.round(sideDistance * 100) / 100,
      tables: tables.map((t) => ({
        center: t.top.toArray().map((v) => Math.round(v * 1000) / 1000),
        hw: Math.round(t.hw * 1000) / 1000,
        hd: Math.round(t.hd * 1000) / 1000,
        axisX: t.axisX.toArray().map((v) => Math.round(v * 1000) / 1000),
        edge: Math.round(t.edge * 100) / 100,
        source: t.source,
      })),
    },
  };
}
