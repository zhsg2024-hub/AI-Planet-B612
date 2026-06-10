/* ══════════════════════════════════════════════════════════════════════════
   WorldQuest — Singapore 3D Isometric Map  (Three.js r128)
   Monument Valley-style low-poly orthographic view
   ══════════════════════════════════════════════════════════════════════════ */

const SingaporeMap = (() => {

  /* ─── Scene objects ─────────────────────────────────────────────────────── */
  let scene, camera, renderer;
  let raycaster, mouse;
  let clickables = [];     // landmark groups for ray-casting
  let discoveredMeshes = [];
  let rafId;
  let _lastFrameTime = 0;

  /* ─── 3D Sphere Planet ──────────────────────────────────────────────────── */
  let planetGroup = null;          // rotatable container; items live here
  const PLANET_RADIUS = 4;         // world units

  // Globe-trackball state — drag velocity (px/frame) drives quaternion rotation
  // with momentum after release. Pre-multiplying world-axis rotations gives
  // unrestricted 360° freedom like turning a real globe.
  const _spinVel    = { x: 0, y: 0 };   // residual drag velocity (decays)
  const _SPIN_DAMP  = 0.93;              // per-frame damping (≈ 60fps)
  const _SPIN_SENS  = 0.006;             // rad per pixel of mouse drag
  const _tmpQ       = new THREE.Quaternion();
  const _AXIS_X     = new THREE.Vector3(1, 0, 0);
  const _AXIS_Y     = new THREE.Vector3(0, 1, 0);

  /* ─── Fox state machine ──────────────────────────────────────────────────── */
  const BP = {
    parts:         null,
    state:         'walking',  // 'walking' | 'sitting' | 'stopping' | 'sleeping'
    stateTimer:    0,
    stateDuration: 8,
    walkCycle:     0,
    walkSpeed:     1.0,        // multiplier — 1.6 when fox is on an LLM mission
    pathIdx:       0,
    pathT:         0,
    sitProgress:   0,
  };

  // Spherical patrol path — list of (theta, phi) waypoints the fox slowly
  // wanders between, lerped along great-circle arcs.
  const FOX_PATH = [
    { theta: 0.0,                phi: 0.05 },              // very near top pole
    { theta: Math.PI * 0.25,     phi: Math.PI * 0.20 },
    { theta: Math.PI * 0.55,     phi: Math.PI * 0.45 },
    { theta: Math.PI * 0.85,     phi: Math.PI * 0.55 },    // crossing equator
    { theta: Math.PI * 1.10,     phi: Math.PI * 0.50 },
    { theta: Math.PI * 1.40,     phi: Math.PI * 0.40 },
    { theta: Math.PI * 1.70,     phi: Math.PI * 0.25 },
    { theta: Math.PI * 1.90,     phi: Math.PI * 0.12 },
  ];

  // Animal patrol routes — smaller loops near landmarks
  const ANIMAL_ROUTES = [
    [  // Around Merlion / waterfront
      new THREE.Vector3( 0.4, 0,  0.8),
      new THREE.Vector3( 1.0, 0,  1.5),
      new THREE.Vector3( 1.8, 0,  1.2),
      new THREE.Vector3( 1.5, 0,  0.3),
      new THREE.Vector3( 0.8, 0, -0.1),
    ],
    [  // Gardens by the Bay grove
      new THREE.Vector3( 3.2, 0,  0.2),
      new THREE.Vector3( 4.0, 0,  0.8),
      new THREE.Vector3( 4.2, 0,  1.5),
      new THREE.Vector3( 3.5, 0,  1.8),
      new THREE.Vector3( 3.0, 0,  1.1),
    ],
    [  // Chinatown alley
      new THREE.Vector3(-1.8, 0,  1.2),
      new THREE.Vector3(-2.5, 0,  1.8),
      new THREE.Vector3(-2.8, 0,  2.5),
      new THREE.Vector3(-2.2, 0,  2.8),
      new THREE.Vector3(-1.5, 0,  2.2),
    ],
  ];
  let _nextAnimalRoute = 0;

  // Fixed transport circuit paths (2 lanes, both loops)
  const TRANSPORT_ROUTES = [
    [  // Marina Bay loop
      new THREE.Vector3( 2.5, 0, -0.8),
      new THREE.Vector3( 4.2, 0,  0.5),
      new THREE.Vector3( 3.5, 0,  2.5),
      new THREE.Vector3( 1.5, 0,  3.0),
      new THREE.Vector3(-0.5, 0,  1.8),
      new THREE.Vector3(-1.8, 0,  0.3),
      new THREE.Vector3(-0.5, 0, -1.0),
      new THREE.Vector3( 1.0, 0, -1.2),
    ],
    [  // Orchard–CBD corridor
      new THREE.Vector3(-4.5, 0, -1.5),
      new THREE.Vector3(-2.5, 0, -1.0),
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3( 1.5, 0,  0.0),
      new THREE.Vector3( 3.5, 0,  0.5),
    ],
  ];
  let _nextRouteIdx = 0;

  /* ─── Camera state ──────────────────────────────────────────────────────── */
  let frustum   = 6.5;                                  // wider for the 3D planet
  let camTarget = new THREE.Vector3(0, 0, 0);           // look at planet center
  const CAM_OFFSET = new THREE.Vector3(0, 6, 14);       // slight tilt, front-facing

  /* ─── Interaction state ─────────────────────────────────────────────────── */
  let interactionMode = 'none';   // 'none' | 'panning' | 'item_drag'
  let isDrag   = false;           // distinguishes click from drag for _onClick
  let dragLast = { x:0, y:0 };
  let draggedItem = null;         // { group, ring, ... } being dragged

  // (legacy flat-ground projection plane removed; now we raycast against the
  // 3D sphere surface to convert mouse → world position during item drag)

  /* ══════════════════════════════════════════════════════════════════════════
     LANDMARK DEFINITIONS
     Coordinates are in Three.js world units (x = east, z = south).
     Singapore center ≈ (0,0), scale ≈ 1 unit per 1 km.
     ══════════════════════════════════════════════════════════════════════════ */
  const LANDMARKS = [
    { id: 'marina_bay_sands',   name: 'Marina Bay Sands',     nameEn: 'Marina Bay Sands',     emoji: '🏨', x:  2.2, z: -0.5, type: 'mbs',
      story: 'Three 57-floor towers crowned by the boat-shaped SkyPark — the best viewpoint of the Singapore skyline. Architect Moshe Safdie was once doubted on whether it could even stand. It stands very firmly.' },
    { id: 'merlion_park',       name: 'Merlion Park',         nameEn: 'Merlion Park',         emoji: '🦁', x:  0.4, z:  0.8, type: 'merlion',
      story: 'The Merlion is 8.6 m tall, 70 tons heavy. The word "Merlion" was only coined in 1964, yet Singapore has earned decades of tourism revenue from it 😂' },
    { id: 'gardens_by_the_bay', name: 'Gardens by the Bay',   nameEn: 'Gardens by the Bay',   emoji: '🌿', x:  3.8, z:  0.2, type: 'gardens',
      story: '18 Supertrees, 16–50 m tall, light up at night. Cloud Forest hosts a 60 m indoor waterfall; Flower Dome is the world\'s largest glass greenhouse.' },
    { id: 'chinatown',          name: 'Chinatown',            nameEn: 'Chinatown',            emoji: '🏮', x: -2.0, z:  1.8, type: 'district', color: 0xE53935,
      story: 'Chinese immigrant enclave since the 19th century. Today shophouses sit shoulder-to-shoulder with modern cafés, and red lanterns line every alley at night.' },
    { id: 'little_india',       name: 'Little India',         nameEn: 'Little India',         emoji: '🪔', x: -1.2, z: -2.8, type: 'district', color: 0xFF8F00,
      story: 'Sri Veeramakaliamman Temple sees incense day and night. Mustafa Centre is open 24/7. The air mixes jasmine, curry, and brightly dyed textiles.' },
    { id: 'orchard_road',       name: 'Orchard Road',         nameEn: 'Orchard Road',         emoji: '🛍️', x: -4.0, z: -1.5, type: 'shopping',
      story: 'Named after the orchards that once lined the road in the 1800s. Today: ION, Paragon, 313@Somerset — and limited-edition Starbucks-Merlion merch.' },
    { id: 'clarke_quay',        name: 'Clarke Quay',          nameEn: 'Clarke Quay',          emoji: '🎡', x: -1.8, z:  0.3, type: 'entertainment',
      story: 'An 1800s cargo quay turned nightlife hub. Colored warehouses, riverside bars, reverse bungee — Clarke Quay nights will undo tomorrow\'s itinerary.' },
    { id: 'sentosa',            name: 'Sentosa Island',       nameEn: 'Sentosa Island',       emoji: '🎢', x:  1.2, z:  5.5, type: 'island',
      story: '"Sentosa" means "peace and tranquility" in Malay — and the island delivers Universal Studios, a casino, and the SEA Aquarium. Peaceful, in its own way.' },
    { id: 'bugis_street',       name: 'Bugis Street',         nameEn: 'Bugis Street',         emoji: '🧋', x: -0.5, z: -1.8, type: 'market',
      story: 'Once Southeast Asia\'s most famous night market. Bugis Junction and Bugis+ now weave the old market into modern malls. Bubble tea heaven.' },
    { id: 'hawker_centre',      name: 'Lau Pa Sat Hawker',    nameEn: 'Lau Pa Sat Hawker Centre', emoji: '🍜', x: 1.5, z: 1.5, type: 'food',
      story: 'An 1894 Victorian cast-iron market, one of Singapore\'s oldest standing structures. After 7 PM, Boon Tat Street closes and dozens of satay grills ignite at once.' },
  ];

  /* ──────────────────────────────────────────────────────────────────────── */

  function init(canvasId) {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1020);
    scene.fog = new THREE.FogExp2(0x0d1020, 0.028);

    // Orthographic camera → isometric feel
    const wrap = document.getElementById('map-wrap');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const asp = W / H;
    camera = new THREE.OrthographicCamera(
      -frustum * asp, frustum * asp,
       frustum,       -frustum,
      0.1, 300
    );
    _updateCamera();

    // Renderer
    const canvas = document.getElementById(canvasId);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
    sun.position.set(12, 22, 8);
    sun.castShadow = true;
    sun.shadow.camera.near   = 0.1;
    sun.shadow.camera.far    = 80;
    sun.shadow.camera.left   = -20;
    sun.shadow.camera.right  =  20;
    sun.shadow.camera.top    =  20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xc0d8ff, 0.35);
    fill.position.set(-8, 10, -5);
    scene.add(fill);

    // Build world: a low-poly 3D sphere planet — items live on its surface
    planetGroup = new THREE.Group();
    scene.add(planetGroup);
    _buildPlanet(planetGroup);
    _buildLandmarks();   // no-op (kept for narrative coherence)

    // Main character — backpacker fox starts at the first FOX_PATH waypoint
    // and will walk along great-circle arcs through all of them.
    const { group: bpGroup, parts: bpParts } = _buildBackpacker();
    const fp0 = FOX_PATH[0];
    _placeOnSphereSurface(bpGroup, fp0.theta, fp0.phi);
    planetGroup.add(bpGroup);
    BP.parts = bpParts;

    // Raycaster
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Events
    canvas.addEventListener('mousedown',  _onMouseDown);
    canvas.addEventListener('mousemove',  _onCanvasHover);   // hover cursor only
    canvas.addEventListener('wheel',      _onWheel, { passive:true });
    canvas.addEventListener('click',      _onClick);
    window.addEventListener('resize',     _onResize);

    // Recompute camera now that the renderer & canvas have real dimensions
    // (the very first _updateCamera() ran before the renderer was created)
    _updateCamera();

    // Start
    // Seed lastFrameTime so first dt is 0, not NaN
    _lastFrameTime = performance.now();
    requestAnimationFrame(_animate);
  }

  /* ─── 3D Sphere Planet — smooth-ish low-poly body + soft atmosphere halo ─ */
  function _buildPlanet(parent) {
    // Body: icosahedron with 3 subdivisions → 1280 small triangular faces.
    // Visibly spherical but each face still catches light slightly differently
    // when combined with flatShading, giving it crafted "geodesic" character.
    const geo = new THREE.IcosahedronGeometry(PLANET_RADIUS, 3);

    // Per-face coloring uses a TIGHT palette + smooth noise-based blend so the
    // surface looks like land/ocean patches, not random noise. Each triangle
    // gets a base color biased by its average vertex normal.y (latitude).
    const baseLand  = new THREE.Color(0x3d6e58);  // greens near equator
    const baseHigh  = new THREE.Color(0x5b8772);  // lighter green for mid-lat
    const baseCold  = new THREE.Color(0x4d6e7a);  // cool teal near poles
    const baseOcean = new THREE.Color(0x305a6a);  // ocean blue-grey
    const tmpC      = new THREE.Color();
    const colors    = [];

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      // Average Y of the 3 verts in this triangle (range ≈ -R..R)
      const ay = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const lat = ay / PLANET_RADIUS;             // -1..1 (south..north)
      const absLat = Math.abs(lat);
      // Bias mix by latitude + a touch of noise per triangle
      const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;   // deterministic-ish
      const n = Math.abs(noise);
      let r, g, b;
      if (n < 0.18) {
        // Patches of ocean — rare deep-blue triangles for visual depth
        tmpC.copy(baseOcean);
      } else if (absLat > 0.7) {
        // Polar caps — cooler teal
        tmpC.copy(baseCold).lerp(baseHigh, (1 - absLat) * 3.3);
      } else {
        // Equatorial / mid-latitude — green band
        tmpC.copy(baseLand).lerp(baseHigh, n * 0.6);
      }
      ({ r, g, b } = tmpC);
      colors.push(r, g, b, r, g, b, r, g, b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.receiveShadow = true;
    sphere.castShadow    = true;
    parent.add(sphere);

    // Atmosphere halo: slightly larger transparent sphere rendered from inside
    const haloGeo = new THREE.SphereGeometry(PLANET_RADIUS * 1.08, 48, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x6dc4ff,
      transparent: true,
      opacity: 0.10,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    parent.add(halo);
  }

  /* ─── Spherical helpers ─────────────────────────────────────────────────── */
  // theta = azimuth (0..2π around Y axis); phi = polar (0=top, π=bottom)
  function _sphericalToCartesian(theta, phi, R = PLANET_RADIUS) {
    return new THREE.Vector3(
      R * Math.sin(phi) * Math.cos(theta),
      R * Math.cos(phi),
      R * Math.sin(phi) * Math.sin(theta)
    );
  }

  // Place an item group on the sphere surface and give it a *stable* basis:
  //   • local +Y points outward (radial)                  → "up"
  //   • local +Z points along the tangent toward world +Y → "north"
  //   • local +X is +Z × +Y                                → "east"
  // Building an explicit orthonormal basis (instead of `setFromUnitVectors`)
  // guarantees every item has a consistent rotation around its up axis, so
  // flag poles / windows / fronts all face the same way relative to the globe.
  const _UP_REF = new THREE.Vector3(0, 1, 0);
  const _basisMat = new THREE.Matrix4();
  const _tmpUp    = new THREE.Vector3();
  const _tmpNorth = new THREE.Vector3();
  const _tmpEast  = new THREE.Vector3();

  function _placeOnSphereSurface(group, theta, phi) {
    const pos = _sphericalToCartesian(theta, phi);
    group.position.copy(pos);
    _orientOutward(group, pos);
  }

  // `forwardHint` (optional THREE.Vector3 in planetGroup-local coords):
  // if given, it's projected onto the tangent plane and used as the model's
  // forward (+Z) direction. Without it, world-up is projected as a stable
  // "north" so all items have the same twist.
  function _orientOutward(group, localPos, forwardHint) {
    _tmpUp.copy(localPos).normalize();

    if (forwardHint) {
      _tmpNorth.copy(forwardHint);
    } else {
      _tmpNorth.copy(_UP_REF);
    }
    // Project onto tangent plane at this surface point
    _tmpNorth.sub(_tmpUp.clone().multiplyScalar(_tmpUp.dot(_tmpNorth)));
    if (_tmpNorth.lengthSq() < 1e-4) {
      // Hint is collinear with surface normal — fall back to world +Z
      _tmpNorth.set(0, 0, 1);
      _tmpNorth.sub(_tmpUp.clone().multiplyScalar(_tmpUp.dot(_tmpNorth)));
      if (_tmpNorth.lengthSq() < 1e-4) _tmpNorth.set(1, 0, 0);
    }
    _tmpNorth.normalize();
    _tmpEast.crossVectors(_tmpUp, _tmpNorth).normalize();
    _basisMat.makeBasis(_tmpEast, _tmpUp, _tmpNorth);
    group.quaternion.setFromRotationMatrix(_basisMat);
  }

  // Great-circle angular distance between two (theta, phi) points
  function _greatCircleAngle(t1, p1, t2, p2) {
    // angle = acos(sin(p1)sin(p2)cos(t1-t2) + cos(p1)cos(p2))
    // Note: phi=0 is top pole (north), phi=π is bottom (south).
    // Direction from center to surface = (sin(phi)cos(theta), cos(phi), sin(phi)sin(theta))
    const x1 = Math.sin(p1) * Math.cos(t1), y1 = Math.cos(p1), z1 = Math.sin(p1) * Math.sin(t1);
    const x2 = Math.sin(p2) * Math.cos(t2), y2 = Math.cos(p2), z2 = Math.sin(p2) * Math.sin(t2);
    const dot = Math.max(-1, Math.min(1, x1*x2 + y1*y2 + z1*z2));
    return Math.acos(dot);
  }

  /* ─── Landmarks ─────────────────────────────────────────────────────────── */
  // Narrative: the planet is born BARREN — only the user's own discoveries
  // populate it. The static LANDMARKS data is still used as semantic anchors
  // (e.g., placing food finds near hawker_centre), but their 3D meshes are
  // NOT rendered at startup.
  function _buildLandmarks() {
    // intentionally empty — see comment above
  }

  function _makeLandmarkGroup(def) {
    const g = new THREE.Group();
    switch (def.type) {
      case 'mbs':      _buildMBS(g, def);       break;
      case 'merlion':  _buildMerlion(g, def);   break;
      case 'gardens':  _buildGardens(g, def);   break;
      case 'island':   _buildIslandResort(g);   break;
      case 'shopping': _buildShopping(g, def);  break;
      case 'entertainment': _buildEntertain(g); break;
      case 'market':   _buildMarket(g, def);    break;
      case 'food':     _buildHawker(g);         break;
      default:         _buildDistrict(g, def);  break;
    }
    return g;
  }

  // Marina Bay Sands — 3 towers + boat platform
  function _buildMBS(g) {
    const towerMat = new THREE.MeshLambertMaterial({ color: 0xd6d0c0 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x88cce8, transparent:true, opacity:0.85 });
    for (let i = 0; i < 3; i++) {
      const h = 2.8;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.28, h, 0.28), towerMat);
      tower.position.set((i - 1) * 0.42, h/2, 0);
      tower.castShadow = true;
      g.add(tower);
      // Glass windows strip
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.20, h*0.7, 0.05), glassMat);
      win.position.set((i - 1) * 0.42, h/2, 0.15);
      g.add(win);
    }
    // Boat platform
    const boat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.42), new THREE.MeshLambertMaterial({ color: 0xb0a060 }));
    boat.position.set(0, 2.87, 0);
    boat.castShadow = true;
    g.add(boat);
    // Pool shimmer
    const pool = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.22), new THREE.MeshLambertMaterial({ color:0x5baad8 }));
    pool.position.set(0.1, 2.96, 0);
    g.add(pool);
  }

  // Merlion statue
  function _buildMerlion(g) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.3), new THREE.MeshLambertMaterial({ color:0x888888 }));
    base.position.y = 0.09;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.75, 8), mat);
    body.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat);
    head.position.y = 1.06;
    // mane
    const mane = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.22, 8), new THREE.MeshLambertMaterial({ color:0xcccccc }));
    mane.position.set(0, 0.95, -0.05);
    mane.rotation.x = Math.PI / 6;
    [base, body, head, mane].forEach(m => { m.castShadow = true; g.add(m); });
  }

  // Gardens by the Bay — supertrees + domes
  function _buildGardens(g) {
    const treeMat = new THREE.MeshLambertMaterial({ color:0x2e7d32 });
    const topMat  = new THREE.MeshLambertMaterial({ color:0x1b5e20 });
    const positions = [[-0.5,0,-0.3],[0,0,0],[0.55,0,0.1],[-0.2,0,0.5],[0.3,0,0.55]];
    const heights   = [1.8, 2.2, 1.5, 1.3, 1.6];
    positions.forEach(([x,,z], i) => {
      const h = heights[i];
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, h, 6), treeMat);
      trunk.position.set(x, h/2, z);
      trunk.castShadow = true;
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.38, 7), topMat);
      top.position.set(x, h + 0.18, z);
      g.add(trunk, top);
    });
    // Domes (Cloud Forest + Flower Dome)
    const domeMat = new THREE.MeshLambertMaterial({ color:0x80cbc4, transparent:true, opacity:0.65, wireframe:false });
    const d1 = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI*2, 0, Math.PI/2), domeMat);
    d1.position.set( 1.1, 0.02, -0.2);
    const d2 = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8, 0, Math.PI*2, 0, Math.PI/2), domeMat);
    d2.position.set( 1.6, 0.02,  0.25);
    g.add(d1, d2);
  }

  // District block cluster
  function _buildDistrict(g, def) {
    const baseColor = def.color || 0x9e9e9e;
    const rng = mulberry32(def.id.charCodeAt(0));
    for (let i = 0; i < 6; i++) {
      const h = 0.3 + rng() * 0.7;
      const w = 0.22 + rng() * 0.1;
      const col = shiftHue(baseColor, (rng()-0.5)*0.1);
      const mat = new THREE.MeshLambertMaterial({ color: col });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
      mesh.position.set((rng()-0.5)*1.1, h/2, (rng()-0.5)*0.9);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    // Street-level awning
    const awning = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 1.1), new THREE.MeshLambertMaterial({ color:0x222222 }));
    awning.position.y = 0.08;
    g.add(awning);
  }

  // Shopping strip
  function _buildShopping(g, def) {
    const colors = [0xe91e63, 0xff5722, 0x9c27b0, 0x2196f3, 0xff9800];
    for (let i = 0; i < 5; i++) {
      const h = 0.5 + i * 0.12;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, h, 0.32), new THREE.MeshLambertMaterial({ color: colors[i] }));
      b.position.set(i * 0.32 - 0.64, h/2, 0);
      b.castShadow = true;
      g.add(b);
    }
  }

  // Entertainment / Clarke Quay
  function _buildEntertain(g) {
    const cols = [0xff5252, 0xffd740, 0x69f0ae, 0x40c4ff, 0xff6d00];
    for (let i = 0; i < 5; i++) {
      const h = 0.25 + i * 0.08;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, h, 0.28), new THREE.MeshLambertMaterial({ color:cols[i] }));
      b.position.set(i*0.28 - 0.56, h/2, 0);
      b.castShadow = true;
      g.add(b);
    }
    // Ferris wheel hint
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 16), new THREE.MeshLambertMaterial({ color:0xffffff }));
    ring.position.set(-0.8, 0.5, 0.1);
    g.add(ring);
  }

  // Hawker centre
  function _buildHawker(g) {
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.2, 8), new THREE.MeshLambertMaterial({ color:0x795548 }));
    roof.position.y = 0.55;
    const walls = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 8, 1, true), new THREE.MeshLambertMaterial({ color:0xd7ccc8, side:THREE.DoubleSide }));
    walls.position.y = 0.25;
    [roof, walls].forEach(m => { m.castShadow=true; g.add(m); });
  }

  // Market / Bugis
  function _buildMarket(g, def) {
    _buildDistrict(g, def);
    // Bubble tea cup hint
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 8), new THREE.MeshLambertMaterial({ color:0xf48fb1 }));
    cup.position.set(0.6, 0.11, 0.3);
    g.add(cup);
  }

  // Sentosa resort
  function _buildIslandResort(g) {
    const h = 0.4;
    const hotel = new THREE.Mesh(new THREE.BoxGeometry(0.55, h, 0.3), new THREE.MeshLambertMaterial({ color:0xffd54f }));
    hotel.position.set(0, h/2, 0);
    hotel.castShadow = true;
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 6, 16), new THREE.MeshLambertMaterial({ color:0xff7043 }));
    wheel.position.set(-0.7, 0.35, 0);
    g.add(hotel, wheel);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     BACKPACKER MAIN CHARACTER  (always on map, placed near MBS)
     ═══════════════════════════════════════════════════════════════════════════ */

  function _buildBackpacker() {
    /* Low-poly fox — based on Le Petit Prince's renard.
       Uses the same parts contract as the old backpacker so existing
       walk/idle/sit animations keep working:
         parts.legL / legR  → front legs
         parts.armL / armR  → back legs (animated in opposition for 4-leg gait)
         parts.head         → fox head (look around)
         parts.body         → torso (breath scale)
         parts.tail         → fox tail (sway) — NEW                          */
    const g = new THREE.Group();
    const parts = {};

    // Fox palette — Le Petit Prince red fox
    const orange   = new THREE.MeshLambertMaterial({ color: 0xE53935 });   // body main (red)
    const orangeDk = new THREE.MeshLambertMaterial({ color: 0xB71C1C });   // ears outer (deep red)
    const cream    = new THREE.MeshLambertMaterial({ color: 0xFFF3D9 });   // belly / cheek / tail tip
    const black    = new THREE.MeshLambertMaterial({ color: 0x1A1A1A });   // paws / nose
    const eye      = new THREE.MeshLambertMaterial({ color: 0x000000 });

    const add = (mesh, key) => {
      mesh.castShadow = true;
      g.add(mesh);
      if (key) parts[key] = mesh;
      return mesh;
    };

    /* ─ Body (torso) ── elongated, slightly tilted forward ─ */
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.10, 0.20), orange);
    body.position.set(0, 0.14, 0);
    add(body, 'body');

    // Cream belly underlay
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.16), cream);
    belly.position.set(0, 0.10, 0);
    add(belly);

    /* ─ Head — slightly higher and forward ─ */
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.10), orange);
    head.position.set(0, 0.22, 0.13);
    add(head, 'head');

    // Cheeks (cream)
    const cheekL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), cream);
    cheekL.position.set(-0.025, 0.20, 0.18);
    const cheekR = cheekL.clone(); cheekR.position.x = 0.025;
    add(cheekL); add(cheekR);

    // Snout
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, 0.06), cream);
    snout.position.set(0, 0.20, 0.20);
    add(snout);

    // Nose (black tip)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.022), black);
    nose.position.set(0, 0.21, 0.235);
    add(nose);

    // Eyes (small black dots)
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), eye);
    eyeL.position.set(-0.025, 0.245, 0.185);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.025;
    add(eyeL); add(eyeR);

    // Ears (triangular)
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), orange);
    earL.position.set(-0.04, 0.31, 0.10);
    earL.rotation.set(0, Math.PI/4, -0.1);
    const earR = earL.clone();
    earR.position.x =  0.04;
    earR.rotation.z =  0.1;
    earR.rotation.y = -Math.PI/4;
    add(earL); add(earR);
    // Ear inner (dark accent)
    const earLInner = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.04, 4), orangeDk);
    earLInner.position.set(-0.04, 0.30, 0.105);
    earLInner.rotation.copy(earL.rotation);
    const earRInner = earLInner.clone();
    earRInner.position.x =  0.04;
    earRInner.rotation.copy(earR.rotation);
    add(earLInner); add(earRInner);

    /* ─ Legs (4 thin black-tipped pillars) ─ Pivots so they can swing ─ */
    const makeLegPivot = (px, pz) => {
      const piv = new THREE.Group();
      piv.position.set(px, 0.14, pz);   // hip/shoulder height
      g.add(piv);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.10, 0.035), orange);
      upper.position.y = -0.05;
      upper.castShadow = true;
      const paw = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.045), black);
      paw.position.set(0, -0.115, 0.003);
      paw.castShadow = true;
      piv.add(upper); piv.add(paw);
      return piv;
    };
    // Front-left/right legs → parts.legL / legR
    parts.legL = makeLegPivot(-0.045, 0.075);
    parts.legR = makeLegPivot( 0.045, 0.075);
    // Back-left/right legs → reuse parts.armL / armR slots (4-leg gait)
    parts.armL = makeLegPivot(-0.045, -0.075);
    parts.armR = makeLegPivot( 0.045, -0.075);

    /* ─ Tail — pivot at back, big bushy with cream tip ─ */
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.16, -0.10);
    g.add(tailPivot);
    parts.tail = tailPivot;

    const tail1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.09), orange);
    tail1.position.set(0, 0.02, -0.04);
    tail1.castShadow = true;
    const tail2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.08), orange);
    tail2.position.set(0, 0.07, -0.10);
    tail2.castShadow = true;
    const tailTip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.06), cream);
    tailTip.position.set(0, 0.11, -0.14);
    tailTip.castShadow = true;
    tailPivot.add(tail1, tail2, tailTip);
    // Slight default tilt
    tailPivot.rotation.x = -0.4;

    /* ─ Glow ring at feet (signature accent) ─ */
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.014, 6, 24),
      new THREE.MeshLambertMaterial({ color: 0xFF7043, transparent: true, opacity: 0.6 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    g.add(ring);

    // Scale up so fox is clearly the visual focus of the map
    g.scale.setScalar(3.2);

    parts.group = g;
    return { group: g, parts };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SIZE MULTIPLIERS  (relative to character = 1)
     ═══════════════════════════════════════════════════════════════════════════ */

  // ── Natural landscape (plant/flower/fruit) sit at building-scale so they
  // read as scenery, not collectibles. Creatures stay smaller for contrast.
  const SIZE_MULT = {
    // CIV — built structures
    landmark:       3.0,
    building:       2.0,
    religion:       2.4,
    sign:           0.8,
    transportation: 2.0,
    technology:     0.6,
    // ECO — natural landscape at building-scale + creatures at smaller scale
    plant:          2.2,    // groves / forest patches
    tree:           2.2,
    flower:         1.8,    // flower bush / planted bed
    fruit:          1.8,    // fruit tree
    animal:         0.55,   // walking creatures
    insect:         0.40,
    sea_creature:   0.65,
    // CULTURE — table-top sized (food / drink / souvenir feel)
    food:           0.40,
    dessert:        0.40,
    drink:          0.50,
    snack:          0.40,
    person:         1.0,
    art:            1.5,
    fashion:        0.8,
    souvenir:       0.6,
    default:        1.0,
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     DISCOVERED ITEM PLACEMENT
     All base meshes are normalized to ~0.35 units tall (= size 1 / person).
     SIZE_MULT is applied to the group scale.
     ═══════════════════════════════════════════════════════════════════════════ */

  function addDiscoveredItem(item) {
    const { name, category, locationId, color } = item;

    const group    = new THREE.Group();
    const hexColor = color ? parseInt(color.replace('#',''), 16) : _categoryColor(category);
    const mat      = new THREE.MeshLambertMaterial({ color: hexColor });
    const darkMat  = new THREE.MeshLambertMaterial({ color: 0x5D4037 });

    // ── Build normalised mesh (~0.35 unit base height) ─────────────────────
    switch (category) {

      case 'landmark': {
        // Triple-tower silhouette inspired by MBS — three vertical bars
        // connected by a golden sky-bridge on top + a low base platform.
        const baseMat   = new THREE.MeshLambertMaterial({ color: 0x6e6e6e });
        const bridgeMat = new THREE.MeshLambertMaterial({ color: 0xfff3b0 });
        const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.38, 0.10), mat);
        t1.position.set(-0.09, 0.19, 0);
        const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.10), mat);
        t2.position.set(0, 0.22, 0);
        const t3 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.38, 0.10), mat);
        t3.position.set(0.09, 0.19, 0);
        // Sky-bridge on top (the iconic "boat")
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.13), bridgeMat);
        bridge.position.set(0, 0.46, 0);
        // Wide base
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.05, 0.18), baseMat);
        base.position.y = 0.025;
        [base, t1, t2, t3, bridge].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'building': {
        // Stacked tower: base + mid + top + tiny flag pole — HDB / mid-rise feel
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.10, 0.22), mat);
        base.position.y = 0.05;
        const mid  = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), mat);
        mid.position.y = 0.17;
        const top  = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.10),
          new THREE.MeshLambertMaterial({ color: hexColor, transparent:true, opacity:.85 }));
        top.position.y = 0.29;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.08, 4),
          new THREE.MeshLambertMaterial({ color: 0xffffff }));
        pole.position.set(0.06, 0.38, 0);
        [base, mid, top, pole].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'plant':
      case 'tree': {
        // Lush trio of trees — 3 trunks + spherical canopies of varying size,
        // giving a "grove / planted patch" silhouette like real landscape.
        const trunkMat  = darkMat;
        const canopyMat = new THREE.MeshLambertMaterial({ color: hexColor });
        const canopy2   = new THREE.MeshLambertMaterial({ color: 0x4caf50 });   // companion green
        // Tree 1 — central tall
        const tr1  = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.20, 6), trunkMat);
        tr1.position.y = 0.10;
        const can1 = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), canopyMat);
        can1.position.y = 0.28;
        // Tree 2 — left short
        const tr2  = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.14, 6), trunkMat);
        tr2.position.set(-0.13, 0.07, -0.04);
        const can2 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), canopy2);
        can2.position.set(-0.13, 0.19, -0.04);
        // Tree 3 — right medium
        const tr3  = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.026, 0.17, 6), trunkMat);
        tr3.position.set(0.12, 0.085, 0.05);
        const can3 = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), canopyMat);
        can3.position.set(0.12, 0.225, 0.05);
        [tr1, can1, tr2, can2, tr3, can3].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'animal': {
        // Round body + head + ears
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), mat);
        body.position.y = 0.11;
        body.scale.set(1, 0.8, 1.1);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), mat);
        head.position.set(0.09, 0.19, 0);
        const earL = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.05, 4),
          new THREE.MeshLambertMaterial({ color: hexColor }));
        earL.position.set(0.07, 0.28, -0.04);
        const earR = earL.clone();
        earR.position.set(0.07, 0.28,  0.04);
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.02, 0.09, 4),
          new THREE.MeshLambertMaterial({ color: hexColor }));
        tail.rotation.z = Math.PI / 3;
        tail.position.set(-0.14, 0.15, 0);
        [body, head, earL, earR, tail].forEach(m => { m.castShadow=true; group.add(m); });
        break;
      }

      case 'food': {
        // Bowl with noodle pile + steam — same footprint as an animal,
        // but with clearer "hot Asian food" silhouette.
        // Layer stack: white bowl ▶ colored food pile ▶ yellow noodle curls ▶ steam wisps
        const bowlMat   = new THREE.MeshLambertMaterial({ color: 0xF5F5F5 });
        const noodleMat = new THREE.MeshLambertMaterial({ color: 0xFFE082 });
        const steamMat  = new THREE.MeshLambertMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.55 });

        // 1. Bowl dome (top hemisphere — reads as round food container from above)
        const bowl = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
          bowlMat
        );
        bowl.position.y = 0.025;

        // 2. Thick rim torus accentuates the bowl shape
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(0.12, 0.018, 6, 14),
          bowlMat
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.115;

        // 3. Colored food pile in the item's signature color
        const foodPile = new THREE.Mesh(
          new THREE.SphereGeometry(0.10, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
          mat
        );
        foodPile.position.y = 0.115;

        // 4. Two noodle curls — instantly recognizable Asian-noodle motif
        const noodle1 = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.013, 5, 10), noodleMat);
        noodle1.rotation.x = Math.PI / 2.3;
        noodle1.rotation.z = 0.3;
        noodle1.position.set(-0.025, 0.18, 0.025);
        const noodle2 = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.013, 5, 10), noodleMat);
        noodle2.rotation.x = Math.PI / 2.6;
        noodle2.rotation.z = -0.4;
        noodle2.position.set(0.03, 0.19, -0.02);

        // 5. Steam wisps — two soft spheres reading as "hot"
        const steam1 = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), steamMat);
        steam1.position.set(-0.02, 0.255, 0);
        const steam2 = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5), steamMat);
        steam2.position.set(0.03, 0.305, 0.015);

        [bowl, rim, foodPile, noodle1, noodle2, steam1, steam2].forEach(m => {
          m.castShadow = true;
          group.add(m);
        });
        break;
      }

      case 'transportation': {
        // Car silhouette (low-poly)
        const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.12), mat);
        chassis.position.y = 0.07;
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.11),
          new THREE.MeshLambertMaterial({ color: hexColor, transparent:true, opacity:.8 }));
        cabin.position.y = 0.15;
        cabin.position.x = -0.01;
        const wFL = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8),
          new THREE.MeshLambertMaterial({ color: 0x212121 }));
        wFL.rotation.x = Math.PI/2;
        wFL.position.set( 0.08, 0.04,  0.07);
        const wFR = wFL.clone(); wFR.position.set( 0.08, 0.04, -0.07);
        const wBL = wFL.clone(); wBL.position.set(-0.08, 0.04,  0.07);
        const wBR = wFL.clone(); wBR.position.set(-0.08, 0.04, -0.07);
        [chassis, cabin, wFL, wFR, wBL, wBR].forEach(m => { m.castShadow=true; group.add(m); });
        break;
      }

      case 'sign': {
        // Signboard on a pole
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.28, 5),
          new THREE.MeshLambertMaterial({ color: 0x9E9E9E }));
        pole.position.y = 0.14;
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.02), mat);
        board.position.y = 0.32;
        const text = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.025),
          new THREE.MeshLambertMaterial({ color: 0xffffff }));
        text.position.y = 0.32;
        [pole, board, text].forEach(m => { m.castShadow=true; group.add(m); });
        break;
      }

      case 'person': {
        // Mini version of backpacker (without full detail)
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.06), mat);
        body.position.y = 0.17;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4),
          new THREE.MeshLambertMaterial({ color: 0xFFCBA4 }));
        head.position.y = 0.305;
        [body, head].forEach(m => { m.castShadow=true; group.add(m); });
        break;
      }

      case 'art': {
        // Easel + framed canvas
        const easelMat = new THREE.MeshLambertMaterial({ color: 0x6D4C41 });
        const frameMat = new THREE.MeshLambertMaterial({ color: 0xFFD54F });
        const canvasMat = mat;   // uses the picked hexColor as artwork color

        // Tripod legs
        const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.36, 5), easelMat);
        leg1.position.set(-0.06, 0.18, 0.04);
        leg1.rotation.z =  0.14;
        const leg2 = leg1.clone();
        leg2.position.set( 0.06, 0.18, 0.04);
        leg2.rotation.z = -0.14;
        const leg3 = leg1.clone();
        leg3.position.set( 0,    0.18, -0.06);
        leg3.rotation.z =  0;
        leg3.rotation.x = -0.14;

        // Frame around canvas
        const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.16, 0.012), frameMat);
        frameOuter.position.set(0, 0.30, 0.02);
        // Painted canvas (slightly in front of frame)
        const canvasGeo = new THREE.PlaneGeometry(0.16, 0.12);
        const canvas    = new THREE.Mesh(canvasGeo, canvasMat);
        canvas.position.set(0, 0.30, 0.029);

        // Color accents on the canvas (3 stripes)
        const stripe1 = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.018),
          new THREE.MeshLambertMaterial({ color: 0xffffff }));
        stripe1.position.set(0, 0.34, 0.030);
        const stripe2 = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.018),
          new THREE.MeshLambertMaterial({ color: 0x222222 }));
        stripe2.position.set(0, 0.30, 0.030);

        [leg1, leg2, leg3, frameOuter, canvas, stripe1, stripe2].forEach(m => {
          m.castShadow = true;
          group.add(m);
        });
        break;
      }

      case 'souvenir': {
        // Gift box with ribbon + bow
        const boxMat = mat;
        const ribbonMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const bowMat    = new THREE.MeshLambertMaterial({ color: 0xff4081 });

        const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), boxMat);
        box.position.y = 0.08;
        // Ribbons across the box (two perpendicular bands)
        const ribbonH = new THREE.Mesh(new THREE.BoxGeometry(0.225, 0.04, 0.225), ribbonMat);
        ribbonH.position.y = 0.08;
        ribbonH.scale.z = 0.18;
        const ribbonV = new THREE.Mesh(new THREE.BoxGeometry(0.225, 0.04, 0.225), ribbonMat);
        ribbonV.position.y = 0.08;
        ribbonV.scale.x = 0.18;
        // Bow on top
        const bowCenter = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), bowMat);
        bowCenter.position.y = 0.18;
        const loopL = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 5, 12, Math.PI),
          bowMat);
        loopL.rotation.z =  Math.PI / 2;
        loopL.position.set(-0.04, 0.185, 0);
        const loopR = loopL.clone();
        loopR.rotation.z = -Math.PI / 2;
        loopR.position.set( 0.04, 0.185, 0);

        // Sparkle on top
        const sparkle = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0),
          new THREE.MeshLambertMaterial({ color: 0xffffff }));
        sparkle.position.set(0.1, 0.22, 0.05);

        [box, ribbonH, ribbonV, bowCenter, loopL, loopR, sparkle].forEach(m => {
          m.castShadow = true;
          group.add(m);
        });
        break;
      }

      /* ────── NEW CATEGORIES (10) ────── */

      case 'religion': {
        // Temple / mosque silhouette: stepped base + dome / spire on top
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.10, 0.26), mat);
        base.position.y = 0.05;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.14, 0.20), mat);
        wall.position.y = 0.17;
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI*2, 0, Math.PI/2),
          new THREE.MeshLambertMaterial({ color: hexColor }));
        dome.position.y = 0.24;
        const spire = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.13, 6),
          new THREE.MeshLambertMaterial({ color: 0xfff3b0 }));   // gold tip
        spire.position.y = 0.40;
        [base, wall, dome, spire].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'technology': {
        // Tablet-on-stand silhouette
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.05, 6),
          new THREE.MeshLambertMaterial({ color: 0x37474f }));
        stand.position.y = 0.025;
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 4),
          new THREE.MeshLambertMaterial({ color: 0x37474f }));
        arm.position.y = 0.13;
        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.025), mat);
        screen.position.y = 0.23;
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.12),
          new THREE.MeshBasicMaterial({ color: 0x4dd0e1, transparent:true, opacity:.6 }));
        glow.position.set(0, 0.23, 0.014);
        [stand, arm, screen, glow].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'flower': {
        // Stem with bloom (5 petals around center)
        const stemMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 4), stemMat);
        stem.position.y = 0.09;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.06, 4), stemMat);
        leaf.rotation.z = Math.PI / 3;
        leaf.position.set(0.03, 0.10, 0);
        const center = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6),
          new THREE.MeshLambertMaterial({ color: 0xffeb3b }));
        center.position.y = 0.22;
        const petals = [];
        for (let i = 0; i < 5; i++) {
          const p = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), mat);
          const a = (i / 5) * Math.PI * 2;
          p.position.set(Math.cos(a) * 0.05, 0.22, Math.sin(a) * 0.05);
          p.scale.set(1, 0.5, 1);
          petals.push(p);
        }
        [stem, leaf, center, ...petals].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'insect': {
        // Small body + 4 wings
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat);
        body.position.y = 0.08;
        body.scale.set(0.7, 0.7, 1.3);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), mat);
        head.position.set(0, 0.08, 0.09);
        const wingMat = new THREE.MeshLambertMaterial({
          color: 0xffffff, transparent:true, opacity:.65, side: THREE.DoubleSide,
        });
        const wingL = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.10), wingMat);
        wingL.position.set(-0.08, 0.11, 0);
        wingL.rotation.y = -0.4;
        const wingR = wingL.clone();
        wingR.position.set(0.08, 0.11, 0);
        wingR.rotation.y = 0.4;
        [body, head, wingL, wingR].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'sea_creature': {
        // Stylized fish: oval body + triangular tail
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), mat);
        body.position.y = 0.10;
        body.scale.set(1.4, 0.85, 0.8);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.12, 4), mat);
        tail.rotation.z = -Math.PI / 2;
        tail.position.set(-0.13, 0.10, 0);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5),
          new THREE.MeshLambertMaterial({ color: 0x000000 }));
        eye.position.set(0.10, 0.13, 0.04);
        [body, tail, eye].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'fruit': {
        // Round fruit + small stem leaf (sphere with cone)
        const fruitMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat);
        fruitMesh.position.y = 0.13;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.05, 4),
          new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
        stem.position.y = 0.27;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.06, 4),
          new THREE.MeshLambertMaterial({ color: 0x4caf50 }));
        leaf.rotation.z = Math.PI / 3;
        leaf.position.set(0.025, 0.29, 0);
        [fruitMesh, stem, leaf].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'dessert': {
        // Small white bowl + colored scoop with cherry on top
        const bowlMat = new THREE.MeshLambertMaterial({ color: 0xfff3e0 });
        const bowl = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 8, 5, 0, Math.PI*2, 0, Math.PI/2), bowlMat);
        bowl.position.y = 0.025;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 6, 14), bowlMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.105;
        const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mat);
        scoop.position.y = 0.135;
        const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5),
          new THREE.MeshLambertMaterial({ color: 0xd81b60 }));
        cherry.position.y = 0.21;
        [bowl, rim, scoop, cherry].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'drink': {
        // Mug/glass: tall cylinder + handle ring
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.20, 12), mat);
        cup.position.y = 0.10;
        const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.066, 0.05, 12),
          new THREE.MeshLambertMaterial({ color: 0x4e342e }));   // coffee dark
        liquid.position.y = 0.18;
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.013, 6, 12, Math.PI),
          mat);
        handle.rotation.y = Math.PI / 2;
        handle.position.set(0.085, 0.10, 0);
        const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.10, 4),
          new THREE.MeshLambertMaterial({ color: 0xff5252 }));
        straw.position.set(-0.025, 0.24, 0);
        straw.rotation.z = -0.2;
        [cup, liquid, handle, straw].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'snack': {
        // Wrapper / chip bag silhouette (small upright bag)
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.06), mat);
        bag.position.y = 0.12;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.07),
          new THREE.MeshLambertMaterial({ color: 0xffffff }));
        stripe.position.y = 0.14;
        const tabL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.06), mat);
        tabL.position.set(-0.10, 0.24, 0);
        tabL.rotation.z = 0.35;
        const tabR = tabL.clone();
        tabR.position.set(0.10, 0.24, 0);
        tabR.rotation.z = -0.35;
        [bag, stripe, tabL, tabR].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      case 'fashion': {
        // Hanger + shirt silhouette
        const hangMat = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });
        const hook = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.008, 5, 8, Math.PI),
          hangMat);
        hook.position.y = 0.36;
        hook.rotation.x = Math.PI;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, 0.012), hangMat);
        bar.position.y = 0.30;
        // Shirt: triangular torso
        const shirt = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.22, 4), mat);
        shirt.position.y = 0.18;
        shirt.rotation.y = Math.PI / 4;
        // Collar accent
        const collar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.018),
          new THREE.MeshLambertMaterial({ color: 0xffffff }));
        collar.position.y = 0.275;
        [hook, bar, shirt, collar].forEach(m => { m.castShadow = true; group.add(m); });
        break;
      }

      default: { // gem / crystal
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), mat);
        crystal.position.y = 0.18;
        crystal.castShadow = true;
        group.add(crystal);
      }
    }

    // ── Apply size multiplier ───────────────────────────────────────────────
    const scale = SIZE_MULT[category] ?? SIZE_MULT.default;
    group.scale.setScalar(scale);   // start at final scale for placement
    // (animated-in from 0 below)
    group.scale.setScalar(0);       // will animate up


    // Glow ring at base (added for all types)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.018, 6, 24),
      new THREE.MeshLambertMaterial({ color: hexColor, transparent: true, opacity: 0.55 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    // ── Selection halo + pointer arrow (hidden until item is highlighted) ──
    // These are dedicated meshes so highlight visibility never depends on
    // mutating other materials' opacity/emissive (which can be fragile).
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffd700, transparent: true, opacity: 0,
        side: THREE.BackSide,         // render from inside → glow rim look
        depthWrite: false,
      })
    );
    halo.position.y = 0.18;
    group.add(halo);

    // Floating downward-pointing arrow (sits high above the item)
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.10, 0.20, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0 })
    );
    arrow.rotation.x = Math.PI;        // point downward
    arrow.position.y = 0.72;
    group.add(arrow);

    // Spherical placement: respect saved (theta, phi) if available, otherwise
    // compute a non-overlapping spot via spherical spiral search.
    const targetScale = SIZE_MULT[category] ?? SIZE_MULT.default;
    // Min angular distance ≈ item footprint / planet radius
    const minAngle = Math.max(0.08, targetScale * 0.5 / PLANET_RADIUS);

    let theta, phi;
    if (typeof item.theta === 'number' && typeof item.phi === 'number') {
      theta = item.theta;
      phi   = item.phi;
    } else {
      const anchor = _landmarkSpherical(locationId);
      const spot   = _findFreeSpotSphere(anchor.theta, anchor.phi, minAngle);
      theta = spot.theta;
      phi   = spot.phi;
      // Persist so reloads keep the same layout
      window.UI?.onItemPlaced?.(item.name, theta, phi);
    }
    _placeOnSphereSurface(group, theta, phi);

    // Route-based animation disabled on a sphere — items just sit at their
    // assigned surface spot. Keep these vars for compat with downstream code.
    const animRoute = null, routeIdx = 0, routeT = 0;

    // Animate in from scale 0 → target
    group.scale.setScalar(0);
    // Tag the group + every child mesh so raycaster can identify this discovered item
    group.userData = {
      discoveredItemName: item.name,
      locationId: item.locationId,
      category,
    };
    group.traverse(m => {
      if (m.isMesh) m.userData.discoveredItemName = item.name;
    });
    // Attach to planetGroup so the item rotates WITH the planet (sticks to surface)
    planetGroup.add(group);
    discoveredMeshes.push({
      group, ring, halo, arrow,
      rotDir:     Math.random() > 0.5 ? 1 : -1,
      itemName:   item.name,
      locationId: item.locationId,
      category,
      targetScale,
      theta, phi,
      animRoute, routeIdx, routeT,
      highlighted: false,
    });

    // Burst particles at landing position (skip during restoration)
    if (!item._restoring) {
      _spawnLandingBurst(group.position.x, group.position.z, hexColor);
    }

    let t = 0;
    const animIn = () => {
      t += 0.06;
      const progress = Math.min(1, t);
      // Springy ease: overshoot slightly then settle
      const s = targetScale * (progress < 1
        ? 1.15 * progress - 0.15 * Math.sin(progress * Math.PI)
        : 1);
      group.scale.setScalar(Math.min(s, targetScale * 1.05));
      if (progress < 1) requestAnimationFrame(animIn);
      else group.scale.setScalar(targetScale);
    };
    requestAnimationFrame(animIn);
  }

  /* ─── Landmark → spherical anchor (deterministic, evenly spread) ──────── */
  // Each known landmark id gets a fixed (theta, phi) so items belonging to it
  // cluster on a consistent surface region. Unknown ids → random spot.
  const LANDMARK_SPHERICAL = {
    marina_bay_sands:    { theta: 0.0,            phi: Math.PI * 0.45 },
    merlion_park:        { theta: Math.PI * 0.3,  phi: Math.PI * 0.50 },
    gardens_by_the_bay:  { theta: Math.PI * 0.6,  phi: Math.PI * 0.42 },
    chinatown:           { theta: Math.PI * 0.9,  phi: Math.PI * 0.55 },
    little_india:        { theta: Math.PI * 1.2,  phi: Math.PI * 0.40 },
    orchard_road:        { theta: Math.PI * 1.5,  phi: Math.PI * 0.48 },
    clarke_quay:         { theta: Math.PI * 1.75, phi: Math.PI * 0.55 },
    sentosa:             { theta: Math.PI * 0.15, phi: Math.PI * 0.72 },
    bugis_street:        { theta: Math.PI * 1.05, phi: Math.PI * 0.35 },
    hawker_centre:       { theta: Math.PI * 0.45, phi: Math.PI * 0.60 },
  };

  function _landmarkSpherical(id) {
    if (id && LANDMARK_SPHERICAL[id]) return { ...LANDMARK_SPHERICAL[id] };
    return {
      theta: Math.random() * Math.PI * 2,
      phi:   Math.PI * 0.2 + Math.random() * Math.PI * 0.6,   // avoid poles
    };
  }

  /* ─── Spherical spiral search for a non-overlapping spot ─────────────── */
  // Walks outward from the anchor in expanding great-circle rings, returning
  // the first (theta, phi) that's ≥ minAngle (radians) from every existing item.
  function _findFreeSpotSphere(anchorTheta, anchorPhi, minAngle) {
    if (_isFreeSpotSphere(anchorTheta, anchorPhi, minAngle)) {
      return { theta: anchorTheta, phi: anchorPhi };
    }
    const STEP = Math.max(0.08, minAngle * 0.9);
    for (let r = 1; r <= 16; r++) {
      const radius = STEP * r;
      if (radius > Math.PI * 0.9) break;
      const slots = Math.max(8, Math.floor(r * 6));
      const angleJitter = r * 0.4;
      for (let i = 0; i < slots; i++) {
        const ang = (i / slots) * Math.PI * 2 + angleJitter;
        const { theta, phi } = _offsetOnSphere(anchorTheta, anchorPhi, radius, ang);
        if (_isFreeSpotSphere(theta, phi, minAngle)) return { theta, phi };
      }
    }
    // Crowded — small random jiggle around anchor as last resort
    return {
      theta: anchorTheta + (Math.random() - 0.5) * 0.2,
      phi:   Math.max(0.1, Math.min(Math.PI - 0.1, anchorPhi + (Math.random() - 0.5) * 0.2)),
    };
  }

  // Walk `radius` radians along a great circle from (theta, phi) in tangent
  // direction `bearing` (0..2π). Approximation good for radius up to ~π/2.
  function _offsetOnSphere(theta, phi, radius, bearing) {
    // Use simple lat/lon-style offset; clamp phi away from exact poles.
    const sinR = Math.sin(radius), cosR = Math.cos(radius);
    const sinP = Math.sin(phi),    cosP = Math.cos(phi);
    const newY = cosP * cosR + sinP * sinR * Math.cos(bearing);
    const newPhi = Math.acos(Math.max(-1, Math.min(1, newY)));
    const deltaTheta = Math.atan2(
      sinR * Math.sin(bearing) * sinP,
      cosR - cosP * Math.cos(newPhi)
    );
    return {
      theta: (theta + deltaTheta + Math.PI * 2) % (Math.PI * 2),
      phi:   Math.max(0.05, Math.min(Math.PI - 0.05, newPhi)),
    };
  }

  function _isFreeSpotSphere(theta, phi, minAngle) {
    for (const d of discoveredMeshes) {
      if (d.theta == null || d.phi == null) continue;
      if (_greatCircleAngle(theta, phi, d.theta, d.phi) < minAngle) return false;
    }
    return true;
  }

  /* Spherical slerp on unit vectors — interpolates the shorter great-circle */
  const _slerpA = new THREE.Vector3();
  const _slerpB = new THREE.Vector3();
  function _slerpSphere(theta1, phi1, theta2, phi2, t, outVec) {
    _slerpA.set(
      Math.sin(phi1) * Math.cos(theta1),
      Math.cos(phi1),
      Math.sin(phi1) * Math.sin(theta1)
    );
    _slerpB.set(
      Math.sin(phi2) * Math.cos(theta2),
      Math.cos(phi2),
      Math.sin(phi2) * Math.sin(theta2)
    );
    const dot = Math.max(-1, Math.min(1, _slerpA.dot(_slerpB)));
    const omega = Math.acos(dot);
    if (omega < 1e-4) {
      outVec.copy(_slerpA);
      return;
    }
    const s = Math.sin(omega);
    const c1 = Math.sin((1 - t) * omega) / s;
    const c2 = Math.sin(t * omega) / s;
    outVec.set(
      _slerpA.x * c1 + _slerpB.x * c2,
      _slerpA.y * c1 + _slerpB.y * c2,
      _slerpA.z * c1 + _slerpB.z * c2
    );
  }

  function _categoryColor(cat) {
    const map = {
      // CIV
      landmark:0x5c9eff,    building:0x90a4ae,    religion:0xd4a574,
      sign:0x80deea,        transportation:0xf44336, technology:0x4dd0e1,
      // ECO
      plant:0x66bb6a,       tree:0x4caf50,        flower:0xff80ab,
      animal:0xff8a65,      insect:0xab47bc,      sea_creature:0x29b6f6,
      fruit:0xffca28,
      // CULTURE
      food:0xffb74d,        dessert:0xf48fb1,     drink:0x8d6e63,
      snack:0xffcc80,       person:0xef9a9a,      art:0xe040fb,
      fashion:0xff6e90,     souvenir:0xffc107,
    };
    return map[cat] ?? 0xce93d8;
  }

  /* ─── Highlight a landmark ──────────────────────────────────────────────── */
  function highlightLandmark(id) {
    clickables.forEach(g => {
      const on = id && g.userData.id === id;
      g.traverse(m => {
        if (m.isMesh && m.material?.emissive) {
          m.material.emissive.set(on ? 0x224422 : 0x000000);
        }
      });
    });
  }

  /* ─── Landing burst particles ───────────────────────────────────────────── */
  const _particles = [];   // { mesh, vel, life, maxLife }

  function _spawnLandingBurst(x, z, color) {
    const count = 24;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });

    for (let i = 0; i < count; i++) {
      const size = 0.04 + Math.random() * 0.03;
      const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat.clone());
      m.position.set(x, 0.1, z);
      const ang   = Math.random() * Math.PI * 2;
      const sp    = 0.8 + Math.random() * 1.6;
      const vY    = 1.2 + Math.random() * 1.8;
      _particles.push({
        mesh: m,
        vel:  new THREE.Vector3(Math.cos(ang) * sp, vY, Math.sin(ang) * sp),
        life: 0,
        maxLife: 0.9 + Math.random() * 0.4,
      });
      scene.add(m);
    }

    // Expanding shockwave ring
    const ringMat  = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ringGeo  = new THREE.RingGeometry(0.1, 0.18, 24);
    const shock    = new THREE.Mesh(ringGeo, ringMat);
    shock.rotation.x = -Math.PI / 2;
    shock.position.set(x, 0.05, z);
    scene.add(shock);
    _particles.push({ mesh: shock, vel: null, life: 0, maxLife: 0.7, isShockwave: true });
  }

  function _tickParticles(dt) {
    for (let i = _particles.length - 1; i >= 0; i--) {
      const p = _particles[i];
      p.life += dt;
      const t = p.life / p.maxLife;

      if (p.isShockwave) {
        const s = 1 + t * 6;
        p.mesh.scale.set(s, s, s);
        p.mesh.material.opacity = 0.8 * (1 - t);
      } else {
        // Gravity
        p.vel.y -= 5 * dt;
        p.mesh.position.x += p.vel.x * dt;
        p.mesh.position.y += p.vel.y * dt;
        p.mesh.position.z += p.vel.z * dt;
        p.mesh.rotation.x += dt * 6;
        p.mesh.rotation.y += dt * 4;
        p.mesh.material.opacity = Math.max(0, 1 - t);
      }

      if (p.life >= p.maxLife) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        _particles.splice(i, 1);
      }
    }
  }

  /* ─── Remove a discovered item from the map ─────────────────────────────── */
  function removeDiscoveredItem(itemName) {
    const idx = discoveredMeshes.findIndex(d => d.itemName === itemName);
    if (idx === -1) return;

    const { group, targetScale } = discoveredMeshes[idx];
    discoveredMeshes.splice(idx, 1);  // remove from tracking immediately

    // Animate scale → 0, then remove from scene
    let s = targetScale ?? 1;
    const animOut = () => {
      s -= 0.08;
      if (s > 0) {
        group.scale.setScalar(s);
        requestAnimationFrame(animOut);
      } else {
        scene.remove(group);
      }
    };
    animOut();
  }

  /* ─── Highlight a specific discovered item on the map ───────────────────── */
  // Uses dedicated halo + arrow meshes so visibility is guaranteed regardless
  // of the underlying item's material setup. Other items dim via ring opacity.
  function highlightDiscoveredItem(itemName, on) {
    let matched = 0;
    discoveredMeshes.forEach(d => {
      const isTarget = d.itemName === itemName;
      if (isTarget && on) matched++;

      if (isTarget && on) {
        // ── TURN ON HIGHLIGHT ──
        d.highlighted = true;
        d.halo.material.opacity  = 0.55;     // glowing golden aura
        d.arrow.material.opacity = 1.0;      // downward pointer
        d.ring.material.opacity  = 1.0;
        d.ring.material.color.set(0xffd700); // gold ring
        // Subtle scale-up for the target itself
        const base = d.targetScale ?? 1;
        d.group.scale.setScalar(base * 1.25);
        // Bright emissive on any compatible material (bonus, not required)
        d.group.traverse(m => {
          if (m.isMesh && m.material?.emissive) m.material.emissive.set(0x886633);
        });
      } else {
        // ── TURN OFF (or non-target) ──
        d.highlighted = false;
        d.halo.material.opacity  = 0;
        d.arrow.material.opacity = 0;
        // Restore ring (slightly dimmer for non-targets when on, normal when off)
        d.ring.material.opacity = on ? 0.35 : 0.55;
        d.ring.material.color.set(d._origColor || 0xffffff);
        // Restore size
        const base = d.targetScale ?? 1;
        d.group.scale.setScalar(base);
        // Clear emissive
        d.group.traverse(m => {
          if (m.isMesh && m.material?.emissive) m.material.emissive.set(0x000000);
        });
      }
    });

    if (on && matched === 0) {
      console.warn('[highlight] no discovered mesh matched name:', itemName,
                   '→ existing names:', discoveredMeshes.map(d => d.itemName));
    }

    // Also highlight the landmark this item belongs to
    if (on && itemName) {
      const d = discoveredMeshes.find(x => x.itemName === itemName);
      if (d?.locationId) highlightLandmark(d.locationId);
    } else if (!on) {
      highlightLandmark(null);
    }
  }

  /* ─── Camera helpers ────────────────────────────────────────────────────── */
  function _updateCamera() {
    // Use the canvas's actual rendered size. Fall back to map-wrap (in case
    // renderer hasn't been created yet) so the very first projection is built
    // with the real aspect ratio — otherwise a hardcoded 800×600 fallback
    // squashes/stretches the sphere whenever the wrap isn't exactly that.
    const cw = renderer?.domElement.clientWidth;
    const ch = renderer?.domElement.clientHeight;
    const wrap = document.getElementById('map-wrap');
    const W = cw || wrap?.clientWidth  || 800;
    const H = ch || wrap?.clientHeight || 600;
    const asp = W / H;
    camera.left   = -frustum * asp;
    camera.right  =  frustum * asp;
    camera.top    =  frustum;
    camera.bottom = -frustum;
    camera.position.copy(camTarget).add(CAM_OFFSET);
    camera.lookAt(camTarget);
    camera.updateProjectionMatrix();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     ANIMATION LOOP — delta-time based
     ═══════════════════════════════════════════════════════════════════════════ */

  function _animate(now) {
    rafId = requestAnimationFrame(_animate);
    const dt = Math.min((now - _lastFrameTime) / 1000, 0.05);
    _lastFrameTime = now;

    // Backpacker fox sits on the planet surface (idle breathing only)
    _tickBackpacker(dt);
    // Route-based transport/animal animation disabled on a sphere
    // _tickTransports(dt);
    _tickParticles(dt);

    // Globe momentum + idle drift — only when the user isn't holding anything
    if (planetGroup && interactionMode === 'none') {
      const moving = Math.abs(_spinVel.x) > 0.15 || Math.abs(_spinVel.y) > 0.15;
      if (moving) {
        _applySpin(_spinVel.x, _spinVel.y);
        _spinVel.x *= _SPIN_DAMP;
        _spinVel.y *= _SPIN_DAMP;
      } else {
        _spinVel.x = 0; _spinVel.y = 0;
        _tmpQ.setFromAxisAngle(_AXIS_Y, dt * 0.04);
        planetGroup.quaternion.premultiply(_tmpQ);
      }
    }

    // Items now stay GLUED to the planet (no per-item spin), so the carefully
    // computed outward orientation persists frame-to-frame. The thin ring
    // beneath each item still shimmers, and highlight visuals pulse.
    const tNow = now / 1000;
    discoveredMeshes.forEach(d => {
      // Subtle ring twinkle — local +Z is tangent, so this spin is in the
      // surface plane and reads as a tiny halo shimmer.
      d.ring.rotation.z += 0.012 * d.rotDir;

      if (d.highlighted) {
        const pulse = 1 + Math.sin(tNow * 4) * 0.08;
        d.halo.scale.setScalar(pulse);
        d.arrow.position.y = 0.72 + Math.sin(tNow * 3.5) * 0.06;
        d.arrow.rotation.z += 0.04;
      }
    });

    renderer.render(scene, camera);
  }

  /* ─── Fox state machine — context-aware (activity + planet time) ─────────── */

  function _tickBackpacker(dt) {
    if (!BP.parts) return;
    BP.stateTimer += dt;

    const activity = window.AgentSystem?.getCurrentFoxActivity?.();
    const planetT  = window.AgentSystem?.planetTime?.();
    const h        = planetT?.hourOfDay ?? 12;
    const isLLMRunning  = !!activity;
    const isDeepNight   = (h >= 23 || h < 5);

    // ── Hard overrides ─────────────────────────────────────────────────
    // While LLM activity runs → fox MUST be walking (visibly doing things)
    if (isLLMRunning && BP.state !== 'walking') {
      BP.state = 'walking';
      BP.stateTimer = 0;
      BP.stateDuration = 60;       // hold for whole activity duration
      BP.walkSpeed = 1.6;          // walks faster when on a mission
    }
    // Deep night, idle → fox curls up and sleeps
    if (!isLLMRunning && isDeepNight && BP.state !== 'sleeping') {
      BP.state = 'sleeping';
      BP.stateTimer = 0;
      BP.stateDuration = 30;
      BP.walkSpeed = 1.0;
    }

    // ── Natural transitions when state duration ends ───────────────────
    if (BP.stateTimer >= BP.stateDuration) {
      BP.state = _pickFoxState(h, isLLMRunning);
      BP.stateTimer = 0;
      BP.stateDuration = BP.state === 'sleeping' ? 30 :
                         BP.state === 'walking'  ? 6 + Math.random() * 8 :
                         BP.state === 'sitting'  ? 6 + Math.random() * 10 :
                                                   3 + Math.random() * 5;
      BP.walkSpeed = isLLMRunning ? 1.6 : 1.0;
    }

    switch (BP.state) {
      case 'walking':  _bpWalk(dt);  break;
      case 'sitting':  _bpSit(dt);   break;
      case 'sleeping': _bpSleep(dt); break;
      default:         _bpStop(dt);
    }
  }

  /** Pick a natural next state based on planet time. */
  function _pickFoxState(planetHour, isLLMRunning) {
    if (isLLMRunning) return 'walking';
    // Deep night → sleep
    if (planetHour >= 23 || planetHour < 5) return 'sleeping';
    // Dawn / dusk → mostly sit, occasionally walk
    if (planetHour < 8 || planetHour >= 19) {
      const r = Math.random();
      return r < 0.55 ? 'sitting' : r < 0.85 ? 'stopping' : 'walking';
    }
    // Midday → mostly walk + sit
    const r = Math.random();
    return r < 0.45 ? 'walking' : r < 0.75 ? 'sitting' : 'stopping';
  }

  function _bpWalk(dt) {
    const { group, legL, legR, armL, armR, head, body, tail } = BP.parts;
    const speed = BP.walkSpeed || 1;

    // Walk cycle oscillator (4-leg gait — front/back legs alternate diagonally)
    BP.walkCycle += dt * 5.5 * speed;
    const swing = Math.sin(BP.walkCycle) * 0.55;

    legL.rotation.x = swing;          // front-left forward
    legR.rotation.x = -swing;         // front-right back
    armL.rotation.x = -swing;         // back-left back
    armR.rotation.x =  swing;         // back-right forward (diagonal pairs)
    if (head) {
      head.rotation.x = _lerp(head.rotation.x, 0, dt * 4);   // un-tuck from sleep
      head.rotation.y = Math.sin(BP.walkCycle * 0.3) * 0.12;
    }
    // Tail wags side to side while walking
    if (tail) tail.rotation.y = Math.sin(BP.walkCycle * 1.5) * 0.35;

    // ── Spherical movement along FOX_PATH great-circle arcs ──────────────
    const from = FOX_PATH[BP.pathIdx % FOX_PATH.length];
    const to   = FOX_PATH[(BP.pathIdx + 1) % FOX_PATH.length];

    // Speed along the arc — longer arcs take proportionally longer
    const arcLen = _greatCircleAngle(from.theta, from.phi, to.theta, to.phi);
    BP.pathT += (0.35 * speed * dt) / Math.max(arcLen, 0.1);

    if (BP.pathT >= 1) {
      BP.pathT = 0;
      BP.pathIdx = (BP.pathIdx + 1) % FOX_PATH.length;
    }

    // Slerp current surface position
    _slerpSphere(from.theta, from.phi, to.theta, to.phi, BP.pathT, _bpTmpUnit);
    _bpSurfacePos.copy(_bpTmpUnit).multiplyScalar(PLANET_RADIUS);

    // Forward direction = a small-step ahead along the same arc, then take
    // the chord. Projecting onto the tangent plane gives the heading vector.
    const aheadT = Math.min(1, BP.pathT + 0.02);
    _slerpSphere(from.theta, from.phi, to.theta, to.phi, aheadT, _bpForwardUnit);
    _bpForwardLocal.copy(_bpForwardUnit).multiplyScalar(PLANET_RADIUS).sub(_bpSurfacePos);

    group.position.copy(_bpSurfacePos);
    _orientOutward(group, _bpSurfacePos, _bpForwardLocal);
  }
  // Scratch vectors so _bpWalk doesn't churn the GC every frame
  const _bpSurfacePos     = new THREE.Vector3();
  const _bpForwardLocal   = new THREE.Vector3();
  const _bpTmpUnit        = new THREE.Vector3();
  const _bpForwardUnit    = new THREE.Vector3();

  function _bpSit(dt) {
    const { group, legL, legR, armL, armR, head, body, tail } = BP.parts;

    BP.sitProgress = Math.min(1, BP.sitProgress + dt * 1.5);

    // Fox sit: back legs tuck under (forward), front legs straight, head up
    legL.rotation.x = _lerp(legL.rotation.x, 0,        dt * 3);
    legR.rotation.x = _lerp(legR.rotation.x, 0,        dt * 3);
    armL.rotation.x = _lerp(armL.rotation.x, Math.PI*0.5, dt * 3);   // back legs tucked
    armR.rotation.x = _lerp(armR.rotation.x, Math.PI*0.5, dt * 3);
    // (position.y bob removed — fox stays anchored to its sphere surface point)
    // Tail curls around to one side
    if (tail) tail.rotation.y = _lerp(tail.rotation.y, 0.6, dt * 2);
    // Breathing while sitting
    const breathT = Date.now() * 0.001;
    if (body) { body.scale.x = 1 + Math.sin(breathT * 1.2) * 0.03; body.scale.y = 1 + Math.sin(breathT * 1.2) * 0.04; }
    if (head) {
      head.rotation.x = _lerp(head.rotation.x, 0, dt * 3);
      head.rotation.y = Math.sin(breathT * 0.35) * 0.4;
    }
    BP.walkCycle = 0;
  }

  /** Sleeping — curled up, slow breath, tail wraps around. */
  function _bpSleep(dt) {
    const { group, legL, legR, armL, armR, head, body, tail } = BP.parts;

    // Tuck all 4 legs forward (no position.y bob — anchored to sphere surface)
    void group;   // referenced to keep destructure intentional
    legL.rotation.x  = _lerp(legL.rotation.x, -1.1, dt * 1.5);
    legR.rotation.x  = _lerp(legR.rotation.x, -1.1, dt * 1.5);
    armL.rotation.x  = _lerp(armL.rotation.x, -1.1, dt * 1.5);
    armR.rotation.x  = _lerp(armR.rotation.x, -1.1, dt * 1.5);
    // Head drops down (chin tucked)
    if (head) {
      head.rotation.x = _lerp(head.rotation.x, 0.55, dt * 1.5);
      head.rotation.y = 0;
    }
    // Tail curls forward to wrap body
    if (tail) tail.rotation.y = _lerp(tail.rotation.y, 1.6, dt * 1.5);

    // Slow deep breathing (chest expands/contracts)
    const breathT = Date.now() * 0.0008;
    if (body) {
      body.scale.y = 1 + Math.sin(breathT) * 0.04;
      body.scale.z = 1 + Math.sin(breathT) * 0.02;
    }
    BP.walkCycle = 0;
  }

  function _bpStop(dt) {
    const { group, legL, legR, armL, armR, head, body, tail } = BP.parts;

    BP.sitProgress = Math.max(0, BP.sitProgress - dt * 2);

    // Return limbs to neutral (position anchored on sphere — don't bob)
    legL.rotation.x = _lerp(legL.rotation.x, 0, dt * 3);
    legR.rotation.x = _lerp(legR.rotation.x, 0, dt * 3);
    armL.rotation.x = _lerp(armL.rotation.x, 0, dt * 3);
    armR.rotation.x = _lerp(armR.rotation.x, 0, dt * 3);
    void group;

    // Breathing (fox version — body subtly expands)
    const breathT = Date.now() * 0.001;
    const breathAmt = Math.sin(breathT * 1.4) * 0.5;
    if (body) {
      body.scale.x = 1 + breathAmt * 0.04;
      body.scale.y = 1 + breathAmt * 0.06;
      body.position.y = 0.14 + breathAmt * 0.005;
    }
    // Tail gentle sway when idle
    if (tail) tail.rotation.y = _lerp(tail.rotation.y, Math.sin(breathT * 0.8) * 0.22, dt * 3);
    // Slow head look-around (un-tuck from sleep)
    if (head) {
      head.rotation.x = _lerp(head.rotation.x, 0, dt * 3);
      head.rotation.y = Math.sin(breathT * 0.4) * 0.35;
    }

    BP.walkCycle = 0;
  }

  /* ─── Transport vehicle animation along fixed routes ────────────────────── */

  function _tickTransports(dt) {
    discoveredMeshes.forEach(d => {
      if (!d.animRoute) return;
      const route = d.animRoute;
      const from  = route[d.routeIdx % route.length];
      const to    = route[(d.routeIdx + 1) % route.length];
      const segLen = from.distanceTo(to);

      // Animals wander slowly, vehicles move faster
      const speed = d.category === 'animal' ? 0.25 : 0.8;
      d.routeT += (speed * dt) / Math.max(segLen, 0.01);

      if (d.routeT >= 1) {
        d.routeT = 0;
        d.routeIdx = (d.routeIdx + 1) % route.length;
      }

      const pos = from.clone().lerp(to, d.routeT);
      d.group.position.x = pos.x;
      d.group.position.z = pos.z;
      d.group.position.y = 0;

      // Face direction
      const dir = to.clone().sub(from);
      if (dir.lengthSq() > 0) {
        d.group.rotation.y = Math.atan2(dir.x, dir.z);
      }

      // Wheel roll (ring acts as wheel)
      d.ring.rotation.z += dt * 4 * d.rotDir;
    });
  }

  /* ─── Math helpers ───────────────────────────────────────────────────────── */
  function _lerp(a, b, t) { return a + (b - a) * Math.min(t, 1); }

  /* ─── Events ────────────────────────────────────────────────────────────── */
  /* ─── NDC helper ────────────────────────────────────────────────────────── */
  function _toNDC(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x:  ((clientX - rect.left) / rect.width)  * 2 - 1,
      y: -((clientY - rect.top)  / rect.height) * 2 + 1,
    };
  }

  /* ─── Canvas hover — cursor + floating info card ────────────────────────── */
  let _hoveredItemName = null;     // currently-hovered discovered item

  function _onCanvasHover(e) {
    if (interactionMode !== 'none') return;
    const ndc = _toNDC(e.clientX, e.clientY);
    raycaster.setFromCamera(ndc, camera);

    const draggableGroups = discoveredMeshes.map(d => d.group);
    if (draggableGroups.length === 0) {
      renderer.domElement.style.cursor = 'default';
      if (_hoveredItemName) {
        _hoveredItemName = null;
        window.UI?.onDiscoveredItemHoverLeave?.();
      }
      return;
    }

    const hits = raycaster.intersectObjects(draggableGroups, true);
    renderer.domElement.style.cursor = hits.length ? 'grab' : 'default';

    // Resolve hit → item name (walk up to the group carrying discoveredItemName)
    let hoveredName = null;
    if (hits.length) {
      let o = hits[0].object;
      while (o && o.parent && !o.userData?.discoveredItemName) o = o.parent;
      hoveredName = o?.userData?.discoveredItemName || null;
    }

    if (hoveredName !== _hoveredItemName) {
      _hoveredItemName = hoveredName;
      if (hoveredName) {
        window.UI?.onDiscoveredItemHover?.(hoveredName, e.clientX, e.clientY);
      } else {
        window.UI?.onDiscoveredItemHoverLeave?.();
      }
    } else if (hoveredName) {
      // Same item, mouse moved — refresh tooltip position
      window.UI?.onDiscoveredItemHoverMove?.(e.clientX, e.clientY);
    }
  }

  /* ─── Mouse down — decide mode ───────────────────────────────────────────── */
  function _onMouseDown(e) {
    e.preventDefault();   // prevent browser text-select / native drag hijack
    isDrag = false;
    // Stop any residual momentum the moment the user grabs the planet again
    _spinVel.x = 0;
    _spinVel.y = 0;
    // Hide the hover preview the moment user starts interacting (drag/rotate)
    if (_hoveredItemName) {
      _hoveredItemName = null;
      window.UI?.onDiscoveredItemHoverLeave?.();
    }
    const ndc = _toNDC(e.clientX, e.clientY);
    raycaster.setFromCamera(ndc, camera);

    // Priority 1: hit a discovered item → item drag
    const draggableGroups = discoveredMeshes.map(d => d.group);
    const hits = raycaster.intersectObjects(draggableGroups, true);

    if (hits.length > 0) {
      const hitMesh = hits[0].object;
      const found = discoveredMeshes.find(d => {
        let match = false;
        d.group.traverse(m => { if (m === hitMesh) match = true; });
        return match;
      });
      if (found) {
        draggedItem = found;
        interactionMode = 'item_drag';
        draggedItem.group.scale.setScalar((draggedItem.targetScale ?? 1) * 1.2);   // lift visual
        renderer.domElement.style.cursor = 'grabbing';
        document.addEventListener('mousemove', _onDocMouseMove);
        document.addEventListener('mouseup',   _onMouseUp, { once: true });
        return;
      }
    }

    // Priority 2: rotate the planet
    interactionMode = 'planet_rotate';
    dragLast = { x: e.clientX, y: e.clientY };
    document.addEventListener('mousemove', _onDocMouseMove);
    document.addEventListener('mouseup',   _onMouseUp, { once: true });
  }

  /* ─── Document mousemove — handles drag modes ──────────────────────────── */
  function _onDocMouseMove(e) {
    if (interactionMode === 'item_drag' && draggedItem) {
      // Item-on-sphere drag: project mouse ray onto sphere surface
      isDrag = true;
      const ndc = _toNDC(e.clientX, e.clientY);
      raycaster.setFromCamera(ndc, camera);
      const surfaceHit = _raycastPlanetSurface();
      if (surfaceHit) {
        // surfaceHit is in WORLD coords. Convert into planetGroup-local coords.
        const local = planetGroup.worldToLocal(surfaceHit.clone());
        draggedItem.group.position.copy(local);
        // Re-orient using the same stable "north-aware" basis as fresh placement
        _orientOutward(draggedItem.group, local);
        // Update theta/phi cache
        const tp = _cartesianToSpherical(local);
        draggedItem.theta = tp.theta;
        draggedItem.phi   = tp.phi;
      }
      return;
    }

    if (interactionMode === 'planet_rotate') {
      const dx = e.clientX - dragLast.x;
      const dy = e.clientY - dragLast.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        isDrag = true;
        // Globe-trackball style — pre-multiply WORLD-axis rotations:
        //   dx (horizontal pixels) → spin around world Y axis
        //   dy (vertical   pixels) → tilt around world X axis
        // No clamping → full 360° freedom in every direction.
        _applySpin(dx, dy);
        // Track recent velocity so we can keep spinning after release (momentum)
        _spinVel.x = dx;
        _spinVel.y = dy;
      }
      dragLast = { x: e.clientX, y: e.clientY };
    }
  }

  /* Apply a pixel-space drag delta as world-space rotation on the planet */
  function _applySpin(dxPx, dyPx) {
    if (!planetGroup) return;
    _tmpQ.setFromAxisAngle(_AXIS_Y, dxPx * _SPIN_SENS);
    planetGroup.quaternion.premultiply(_tmpQ);
    _tmpQ.setFromAxisAngle(_AXIS_X, dyPx * _SPIN_SENS);
    planetGroup.quaternion.premultiply(_tmpQ);
  }

  /* Raycast against the planet sphere — returns the hit point in WORLD coords */
  function _raycastPlanetSurface() {
    // sphere mesh is the first child of planetGroup
    const sphereMesh = planetGroup.children[0];
    if (!sphereMesh) return null;
    const hits = raycaster.intersectObject(sphereMesh, false);
    return hits[0]?.point ?? null;
  }

  /* Cartesian (within planetGroup) → spherical (theta, phi) ─────────────── */
  function _cartesianToSpherical(p) {
    const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) || 1;
    const phi   = Math.acos(Math.max(-1, Math.min(1, p.y / r)));
    const theta = (Math.atan2(p.z, p.x) + Math.PI * 2) % (Math.PI * 2);
    return { theta, phi };
  }

  /* ─── Mouse up — cleanup ─────────────────────────────────────────────────── */
  function _onMouseUp() {
    if (interactionMode === 'item_drag' && draggedItem) {
      draggedItem.group.scale.setScalar(draggedItem.targetScale ?? 1);
      // Persist new spherical position so the user's arrangement survives reload
      window.UI?.onItemPlaced?.(draggedItem.itemName, draggedItem.theta, draggedItem.phi);
      draggedItem = null;
      renderer.domElement.style.cursor = 'grab';
    } else {
      renderer.domElement.style.cursor = 'default';
    }
    interactionMode = 'none';
    document.removeEventListener('mousemove', _onDocMouseMove);
    // isDrag stays true → _onClick checks it to skip treating drag-end as a click
  }
  function _onWheel(e) {
    frustum = Math.max(4, Math.min(15, frustum + e.deltaY * 0.012));
    _updateCamera();
  }
  function _onClick(e) {
    if (isDrag) { isDrag = false; return; }
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)   / rect.height)  * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Static landmarks are click-to-open (built-in info card).
    // Discovered items use HOVER for preview (handled in _onCanvasHover),
    // so we intentionally do NOT open a modal on click here.
    const targets = [];
    clickables.forEach(g => g.traverse(m => { if (m.isMesh) targets.push(m); }));
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return;

    let obj = hits[0].object;
    while (obj.parent && !obj.userData?.id) obj = obj.parent;
    const data = clickables.find(g => g === obj || g.getObjectById(obj.id));
    if (data) window.UI?.onLandmarkClick(data.userData);
  }
  function _onResize() {
    const wrap = document.getElementById('map-wrap');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    renderer.setSize(W, H);
    _updateCamera();
  }

  /* ─── Utility: seeded random & hue shift ───────────────────────────────── */
  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shiftHue(hex, delta) {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >>  8) & 0xff) / 255;
    const b = ( hex        & 0xff) / 255;
    return (Math.round(r * 255 + delta * 30) << 16) |
           (Math.round(g * 255 + delta * 30) <<  8) |
            Math.round(b * 255 + delta * 30);
  }

  /* ─── Public API ────────────────────────────────────────────────────────── */
  const api = {
    init,
    addDiscoveredItem,
    removeDiscoveredItem,
    highlightLandmark,
    highlightDiscoveredItem,
    getLandmarks: () => LANDMARKS,
  };

  // Must be on window so agents.js can access it
  window.SingaporeMap = api;
  return api;

})();
