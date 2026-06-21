/**
 * maze.js
 * --------
 * Grid maze generation + spatial queries, deliberately free of Three.js so it
 * can be unit-tested and so occlusion/collision scale to any map size via grid
 * lookups (O(path length)) rather than looping hundreds of wall AABBs.
 *
 * Representation: a "wall grid" of (cols*2+1) x (rows*2+1) cells. Passage cells
 * sit at odd indices; walls are carved between them (recursive backtracker), then
 * lightly braided (some interior walls removed) to add loops / alternate routes.
 * A braided maze stays fully connected, so every open cell is reachable.
 */

export const DEFAULT_CELL = 5; // world units per grid cell

export function generateMaze(cols, rows, rng = Math.random, opts = {}) {
  const cell = opts.cell ?? DEFAULT_CELL;
  const braid = opts.braid ?? 0.18; // fraction of interior walls to remove

  const gw = cols * 2 + 1;
  const gh = rows * 2 + 1;
  const solid = Array.from({ length: gh }, () => new Array(gw).fill(true));

  // Carve a perfect maze with an iterative recursive backtracker.
  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const stack = [[0, 0]];
  visited[0][0] = true;
  solid[1][1] = false;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const nbrs = [];
    for (const [dc, dr] of dirs) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[nr][nc]) {
        nbrs.push([nc, nr, dc, dr]);
      }
    }
    if (nbrs.length === 0) {
      stack.pop();
      continue;
    }
    const [nc, nr, dc, dr] = nbrs[Math.floor(rng() * nbrs.length)];
    visited[nr][nc] = true;
    solid[r * 2 + 1 + dr][c * 2 + 1 + dc] = false; // wall between
    solid[nr * 2 + 1][nc * 2 + 1] = false; // the cell itself
    stack.push([nc, nr]);
  }

  // Braid: remove some interior walls to create loops & alternate routes.
  for (let gy = 1; gy < gh - 1; gy++) {
    for (let gx = 1; gx < gw - 1; gx++) {
      // Only wall-slots between two cells (exactly one of gx/gy odd) qualify.
      const oddX = gx % 2 === 1;
      const oddZ = gy % 2 === 1;
      if (oddX === oddZ) continue; // skip cells and pillar corners
      if (!solid[gy][gx]) continue;
      if (rng() < braid) solid[gy][gx] = false;
    }
  }

  const worldHalfW = (gw * cell) / 2;
  const worldHalfH = (gh * cell) / 2;

  const gxOf = (x) => Math.floor((x + worldHalfW) / cell);
  const gyOf = (z) => Math.floor((z + worldHalfH) / cell);
  const centerX = (gx) => (gx + 0.5) * cell - worldHalfW;
  const centerZ = (gy) => (gy + 0.5) * cell - worldHalfH;

  const isSolidCell = (gx, gy) => {
    if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) return true;
    return solid[gy][gx];
  };
  const isSolidWorld = (x, z) => isSolidCell(gxOf(x), gyOf(z));

  // Amanatides–Woo grid traversal: is a solid cell strictly between A and B?
  const segmentBlocked = (ax, az, bx, bz) => {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-9) return false;
    const dirx = dx / dist;
    const dirz = dz / dist;
    let gx = gxOf(ax);
    let gy = gyOf(az);
    const gxB = gxOf(bx);
    const gyB = gyOf(bz);
    const stepX = dirx > 0 ? 1 : dirx < 0 ? -1 : 0;
    const stepZ = dirz > 0 ? 1 : dirz < 0 ? -1 : 0;
    const nbX = (gx + (stepX > 0 ? 1 : 0)) * cell - worldHalfW;
    const nbZ = (gy + (stepZ > 0 ? 1 : 0)) * cell - worldHalfH;
    let tMaxX = dirx !== 0 ? (nbX - ax) / dirx : Infinity;
    let tMaxZ = dirz !== 0 ? (nbZ - az) / dirz : Infinity;
    const tDeltaX = dirx !== 0 ? Math.abs(cell / dirx) : Infinity;
    const tDeltaZ = dirz !== 0 ? Math.abs(cell / dirz) : Infinity;
    let guard = 0;
    while (!(gx === gxB && gy === gyB)) {
      if (tMaxX < tMaxZ) {
        gx += stepX;
        tMaxX += tDeltaX;
      } else {
        gy += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (isSolidCell(gx, gy)) return true; // hit a wall (or left the maze)
      if (++guard > 100000) break;
    }
    return false; // reached B's cell with clear line of sight
  };

  // World-space centres of all open (walkable) cells.
  const openCellsWorld = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!solid[gy][gx]) openCellsWorld.push({ x: centerX(gx), z: centerZ(gy), gx, gy });
    }
  }

  return {
    cols,
    rows,
    gw,
    gh,
    cell,
    solid,
    worldHalfW,
    worldHalfH,
    gxOf,
    gyOf,
    centerX,
    centerZ,
    isSolidCell,
    isSolidWorld,
    segmentBlocked,
    openCellsWorld,
  };
}

/**
 * BFS over open cells (4-neighbour) — returns true if EVERY open cell is
 * reachable from the first one. Used to assert the maze guarantees reachability.
 */
export function allOpenReachable(maze) {
  const { gw, gh, solid } = maze;
  let total = 0;
  let start = null;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!solid[gy][gx]) {
        total++;
        if (!start) start = [gx, gy];
      }
    }
  }
  if (!start) return false;

  const seen = new Set();
  const key = (gx, gy) => gy * gw + gx;
  const queue = [start];
  seen.add(key(start[0], start[1]));
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length) {
    const [gx, gy] = queue.pop();
    for (const [dc, dr] of dirs) {
      const nx = gx + dc;
      const ny = gy + dr;
      if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
      if (solid[ny][nx]) continue;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen.size === total;
}
