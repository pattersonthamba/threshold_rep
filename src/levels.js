import { World, AIR, PANEL, METAL, GLASS, GOO } from './world.js';

// Yaw values for spawn facing. Forward = (-sin(yaw), 0, -cos(yaw)).
const FACE = { px: -Math.PI / 2, nx: Math.PI / 2, pz: Math.PI, nz: 0 };

class Builder {
  constructor(w, h, d) {
    this.world = new World(w, h, d);
    this.spawn = null;
    this.cubes = [];
    this.buttons = [];
    this.doors = [];
    this.fields = [];
    this.exits = [];
    this.pads = [];
  }

  // Inclusive cell box.
  fill(x0, y0, z0, x1, y1, z1, t) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.world.set(x, y, z, t);
    return this;
  }

  // Hollow box: boundary cells become `t`, interior becomes air.
  shell(x0, y0, z0, x1, y1, z1, t = METAL) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
          this.world.set(x, y, z, edge ? t : AIR);
        }
    return this;
  }

  // x/z are the centre of the body, y is the feet.
  player(x, y, z, yaw) { this.spawn = { pos: [x, y, z], yaw }; return this; }
  cube(x, y, z) { this.cubes.push([x, y, z]); return this; }
  button(x, y, z, id) { this.buttons.push({ cell: [x, y, z], id }); return this; }
  exit(x, y, z) { this.exits.push({ cell: [x, y, z] }); return this; }
  pad(x, y, z, vx, vy, vz) { this.pads.push({ cell: [x, y, z], vel: [vx, vy, vz] }); return this; }

  door(x0, y0, z0, x1, y1, z1, ids) {
    const cells = [];
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          this.world.set(x, y, z, AIR);
          cells.push([x, y, z]);
        }
    this.doors.push({ cells, ids });
    return this;
  }

  field(x0, y0, z0, x1, y1, z1) {
    this.fill(x0, y0, z0, x1, y1, z1, AIR);
    this.fields.push({ min: [x0, y0, z0], max: [x1, y1, z1] });
    return this;
  }
}

export const LEVELS = [
  {
    name: 'Calibration',
    lines: [
      'You are awake. Good. This is the Threshold Lattice, and I am MERIDIAN, its custodian.',
      'Your emitter opens two linked gates. Left trigger for the first, right trigger for the second.',
      'Gates only hold on pale panels. The dark alloy refuses them. Reach the beacon.',
    ],
    build() {
      const b = new Builder(13, 8, 9);
      b.shell(0, 0, 0, 12, 7, 8, METAL);
      b.fill(8, 1, 1, 11, 3, 7, METAL); // ledge, top at y=4
      b.fill(12, 4, 1, 12, 6, 7, PANEL); // wall above ledge
      b.fill(0, 1, 1, 0, 3, 7, PANEL); // wall behind spawn
      b.fill(3, 0, 3, 5, 0, 5, PANEL);
      b.player(2.5, 1, 4.5, FACE.px);
      b.exit(10, 4, 4);
      return b;
    },
  },
  {
    name: 'Counterweight',
    lines: [
      'The lattice rewards those who carry things. Press E to lift a mass core.',
      'Gates are courteous. Hold something as you pass through and it comes along.',
    ],
    build() {
      const b = new Builder(15, 8, 14);
      b.shell(0, 0, 0, 14, 7, 10, METAL);
      b.fill(10, 1, 1, 13, 3, 9, METAL);
      b.fill(14, 4, 1, 14, 6, 9, PANEL);
      b.fill(0, 1, 1, 0, 3, 9, PANEL);
      b.shell(5, 0, 10, 7, 3, 13, METAL);
      b.door(6, 1, 10, 6, 2, 10, ['a']);
      b.button(4, 1, 3, 'a');
      b.cube(11.5, 4, 5.5);
      b.player(3.5, 1, 6.5, FACE.px);
      b.exit(6, 1, 12);
      return b;
    },
  },
  {
    name: 'Static Veil',
    lines: [
      'That shimmering curtain is a veil. It erases your gates and unmakes anything you carry.',
      'You may pass through it. Your luggage may not. Route around it.',
    ],
    build() {
      const b = new Builder(21, 9, 13);
      b.shell(0, 0, 0, 16, 8, 12, METAL);
      b.fill(1, 1, 6, 15, 7, 6, METAL); // divider
      b.fill(7, 5, 6, 8, 7, 6, GLASS);
      b.field(7, 1, 6, 8, 3, 6);
      b.fill(6, 1, 0, 9, 4, 0, PANEL); // south wall, visible through the veil
      b.fill(2, 1, 12, 14, 4, 12, PANEL); // north wall
      b.shell(16, 0, 2, 20, 3, 4, METAL);
      b.door(16, 1, 3, 16, 2, 3, ['a']);
      b.button(3, 1, 3, 'a');
      b.cube(12.5, 1, 9.5);
      b.player(4.5, 1, 2.5, FACE.pz);
      b.exit(19, 1, 3);
      return b;
    },
  },
  {
    name: 'Momentum',
    lines: [
      'Speed survives a gate. Direction is negotiable.',
      'Fall far enough and a wall becomes a cannon. Press R if you need to start over.',
    ],
    build() {
      const b = new Builder(22, 14, 9);
      b.shell(0, 0, 0, 21, 13, 8, METAL);
      b.fill(1, 1, 1, 6, 8, 3, METAL); // tower, top at y=9
      b.fill(1, 0, 5, 6, 0, 7, PANEL); // drop zone
      b.fill(0, 1, 4, 0, 10, 7, PANEL); // launch wall
      b.fill(8, 0, 1, 12, 0, 7, GOO);
      b.player(3.5, 9, 2.5, FACE.pz);
      b.exit(18, 1, 5);
      return b;
    },
  },
  {
    name: 'Updraft',
    lines: [
      'The launch plate only throws upward. Upward is just a direction.',
      'Redirect it.',
    ],
    build() {
      const b = new Builder(21, 9, 9);
      b.shell(0, 0, 0, 20, 8, 8, METAL);
      b.fill(1, 8, 3, 3, 8, 5, PANEL); // ceiling above the plate
      b.fill(0, 4, 1, 0, 6, 7, PANEL); // high west wall
      b.fill(4, 0, 1, 9, 0, 7, GOO);
      b.pad(2, 1, 4, 0, 24, 0);
      b.player(1.5, 1, 6.5, FACE.px);
      b.exit(16, 1, 4);
      return b;
    },
  },
  {
    name: 'Convergence',
    lines: [
      'Midpoint review. Everything you have learned, plus a mass core you must not lose.',
      'I have prepared nothing celebratory for your progress. Please do not ask.',
    ],
    build() {
      const b = new Builder(24, 14, 12);
      b.shell(0, 0, 0, 23, 13, 8, METAL);
      b.fill(1, 1, 1, 6, 8, 3, METAL);
      b.fill(1, 0, 5, 6, 0, 7, PANEL);
      b.fill(0, 1, 4, 0, 10, 7, PANEL);
      b.fill(8, 0, 1, 13, 0, 7, GOO);
      b.shell(19, 0, 8, 21, 3, 11, METAL);
      b.door(20, 1, 8, 20, 2, 8, ['a']);
      b.button(18, 1, 2, 'a');
      b.cube(5, 9, 2);
      b.player(3, 9, 2.5, FACE.pz);
      b.exit(20, 1, 10);
      return b;
    },
  },
  {
    name: 'Twin Keys',
    lines: [
      'Two plates, one door. The door is greedy and wants both.',
      'A gate can be moved from wherever you stand, even somewhere awkward.',
    ],
    build() {
      const b = new Builder(21, 8, 13);
      b.shell(0, 0, 0, 16, 7, 12, METAL);
      b.fill(10, 1, 7, 10, 2, 11, GLASS); // alcove walls, open above
      b.fill(10, 1, 7, 15, 2, 7, GLASS);
      b.fill(11, 1, 12, 15, 5, 12, PANEL); // alcove back wall
      b.fill(0, 1, 1, 0, 3, 11, PANEL);
      b.shell(16, 0, 2, 20, 3, 4, METAL);
      b.door(16, 1, 3, 16, 2, 3, ['a', 'b']);
      b.button(4, 1, 9, 'a');
      b.button(8, 1, 3, 'b');
      b.cube(3.5, 1, 3.5);
      b.cube(13.5, 1, 9.5);
      b.player(5.5, 1, 5.5, FACE.pz);
      b.exit(19, 1, 3);
      return b;
    },
  },
  {
    name: 'Delivery',
    lines: [
      'That plate sits on an island you cannot reach. The core can.',
      'Gravity is free. Spend it.',
    ],
    build() {
      const b = new Builder(17, 9, 12);
      b.shell(0, 0, 0, 16, 8, 8, METAL);
      b.fill(5, 0, 1, 15, 0, 7, GOO);
      b.fill(10, 0, 3, 12, 0, 5, METAL); // island
      b.fill(11, 8, 4, 11, 8, 5, PANEL); // gate-sized strip over the plates
      b.fill(1, 0, 3, 3, 0, 6, PANEL);
      b.shell(1, 0, 8, 3, 3, 11, METAL);
      b.door(2, 1, 8, 2, 2, 8, ['a']);
      b.button(11, 1, 4, 'a');
      b.button(11, 1, 5, 'a');
      b.cube(3.5, 1, 1.5);
      b.player(3.5, 1, 6.5, FACE.px);
      b.exit(2, 1, 10);
      return b;
    },
  },
  {
    name: 'Periscope',
    lines: [
      'Some rooms can only be seen from above.',
      'A shot fired into one gate leaves through the other. Aim accordingly.',
    ],
    build() {
      const b = new Builder(26, 13, 9);
      b.shell(0, 0, 0, 25, 12, 8, METAL);
      b.fill(15, 1, 1, 15, 9, 7, METAL); // divider, gap above y=10
      b.fill(0, 1, 1, 0, 3, 3, PANEL);
      b.fill(0, 9, 5, 0, 10, 7, PANEL);
      b.fill(25, 8, 1, 25, 11, 7, PANEL);
      b.player(7.5, 1, 4.5, FACE.nx);
      b.exit(20, 1, 4);
      return b;
    },
  },
  {
    name: 'Sluice',
    lines: [
      'A veil on one side, a hazard pool on the other. I designed this one on a bad day.',
    ],
    build() {
      const b = new Builder(19, 9, 16);
      b.shell(0, 0, 0, 18, 8, 12, METAL);
      b.fill(1, 1, 6, 17, 7, 6, METAL);
      b.field(2, 1, 6, 3, 3, 6);
      b.fill(8, 1, 12, 16, 3, 12, PANEL); // north wall
      b.fill(1, 1, 0, 4, 3, 0, PANEL); // south wall, seen through the veil
      b.fill(1, 0, 2, 5, 0, 4, PANEL); // south floor
      b.fill(7, 0, 1, 17, 0, 5, GOO);
      b.fill(12, 0, 2, 14, 0, 4, METAL);
      b.fill(12, 8, 2, 14, 8, 4, PANEL);
      b.shell(4, 0, 12, 6, 3, 15, METAL);
      b.door(5, 1, 12, 5, 2, 12, ['a']);
      b.button(13, 1, 3, 'a');
      b.cube(14.5, 1, 9.5);
      b.player(5.5, 1, 1.5, FACE.pz);
      b.exit(5, 1, 14);
      return b;
    },
  },
  {
    name: 'Terminal Velocity',
    lines: [
      'A floor gate beneath a ceiling gate makes a very long fall.',
      'Move one of them mid-plunge. I would like to see what happens.',
    ],
    build() {
      const b = new Builder(34, 16, 9);
      b.shell(0, 0, 0, 33, 15, 8, METAL);
      b.fill(1, 0, 2, 4, 0, 6, PANEL);
      b.fill(1, 15, 2, 4, 15, 6, PANEL);
      b.fill(0, 1, 2, 0, 12, 6, PANEL);
      b.fill(6, 0, 1, 26, 0, 7, GOO);
      b.player(2.5, 1, 4.5, FACE.px);
      b.exit(30, 1, 4);
      return b;
    },
  },
  {
    name: 'Keystone',
    lines: [
      'Final arrangement. A sealed room, a core inside it, and a door out here that wants it back.',
    ],
    build() {
      const b = new Builder(26, 13, 12);
      b.shell(0, 0, 0, 25, 12, 8, METAL);
      b.fill(15, 1, 1, 15, 9, 7, METAL);
      b.fill(0, 1, 1, 0, 3, 3, PANEL);
      b.fill(0, 9, 5, 0, 10, 7, PANEL);
      b.fill(25, 1, 1, 25, 11, 7, PANEL);
      b.shell(9, 0, 8, 11, 3, 11, METAL);
      b.door(10, 1, 8, 10, 2, 8, ['a']);
      b.button(8, 1, 4, 'a');
      b.cube(20.5, 1, 4.5);
      b.player(7.5, 1, 4.5, FACE.nx);
      b.exit(10, 1, 10);
      return b;
    },
  },
  {
    name: 'Mail Slot',
    lines: [
      'The plate is behind a slot built for cores, not for you.',
      'Cores keep their momentum too. Send it alone. If you follow it, you stay there.',
    ],
    build() {
      const b = new Builder(28, 14, 14);
      b.shell(0, 0, 0, 27, 13, 10, METAL);
      b.fill(1, 1, 1, 6, 10, 4, METAL); // tower, top at y=11
      b.fill(1, 0, 5, 6, 0, 9, PANEL); // drop zone
      b.fill(0, 1, 5, 0, 10, 9, PANEL); // launch wall
      b.fill(8, 0, 1, 16, 0, 9, GOO);
      b.fill(22, 2, 1, 26, 12, 9, METAL); // far block; the y=1 row stays open as a duct
      for (let z = 1; z <= 9; z++) b.button(26, 1, z, 'a');
      b.shell(3, 0, 10, 5, 3, 13, METAL);
      b.door(4, 1, 10, 4, 2, 10, ['a']);
      b.cube(4.5, 11, 3);
      b.player(2.5, 11, 2.5, FACE.pz);
      b.exit(4, 1, 12);
      return b;
    },
  },
  {
    name: 'Freefall Courier',
    lines: [
      'Two plates. One is across the pool. The other sits at the end of a slot on this side.',
      'You cannot reach into the slot, and you cannot swim. Plan the return trip before you leave.',
    ],
    build() {
      const b = new Builder(37, 16, 12);
      b.shell(0, 0, 0, 36, 15, 8, METAL);
      b.fill(1, 1, 1, 3, 14, 7, METAL); // west block
      b.fill(1, 1, 1, 3, 1, 1, AIR); // duct into the block
      b.button(1, 1, 1, 'b');
      b.fill(3, 1, 2, 3, 12, 6, PANEL); // launch face
      b.fill(4, 0, 2, 7, 0, 6, PANEL); // shaft floor
      b.fill(4, 15, 2, 7, 15, 6, PANEL); // shaft ceiling
      b.fill(9, 0, 1, 29, 0, 7, GOO);
      b.pad(31, 1, 1, -18, 14, 0);
      b.button(34, 1, 5, 'a');
      b.shell(32, 0, 8, 34, 3, 11, METAL);
      b.door(33, 1, 8, 33, 2, 8, ['a', 'b']);
      b.cube(6.5, 1, 1.5);
      b.cube(33.5, 1, 3.5);
      b.player(5.5, 1, 4.5, FACE.px);
      b.exit(33, 1, 10);
      return b;
    },
  },
  {
    name: 'Blind Courier',
    lines: [
      'The core is in a room you cannot see into. The plate is on the far side of a veil.',
      'Every gate you place, the veil will happily erase. Cross it as few times as you can.',
    ],
    build() {
      const b = new Builder(26, 13, 12);
      b.shell(0, 0, 0, 25, 12, 8, METAL);
      b.fill(15, 1, 1, 15, 9, 7, METAL); // divider, gap above
      b.field(8, 1, 1, 8, 11, 7); // full-height veil
      b.fill(0, 1, 1, 0, 3, 3, PANEL);
      b.fill(0, 9, 5, 0, 10, 7, PANEL);
      b.fill(15, 1, 3, 15, 3, 5, PANEL); // divider face
      b.fill(25, 8, 1, 25, 11, 7, PANEL); // sealed room, high wall only
      b.fill(19, 0, 2, 21, 0, 6, PANEL); // sealed room floor
      b.shell(11, 0, 8, 13, 3, 11, METAL);
      b.door(12, 1, 8, 12, 2, 8, ['a']);
      b.button(12, 1, 6, 'a');
      b.cube(23.5, 1, 4.5);
      b.player(11.5, 1, 3.5, FACE.nx);
      b.exit(12, 1, 10);
      return b;
    },
  },
  {
    name: 'Event Horizon',
    lines: [
      'Last chamber. Two cores, two plates, one drop zone, and only two gates to share between them.',
      'If you fall in, the lattice will not fall in after you.',
    ],
    build() {
      const b = new Builder(28, 18, 14);
      b.shell(0, 0, 0, 27, 17, 10, METAL); // tall vault so the island strip is a fair shot
      b.fill(1, 1, 1, 6, 10, 4, METAL);
      b.fill(1, 0, 5, 6, 0, 9, PANEL);
      b.fill(0, 1, 5, 0, 10, 9, PANEL);
      b.fill(8, 0, 1, 16, 0, 9, GOO);
      b.fill(11, 0, 1, 13, 0, 3, METAL); // island
      b.fill(12, 17, 1, 12, 17, 2, PANEL); // gate-sized strip above it
      b.button(12, 1, 1, 'b');
      b.button(12, 1, 2, 'b');
      b.fill(22, 2, 1, 26, 16, 9, METAL);
      for (let z = 1; z <= 9; z++) b.button(26, 1, z, 'a');
      b.shell(3, 0, 10, 5, 3, 13, METAL);
      b.door(4, 1, 10, 4, 2, 10, ['a', 'b']);
      b.cube(4.5, 11, 3);
      b.cube(2, 11, 1.5);
      b.player(3.5, 11, 3, FACE.pz);
      b.exit(4, 1, 12);
      return b;
    },
  },
];

export const ENDING = 'Evaluation complete. The lattice has filed your result under "adequate". Coming from me, that is affection.';

export function buildLevel(i) {
  return LEVELS[i].build();
}
