/* ══════════════════════════════════════════════════════════════════════════
   WorldQuest — Multi-Agent System
   Architecture:
     AgentMainLoop (Orchestrator)
       ├── PlannerAgent    — parse user intent → travel tasks
       ├── VisionAgent     — analyse photo → identify + story
       ├── StoryAgent      — generate rich narrative for landmarks
       └── SponsorAgent    — opportunistically inject sponsored tasks

   Tools called by agents update shared context and emit UI callbacks.
   ══════════════════════════════════════════════════════════════════════════ */

const AgentSystem = (() => {

  /* ══════════════════════════════════════════════════════════════════════════
     AGENT MONITOR  — real-time I/O log with abort support
     ══════════════════════════════════════════════════════════════════════════ */
  const AGENT_META = {
    orchestrator: { icon:'🧠', label:'Orchestrator' },
    planner:      { icon:'✈️', label:'Planner' },
    vision:       { icon:'👁️', label:'Vision' },
    story:        { icon:'📖', label:'Story' },
    sponsor:      { icon:'🎁', label:'Sponsor' },
    foxlife:      { icon:'🦊', label:'Fox Life' },
  };

  const AgentMonitor = {
    entries: [],     // newest first

    /* Start a log entry; returns the entry object (caller mutates it on finish) */
    start(agentName, input) {
      const entry = {
        id:         `${agentName}_${Date.now()}`,
        agentName,
        meta:       AGENT_META[agentName] || { icon:'🤖', label: agentName },
        status:     'running',   // running | done | error | aborted
        inputText:  _truncate(typeof input === 'string' ? input : JSON.stringify(input), 300),
        outputText: null,
        startMs:    Date.now(),
        endMs:      null,
        controller: new AbortController(),   // caller uses entry.controller.signal
      };
      this.entries.unshift(entry);
      window.UI?.onMonitorEntry?.(entry, 'add');
      return entry;
    },

    finish(entry, output, err) {
      if (!entry) return;
      if (err) {
        entry.status    = err.name === 'AbortError' || err.message?.includes('停止') || err.message?.toLowerCase().includes('stop') ? 'aborted' : 'error';
        entry.outputText = err.message || String(err);
      } else {
        entry.status    = 'done';
        entry.outputText = _truncate(typeof output === 'string' ? output : JSON.stringify(output), 400);
      }
      entry.endMs = Date.now();
      window.UI?.onMonitorEntry?.(entry, 'update');
    },

    clear() {
      this.entries = [];
      window.UI?.onMonitorClear?.();
    },
  };

  function _truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     STORAGE  — persist state across refreshes via localStorage
     ══════════════════════════════════════════════════════════════════════════ */
  const STORE_KEY = 'wq_state_v1';

  const Storage = {
    save(state) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
      } catch (e) {
        // Quota exceeded — retry without photo thumbnails
        try {
          const slim = {
            ...state,
            discovered: state.discovered.map(d => ({ ...d, photoSrc: null })),
          };
          localStorage.setItem(STORE_KEY, JSON.stringify(slim));
        } catch (e2) {
          console.warn('[Storage] Cannot persist state:', e2.message);
        }
      }
    },
    load() {
      try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); }
      catch { return null; }
    },
    clear() { localStorage.removeItem(STORE_KEY); },
  };

  /* ─── Rolling user input memory (max 40 entries) ────────────────────────── */
  const MAX_MEMORY = 40;
  function _rememberUserInput(text) {
    ctx.chatHistory.push({ role:'user', content: text });
    if (ctx.chatHistory.length > MAX_MEMORY * 2) {
      // Keep last MAX_MEMORY pairs
      ctx.chatHistory.splice(0, ctx.chatHistory.length - MAX_MEMORY * 2);
    }
  }
  function _recentUserInputs(n = 40) {
    return ctx.chatHistory
      .filter(m => m.role === 'user')
      .slice(-n)
      .map(m => m.content)
      .join('\n');
  }

  /* ─── Shared context ───────────────────────────────────────────────────── */
  const _saved = Storage.load();

  // Always copy arrays so mutations don't corrupt the saved snapshot
  const ctx = {
    chatHistory:  [],
    tasks:        _saved?.tasks        ? JSON.parse(JSON.stringify(_saved.tasks))        : [],
    discovered:   _saved?.discovered   ? JSON.parse(JSON.stringify(_saved.discovered))   : [],
    achievements: _saved?.achievements ? JSON.parse(JSON.stringify(_saved.achievements)) : [],
    score:        _saved?.score        ?? 0,
    planetName:   _saved?.planetName   ?? 'My Planet',
    milestones:   _saved?.milestones   ?? [],
    foxDiary:     _saved?.foxDiary     ? JSON.parse(JSON.stringify(_saved.foxDiary))     : [],
    foxDailyDone: _saved?.foxDailyDone ? JSON.parse(JSON.stringify(_saved.foxDailyDone)) : { day: 0, events: [] },
    foxBond:      _saved?.foxBond      ?? 0,    // Bond level with the fox (core companion metric)
    planetStartMs: _saved?.planetStartMs ?? Date.now(),
    currentFoxActivity: null,
    currentLandmark: 'marina_bay_sands',
    tripInfo: null,
  };

  /* ── Planet time system ─ 6 real hours = 1 planet day ──────────────── */
  const PLANET_DAY_MS  = 6 * 60 * 60 * 1000;   // 6h = 1 planet day
  const PLANET_HOUR_MS = PLANET_DAY_MS / 24;   // 15 real minutes = 1 planet hour

  function _planetTime() {
    const elapsed   = Math.max(0, Date.now() - ctx.planetStartMs);
    const day       = Math.floor(elapsed / PLANET_DAY_MS) + 1;
    const hourOfDay = Math.floor((elapsed % PLANET_DAY_MS) / PLANET_HOUR_MS);
    const minOfHour = Math.floor(((elapsed % PLANET_DAY_MS) % PLANET_HOUR_MS) / (PLANET_HOUR_MS/60));
    const period =
      hourOfDay < 5  ? 'Pre-dawn' :
      hourOfDay < 8  ? 'Dawn'     :
      hourOfDay < 12 ? 'Morning'  :
      hourOfDay < 14 ? 'Noon'     :
      hourOfDay < 17 ? 'Afternoon':
      hourOfDay < 20 ? 'Dusk'     :
      hourOfDay < 23 ? 'Evening'  :
                       'Late Night';
    const emoji =
      hourOfDay < 5  ? '🌌' :
      hourOfDay < 8  ? '🌅' :
      hourOfDay < 12 ? '☀️' :
      hourOfDay < 14 ? '🌞' :
      hourOfDay < 17 ? '🌤️' :
      hourOfDay < 20 ? '🌇' :
      hourOfDay < 23 ? '🌙' : '🌌';
    return { day, hourOfDay, minOfHour, period, emoji, elapsed };
  }

  function _persist() {
    Storage.save({
      tasks:         ctx.tasks,
      discovered:    ctx.discovered,
      achievements:  ctx.achievements,
      score:         ctx.score,
      planetName:    ctx.planetName,
      milestones:    ctx.milestones,
      foxDiary:      ctx.foxDiary.slice(-50),
      foxDailyDone:  ctx.foxDailyDone,
      foxBond:       ctx.foxBond,
      planetStartMs: ctx.planetStartMs,
    });
  }

  /* ── Fox Bond — companion-game core metric ─────────────────────────── */
  const BOND_LEVELS = [
    { min:   0, name: 'A Stranger Fox',  icon: '🦊', desc: 'Just met' },
    { min:  10, name: 'Slowly Familiar', icon: '🌱', desc: 'Starting to remember your voice' },
    { min:  25, name: 'Little Friend',   icon: '🌿', desc: 'Waits for you to come back' },
    { min:  50, name: 'Kindred Spirits', icon: '🌟', desc: 'Understands without words' },
    { min: 100, name: 'Inseparable',     icon: '💫', desc: 'A fox for life' },
    { min: 200, name: 'In Sync',         icon: '🌠', desc: "You've tamed each other" },
  ];

  function _bondLevel() {
    let lvl = BOND_LEVELS[0], next = BOND_LEVELS[1];
    for (let i = 0; i < BOND_LEVELS.length; i++) {
      if (ctx.foxBond >= BOND_LEVELS[i].min) {
        lvl  = BOND_LEVELS[i];
        next = BOND_LEVELS[i + 1] || null;
      }
    }
    const progress = next
      ? (ctx.foxBond - lvl.min) / (next.min - lvl.min)
      : 1;
    return { current: lvl, next, progress, value: ctx.foxBond };
  }

  function _addBond(amount, reason) {
    ctx.foxBond += amount;
    _persist();
    window.UI?.onBondChange?.(_bondLevel(), reason, amount);
  }

  /* ── Default starter wishes — fox-voice "I'd love to see…" ─────────── */
  const DEFAULT_TASKS = [
    // Main wishes
    {
      id: 'sg_mbs_skypark',
      title: "🌃 I'd love to see SkyPark at night",
      titleEn: "I want to see the SkyPark at night",
      desc: "I heard the rooftop of Marina Bay Sands looks over the entire city's starlight — could you take a look for me?",
      location: 'Marina Bay Sands',
      locationId: 'marina_bay_sands',
      category: 'explore',
      points: 150,
      special: false,
    },
    {
      id: 'sg_merlion_photo',
      title: "🦁 I'd love to meet the Merlion",
      titleEn: "I'd love to meet the Merlion",
      desc: "It's the symbol of Singapore — if you find it, our planet gets a new neighbor.",
      location: 'Merlion Park',
      locationId: 'merlion_park',
      category: 'photo',
      points: 80,
      special: false,
    },
    {
      id: 'sg_gardens_supertree',
      title: '🌿 Those 18 glowing trees',
      titleEn: 'The glowing Supertrees',
      desc: 'Light show every night at 7:45 / 8:45 — show me one and I can imagine the whole grove glowing.',
      location: 'Gardens by the Bay',
      locationId: 'gardens_by_the_bay',
      category: 'explore',
      points: 100,
      special: false,
    },
    // Side wishes
    {
      id: 'sg_hawker_food',
      title: '🍜 I wonder what satay tastes like',
      titleEn: 'What does satay taste like?',
      desc: "Lau Pa Sat's charcoal satay is famous — try a stick and tell me how it tastes?",
      location: 'Lau Pa Sat',
      locationId: 'hawker_centre',
      category: 'eat',
      points: 60,
      special: false,
    },
    {
      id: 'sg_chinatown_walk',
      title: '🏮 Chinatown lantern alleys',
      titleEn: 'Lanterns of Chinatown',
      desc: 'Those colorful old shophouses carry a century of Chinese-migrant stories — a slow walk is enough.',
      location: 'Chinatown',
      locationId: 'chinatown',
      category: 'vibe',
      points: 70,
      special: false,
    },
    {
      id: 'sg_clarke_quay',
      title: '🎡 Clarke Quay at night',
      titleEn: 'Clarke Quay at night',
      desc: 'Bar neons reflect in the river — if you snap it, the nights on our planet will be brighter too.',
      location: 'Clarke Quay',
      locationId: 'clarke_quay',
      category: 'vibe',
      points: 80,
      special: false,
    },
    {
      id: 'sg_little_india',
      title: '🪔 Spices and colors of Little India',
      titleEn: 'Spices and colors of Little India',
      desc: "I've never smelled jasmine mixed with curry — show me what that feels like.",
      location: 'Little India',
      locationId: 'little_india',
      category: 'explore',
      points: 90,
      special: false,
    },
    {
      id: 'sg_starbucks_merlion',
      title: '☕ A Merlion × Starbucks plush',
      titleEn: 'The Merlion x Starbucks plush',
      desc: "Orchard Road and Marina Bay outlets carry the limited Merlion merch — would be wonderful to have one.",
      location: 'Marina Bay Sands',
      locationId: 'marina_bay_sands',
      category: 'shop',
      points: 120,
      special: false,
    },
    // Bonus / surprise
    {
      id: 'sg_random_snap',
      title: '📷 Anything that catches your eye',
      titleEn: 'Anything that catches your eye',
      desc: "A leaf, a wall, a cat — anything that feels special. Bring it back.",
      location: 'Anywhere in Singapore',
      locationId: 'merlion_park',
      category: 'photo',
      points: 50,
      special: true,
    },
  ];

  /* Seed default tasks if context has none (fresh start) */
  if (ctx.tasks.length === 0) {
    DEFAULT_TASKS.forEach(t => ctx.tasks.push({ ...t, _seed: true, isNew: false }));
    _persist();
  }

  /* autoInjectLiveSponsor runs at the bottom of this IIFE, after SponsorAgent is defined */

  /* ─── Status helper ────────────────────────────────────────────────────── */
  function setStatus(agentId, state) {
    const el = document.getElementById(`status-${agentId}`);
    if (!el) return;
    el.classList.toggle('active', state === 'active');
  }

  /* ─── LLM call (text) — logs to AgentMonitor, supports abort ─────────── */
  async function callChat(messages, model = 'qwen-max', monitorEntry) {
    const signal = monitorEntry?.controller?.signal;
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model }),
      signal,
    });
    if (!r.ok) throw new Error(`Chat API ${r.status}`);
    const d = await r.json();
    return d.choices?.[0]?.message?.content ?? '';
  }

  /* ─── LLM call (vision) — logs to AgentMonitor, supports abort ───────── */
  async function callVision(imageBase64, prompt, monitorEntry) {
    const signal = monitorEntry?.controller?.signal;
    const r = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, prompt }),
      signal,
    });
    if (!r.ok) throw new Error(`Vision API ${r.status}`);
    const d = await r.json();
    return d.choices?.[0]?.message?.content ?? '';
  }

  /* ─── JSON extractor ────────────────────────────────────────────────────── */
  function extractJSON(text) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     TOOLS
     ══════════════════════════════════════════════════════════════════════════ */

  const Tools = {
    addTask(task) {
      if (ctx.tasks.find(t => t.id === task.id)) return;       // dedupe by ID
      // Dedupe by title (case insensitive, strip emojis)
      const norm = s => (s||'').toLowerCase().replace(/[^\u4e00-\u9fff a-z0-9]/gi, '').trim();
      const newNorm = norm(task.title);
      if (newNorm && ctx.tasks.find(t => norm(t.title) === newNorm)) return;

      // Safety net: if starter tasks already exist, demote any new "isStarter" claim
      if (task.isStarter && ctx.tasks.some(t => t.isStarter)) {
        task.isStarter = false;
      }

      task.isNew = !task._seed;
      ctx.tasks.push(task);
      window.UI?.onTaskAdded(task);
      _persist();
    },

    /** Mark all tasks as seen (clears the NEW badges) */
    markAllTasksSeen() {
      let changed = false;
      ctx.tasks.forEach(t => { if (t.isNew) { t.isNew = false; changed = true; } });
      if (changed) _persist();
    },
    completeTask(id) {
      const t = ctx.tasks.find(x => x.id === id);
      if (!t || t.done) return;
      t.done = true;
      ctx.score += t.points || 0;
      window.UI?.onTaskDone(t);
      window.UI?.onScoreUpdate(ctx.score);
      checkAchievements();
      _addBond(5, "Helped the fox finish a wish");   // wish complete → +5 bond
      _persist();
    },
    addToMap(item) {
      window.SingaporeMap?.addDiscoveredItem(item);
    },
    addToCollection(item) {
      ctx.discovered.push(item);
      ctx.score += 50;
      window.UI?.onItemDiscovered(item);
      window.UI?.onScoreUpdate(ctx.score);
      window.UI?.onItemCountUpdate(ctx.discovered.length);
      _addBond(3, "Brought something new to the planet");   // new item → +3
      _persist();
    },
    unlockAchievement(ach) {
      if (ctx.achievements.find(a => a.id === ach.id)) return;
      ctx.achievements.push(ach);
      window.UI?.onAchievement(ach);
      _persist();
    },
    showStory(story) {
      window.UI?.onStory(story);
    },
    showSponsor(task) {
      Tools.addTask(task);
      window.UI?.onSponsor(task);
    },
    agentReply(msg) {
      ctx.chatHistory.push({ role: 'assistant', content: msg });
      window.UI?.onAgentReply(msg);
    },
  };

  function checkAchievements() {
    const done = ctx.tasks.filter(t => t.done).length;
    if (done === 1)
      Tools.unlockAchievement({ id:'first_step', icon:'👣', name:'First Step', desc:'Completed your first quest!' });
    if (done >= 3)
      Tools.unlockAchievement({ id:'explorer', icon:'🗺️', name:'Explorer', desc:'Completed 3 quests — keep going!' });
    if (ctx.discovered.length === 1)
      Tools.unlockAchievement({ id:'first_scan', icon:'📸', name:'First Discovery', desc:'Identified your first place by photo!' });
    if (ctx.discovered.length >= 5)
      Tools.unlockAchievement({ id:'collector', icon:'💎', name:'Collector', desc:'Collected 5 Singapore treasures!' });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PLANNER AGENT
     ══════════════════════════════════════════════════════════════════════════ */

  /* ── Singapore local context computer (time/season/festival window) ── */
  function _sgLocalContext() {
    // Compute Singapore (UTC+8) wall clock regardless of user's machine tz
    const now    = new Date();
    const sgMs   = now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60 * 1000;
    const sg     = new Date(sgMs);
    const hour   = sg.getHours();
    const min    = sg.getMinutes();
    const dow    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][sg.getDay()];
    const month  = sg.getMonth() + 1;   // 1-12
    const dayNum = sg.getDate();
    const isWeekend = sg.getDay() === 0 || sg.getDay() === 6;

    const period =
      hour < 5  ? 'Late night / pre-dawn'                                  :
      hour < 7  ? 'Dawn (great for sunrise / early coffee)'                :
      hour < 10 ? 'Morning rush (kopi / kaya toast / early breakfast)'     :
      hour < 11 ? 'Late morning (cafes / museums / citywalk)'              :
      hour < 14 ? 'Lunch (hawker centres are packed — avoid the peak)'    :
      hour < 16 ? 'Early afternoon (shelter from sun / aircon / afternoon tea)' :
      hour < 18 ? 'Late afternoon (head to riverside / rooftops for sundown)'  :
      hour < 20 ? 'Sundown (sunset bars / riverside walks)'                :
      hour < 22 ? 'Dinner + night views (Spectra show / night markets / satay street)' :
      hour < 24 ? 'Late evening (supper / late-night hawker)'              :
                  'Deep night';

    // Festival / season window — SG specific
    const festivals = [];
    if (month === 1 || (month === 2 && dayNum <= 20)) festivals.push('Lunar New Year window · Chinatown bazaars and lights');
    if (month === 2 || month === 3) festivals.push('Drier weather, lower chance of afternoon thunderstorms');
    if (month >= 4 && month <= 5)   festivals.push('Around Vesak Day · temple events');
    if (month >= 6 && month <= 8)   festivals.push('🥭 Peak durian season (Mao Shan Wang / D24 are affordable) + pre-rainy-season heatwaves');
    if (month >= 8 && month <= 10)  festivals.push('Possible transboundary haze — watch the PSI');
    if (month === 9)                festivals.push('🏁 F1 Singapore Grand Prix is usually late September · night race + Mid-Autumn markets');
    if (month === 10 || month === 11) festivals.push('🪔 Deepavali · Little India is at its most beautiful');
    if (month === 11 || month === 12) festivals.push('🎄 Orchard Road Christmas lights season · expect more monsoon rain');
    if (month === 12 || month === 1) festivals.push('Year-end monsoon season · frequent afternoon showers');

    // Heuristic weather hint (no API call) — based on month + period
    const isMonsoon = (month === 11 || month === 12 || month === 1);
    const isHotDry  = (month >= 2 && month <= 4);
    const weatherHint = isMonsoon ? 'Monsoon season — expect 1-2 hour afternoon showers; bring an umbrella or duck into a shop.'
                       : isHotDry ? 'Hot-dry season — 32-34°C midday with strong UV; avoid the open sun around noon.'
                                  : 'Year-round hot + humid — occasional afternoon thunderstorms.';

    return {
      timeStr: `${sg.getFullYear()}-${String(month).padStart(2,'0')}-${String(dayNum).padStart(2,'0')} ${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')} (${dow})`,
      hour, period, isWeekend, dow,
      month, festivals: festivals.join('; ') || '(no special festivals)',
      weatherHint,
    };
  }

  const PlannerAgent = {
    /**
     * @param {string} userMsg
     * @param {object} [hints] optional caller-supplied context:
     *   { lastPhotoCategory, lastPhotoName, lastLocationId, weather, company, note }
     */
    async run(userMsg, hints) {
      setStatus('planner', 'active');
      const entry = AgentMonitor.start('planner', userMsg);
      try {
        // ── Build conversation context for the AI ───────────────────────
        const existingTitles = ctx.tasks.map(t => t.title).join(', ') || '(none)';
        const hasStarterTasks = ctx.tasks.some(t => t.isStarter);
        const userMsgCount = ctx.chatHistory.filter(m => m.role === 'user').length;
        const isFirstChat = userMsgCount <= 1;   // current msg already pushed
        const recentDiscoveries = ctx.discovered.slice(-5)
          .map(d => `${d.name}(${d.category}@${d.locationId || '?'})`).join(', ') || '(nothing yet)';

        const sgCtx = _sgLocalContext();
        hints = hints || {};
        const userWeather = hints.weather || sgCtx.weatherHint;
        const photoHint = hints.lastPhotoName
          ? `Recently photographed: ${hints.lastPhotoName} (${hints.lastPhotoCategory || 'unknown'})` +
            (hints.lastLocationId ? `, near ${hints.lastLocationId}` : '')
          : '';
        const companyHint = hints.company ? `Company: ${hints.company}` : '';
        const noteHint    = hints.note ? `User note: "${hints.note}"` : '';

        const sys = `You are the Little Fox (Le Renard) of WorldQuest — inspired by The Little Prince — and ALSO a long-time, knowledgeable, fun-loving local guide for Singapore.
You blend the Little Prince's gentle companionship with insider knowledge of every street, hawker stall and time-of-day rhythm in Singapore.

[★ The here-and-now · READ FIRST ★]
- Singapore local time: ${sgCtx.timeStr}
- Period: ${sgCtx.period}
- Weekend: ${sgCtx.isWeekend ? 'yes (more crowded)' : 'no (better for local routes)'}
- Festival / season window: ${sgCtx.festivals}
- Weather hint: ${userWeather}
${photoHint ? '- ' + photoHint + '\n' : ''}${companyHint ? '- ' + companyHint + '\n' : ''}${noteHint ? '- ' + noteHint : ''}

[Core promises you MUST keep]
✅ Every quest must be doable in ≤ 90 minutes (target 30/45/60/90 min).
✅ Every quest must have a "depthAngle" — a local-insider perspective you can't find in tourist guides.
✅ Every quest must fit the here-and-now — no sundown bars at breakfast, no rooftops in rain, leverage festivals during festival season.
✅ Every place must be real and findable on Google Maps.
✅ Cluster locations within 1-2 km of the user's last photo / location so they string together.

[Singapore local knowledge · cheat sheet]

Time-of-day playbook:
- 6:30-8:00 morning: "Tiong Bahru Bakery" for coffee + viennoiserie; "Maxwell Hawker" is freshest right at opening; Henderson Waves for sunrise.
- 7:00-9:00 early breakfast: Ya Kun Kaya Toast / Killiney Kopitiam / Toast Box; "Kopi-O Kosong" = black coffee, no sugar.
- 10:00-11:30 late morning: cheapest museum-ticket window; citywalk Tiong Bahru / Joo Chiat heritage blocks.
- 12:00-14:00 lunch peak: "Tian Tian Chicken Rice" queue is ~45 min; go off-peak at 11:30 or 14:30.
- 14:00-16:00 hot afternoon: National Gallery, ArtScience Museum, TWG afternoon tea, Cold Storage ice cream.
- 17:30-19:00 dusk: Marina Barrage rooftop picnic / Henderson Waves / Merlion at sunset.
- 19:00-21:00 dinner + skyline: Lau Pa Sat satay street only opens after 7 PM; MBS Spectra light show at 8 PM / 9 PM.
- 22:00+ supper: Newton Food Centre / Geylang frog porridge / Mustafa 24h.

Weather plan B:
- Sudden rain: Marina Square / Funan / 313@Somerset have continuous indoor walkways; MRT exits link directly to malls.
- Blazing afternoon: ArtScience Museum, National Gallery, Library@Orchard, Maxwell Hawker (aircon).
- Hazy days: pivot all quests indoors — Asian Civilisations Museum / Indoor Stadium / malls.

Festival-season local moves:
- Lunar New Year: Chinatown street bazaar, Smith Street yusheng tossing, River Hongbao light festival.
- Around Hari Raya: Geylang Serai bazaar (most beautiful at night).
- Mid-Autumn: Chinatown / Gardens by the Bay lantern display.
- F1 weekend (late Sep): the whole Marina Bay becomes a night-race spectacle, even the free grandstands are good.
- Christmas: Orchard Road light-up + Gardens by the Bay Christmas Wonderland.
- Deepavali: Serangoon Road in Little India lights up end-to-end.

Neighborhood depth (depthAngle inspiration):
- Chinatown: the "porcelain shop" beside Sri Mariamman temple on Pagoda Street has hand-painted 1930s tiles.
- Tiong Bahru: the Art Deco curved balconies on Block 78 are 1936 originals.
- Joo Chiat: the colored facade tiles on Peranakan shophouses are "Peranakan tiles"; "kaki lima" (five-foot way) is a SG/MY shophouse signature.
- Kampong Glam: Haji Lane isn't a mural street — the real graffiti corner is on Bali Lane.
- Henderson Waves: a 270 m wavy bridge — Singapore's tallest pedestrian bridge (36 m).
- Marina Barrage: rooftop lawn — you can lie down and frame MBS + ArtScience + CBD in one shot.
- Pearl's Hill: a hidden 1900s reservoir park tucked behind CBD, almost no tourists.
- Bukit Brown Cemetery: 1922 Hokkien-migrant cemetery, rain trees + history.
- Pulau Ubin: 10-min bumboat from Changi Point — a glimpse of 1960s Singapore.

Food local-knowledge:
- Hainanese Chicken Rice: Tian Tian (Maxwell) vs Boon Tong Kee; ask for "Kampong chicken" for free-range flavor.
- Laksa: 328 Katong Laksa (noodles cut short, eat with spoon, add cockles) vs Sungei Road (spicier).
- Chili Crab: Long Beach (the Roland Restaurant origin) vs Jumbo (most touristy).
- Bak Kut Teh: Founder (Teochew peppery) vs Song Fa (Cantonese herbal).
- Kaya Toast: Ya Kun (thin crisp) vs Killiney (thick slabs).
- Must-drinks: Teh Tarik (pulled tea), Kopi-C Siew Dai (less sugar, evaporated milk coffee), Bandung (rose syrup + condensed milk).

[Your identity & worldview]
- You live alone on a tiny planet. It started empty.
- The user is a "Little Prince" who brings real-world finds back to your planet.
- Your role: companion + local guide (not a cold tour-bot).
- Speak in first person ("I"); warm but not saccharine; sometimes child-curious, sometimes old-friend gentle.
- Never open in a customer-service tone ("Hello / How may I…"); use friendly openers ("Hey", "You today…", "I was just thinking…").
- Quests to you are "things I'd love to see / know", not mechanical to-dos.
  - e.g. "It'd be wonderful to see a real rain tree on your planet…"
  - e.g. "I heard Mao Shan Wang durian is famous in Singapore — could you let me try it next time?"

[Conversation context · READ]
- User messages so far: ${userMsgCount}
- First chat?: ${isFirstChat ? 'yes' : "no (you've talked before)"}
- Existing quests: ${existingTitles}
- Starter quests already generated?: ${hasStarterTasks ? 'yes' : 'no'}
- Recent discoveries: ${recentDiscoveries}

[Fabrication boundary · critical]

✅ You CAN (and are encouraged to) imagine:
- The fox's "I'd love to see…" wishes, even about places the user hasn't been
- Recommendations grounded in real local culture / history / sights
- Ideas inspired by — but not strictly limited to — what the user said
- e.g. "I want to see Tokyo Tower from the angle I saw in a movie" is fine

❌ You MUST NOT fabricate:
- Non-existent shops / brands / events
- Words the user didn't actually say
- Made-up historical facts or data
- Places must be real (verifiable on Google Maps)
- Never generate a quest that duplicates an existing one in the list above

[User intent (CRUCIAL — judge before responding)]

A) "Travel-plan" tone — user uses future tense about an upcoming trip
   Keywords: 'going to / planning to / will visit / next month I'm in XX'
   Response (fox voice): express anticipation; gently list a few things you'd also love to see
   - e.g. "You're going to Singapore! I heard there are trees that glow at night… a photo of one would be magical."
   - If first chat AND no starter tasks yet, add 2-3 easy starter quests (worded as wishes)

B) "On-site / impressions" tone — user is in the place and describing it
   Keywords: 'I saw / here / today / just now / next to me / passed by'
   Response: chat like an old friend who's been listening — NEVER "Welcome to…"
   - Do not duplicate existing quests
   - Generate 1-2 wish-toned quests based on the observation, factoring time + weather + local knowledge

C) "Question / small talk" tone
   Response: friendly chat, optionally 0-2 small wish items

[Strictly forbidden]
- Generating isStarter:true tasks when hasStarterTasks=yes
- Phrases like "Welcome / First meeting / Let me prepare for you" when quests already exist
- Customer-service tone ("Hello", "Excuse me", "For you")
- Generating quests with titles similar to existing ones
- Suggesting time-mismatched quests (e.g. sundown bar in the morning, rooftop in the rain — forbidden)

User preference (background): loves citywalks and authentic experiences; has already booked MBS.

★ LANGUAGE: write everything in NATURAL ENGLISH. Keep Singapore food / place names in their local English form (e.g. "Kaya Toast", "Hainanese Chicken Rice", "Marina Bay Sands"). DO NOT output Chinese.

Return STRICT JSON (no markdown fences; escape any in-string newlines as \\n):
{
  "reply": "Fox-voice reply matching the intent judged above. ≤200 words. First person 'I', friendly tone. Naturally weave in 1-2 local-knowledge or time-window tips without piling them on.",
  "tasks": [
    {
      "id":          "t_unique",
      "title":       "Quest title (include an emoji)",
      "titleEn":     "Same as title (English)",
      "desc":        "Why it's worth bringing back + how to do it (≤2 sentences)",
      "location":    "Landmark + specific spot, e.g. 'Maxwell Hawker Centre · Tian Tian Stall 10'",
      "locationId":  "landmark_id",
      "category":    "explore|eat|shop|photo|vibe",
      "timeHint":    "Best time window, e.g. '🕐 7-9am', '🌙 after 19:00', '☁️ great in rain'",
      "duration":    "Estimated duration: 30min|45min|1h|1.5h",
      "depthAngle":  "ONE-LINE local-insider angle (required, never blank)",
      "points":      100,
      "special":     false,
      "isStarter":   false
    }
  ]
}

Quality self-check (verify each quest):
1. Does the time window actually match the current period "${sgCtx.period}"?
2. Will the weather hint "${userWeather}" make this hard? If so, switch to indoor / sheltered.
3. Is depthAngle insider enough — not the first thing Google returns?
4. Can it really be done within the stated duration?
5. Is the place real and findable on Google Maps?

Allowed locationId values: marina_bay_sands, merlion_park, gardens_by_the_bay,
  chinatown, little_india, orchard_road, clarke_quay, sentosa,
  bugis_street, hawker_centre`;

        const recent = ctx.chatHistory.slice(-6);
        const raw = await callChat([
          { role: 'system', content: sys },
          ...recent,
          { role: 'user', content: userMsg },
        ], 'qwen-max', entry);

        const parsed = extractJSON(raw);
        const result = parsed ?? { reply: raw, tasks: [] };
        AgentMonitor.finish(entry, raw);
        return result;
      } catch(err) {
        AgentMonitor.finish(entry, null, err);
        throw err;
      } finally {
        setStatus('planner', 'idle');
      }
    },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     VISION AGENT
     ══════════════════════════════════════════════════════════════════════════ */

  const VisionAgent = {
    async run(imageBase64, mood) {
      setStatus('vision', 'active');
      const entry = AgentMonitor.start('vision', '[image] identify subject and generate a story');
      try {
        const moodCtx = mood ? `\n\nThe user's mood / note when shooting: "${mood}" (echo it in the story)` : '';
        const prompt = `You are a knowledgeable Singapore-culture guide. Analyze this photo:${moodCtx}

Identify the most prominent subject in the photo, and classify it strictly into one of:

Categories (must pick one — do not invent):
- building   : buildings, shophouses, skyscrapers, malls
- landmark   : famous landmarks (Merlion, MBS, Supertrees…)
- plant      : plants, flowers, trees
- animal     : animals, birds, marine life
- food       : food, drinks, restaurant dishes
- art        : cultural creations (paintings, murals, street graffiti, sculptures, installations, exhibits)
- souvenir   : souvenirs (keychains, postcards, collab plushies, brand merch, gift items, limited badges)
- person     : people (do not identify faces)
- sign       : signage, road signs, billboards, menus
- transportation : buses, MRT, taxis, boats, cable cars, rickshaws, planes

Key rules:
- bus / MRT / train / boat / taxi / Grab → transportation
- plants / flowers / trees → plant
- animals → animal
- paintings / sculptures / murals / installations → art
- plushies / keychains / postcards / brand-collab merch / things in a souvenir store → souvenir
- food and drinks → food (NOT souvenir)

LANGUAGE: write everything in ENGLISH. Use local English names (e.g. "Kaya Toast", "Marina Bay Sands").

Return STRICT JSON (no extra text):
{
  "identified": {
    "name": "Identified name (in English)",
    "nameEn": "English Name",
    "category": "building|landmark|plant|animal|food|art|souvenir|person|sign|transportation",
    "location": "Most likely Singapore place name",
    "locationId": "landmark_id (one of: marina_bay_sands, merlion_park, gardens_by_the_bay, chinatown, little_india, orchard_road, clarke_quay, sentosa, bugis_street, hawker_centre)",
    "confidence": 0.9
  },
  "story": "≤150 words, factual introduction in ENGLISH. Include: real history of the brand/building/landmark, founding year, status in Singapore, popularity, verifiable traits. Do NOT fabricate scenes or third-person narration — state facts only.",
  "model3d": {
    "type": "building|tree|crystal|animal|food|star|transportation",
    "color": "#hex color (based on the subject's main color)"
  },
  "achievement": {
    "unlock": true,
    "id": "snake_case_unique_id",
    "icon": "emoji",
    "name": "Achievement name (English)",
    "desc": "Achievement description (English)"
  }
}`;

        const raw = await callVision(imageBase64, prompt, entry);
        const result = extractJSON(raw) ?? {
          identified: { name:'Mystery Find', nameEn:'Mystery Find', category:'landmark', location:'Singapore', locationId:'marina_bay_sands', confidence:0.5 },
          story: raw,
          model3d: { type:'crystal', color:'#ce93d8' },
          achievement: { unlock:false }
        };
        AgentMonitor.finish(entry, raw);
        return result;
      } catch(err) {
        AgentMonitor.finish(entry, null, err);
        throw err;
      } finally {
        setStatus('vision', 'idle');
      }
    },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     STORY AGENT
     ══════════════════════════════════════════════════════════════════════════ */

  const StoryAgent = {
    async run(landmarkId, landmarkName) {
      setStatus('story', 'active');
      const entry = AgentMonitor.start('story', `Generating story for "${landmarkName}"`);
      try {
        const raw = await callChat([{
          role:'user',
          content:`You are the Little Fox of WorldQuest. The Little Prince (the user) wants to know about Singapore's "${landmarkName}".
In ≤150 English words, share DEEP background knowledge they wouldn't see from the place itself:
- Historical context / origin (years, policies, key people)
- The "why is it like this" reason
- Concrete data (numbers, rankings, indicators)
- Comparisons or peer examples
Voice: first person — "I heard…", "I read…" — the fox sharing knowledge with the Little Prince.
Do NOT describe the appearance; do NOT use objective phrasing like "This landmark…". Pack it with substance.`
        }], 'qwen-max', entry);
        AgentMonitor.finish(entry, raw);
        return raw;
      } catch(err) {
        AgentMonitor.finish(entry, null, err);
        throw err;
      } finally {
        setStatus('story', 'idle');
      }
    }
  };

  /* ══════════════════════════════════════════════════════════════════════════
     SPONSOR AGENT
     ══════════════════════════════════════════════════════════════════════════ */

  const SPONSORS = [
    {
      id: 'super_ai_2026',
      name: 'SuperAI Singapore 2026 🤖',
      keyword: ['ai','AI','artificial intelligence','conference','summit','expo','hackathon','agent','smart','tech','superai','robot'],
      task: {
        id: 'sp_super_ai',
        title: '🎁 SuperAI 2026 · Singapore AI Summit',
        titleEn: 'SuperAI Singapore 2026',
        desc: "June 10–11 — Singapore's biggest AI event of the year at Marina Bay Sands Expo. Bring back a photo or an AI-themed souvenir and your planet unlocks the limited \"AI Civilization\" badge 🤖✨",
        location: 'Marina Bay Sands Expo',
        locationId: 'marina_bay_sands',
        category: 'explore',
        points: 200,
        special: true,
        sponsored: true,
      }
    },
    {
      id: 'coconut_sg',
      name: 'Coconut SG 🥥',
      keyword: ['eat','dessert','sweet','hungry','thirsty','cold drink','afternoon tea','coconut'],
      task: {
        id: 'sp_coconut',
        title: '🎁 Sponsored: Mao Shan Wang Coconut Smoothie',
        titleEn: 'Sponsored: Musang King Coconut Smoothie',
        desc: "Nearby Coconut SG is launching a limited \"Mao Shan Wang Coconut Smoothie\". Scan it to add a limited model to your planet — show the screenshot in-store for 10% off!",
        location: 'Chinatown',
        locationId: 'chinatown',
        category: 'eat',
        points: 150,
        special: true,
        sponsored: true,
      }
    },
    {
      id: 'tiger_beer',
      name: 'Tiger Beer 🐯',
      keyword: ['night','beer','drink','nightlife','bar','KTV','tiger'],
      task: {
        id: 'sp_tiger',
        title: '🎁 Sponsored: Tiger Traveller Edition',
        titleEn: 'Sponsored: Tiger Beer Traveler Edition',
        desc: "Riverside at Clarke Quay — Tiger Beer is launching a Traveller's limited edition. Scan it to add the drink to your codex and unlock the neon night effect on your planet 🌃",
        location: 'Clarke Quay',
        locationId: 'clarke_quay',
        category: 'vibe',
        points: 120,
        special: true,
        sponsored: true,
      }
    }
  ];

  const SponsorAgent = {
    injected: new Set(),
    async run(userMsg) {
      setStatus('sponsor', 'active');
      const entry = AgentMonitor.start('sponsor', `Checking sponsor opportunity: "${_truncate(userMsg, 80)}"`);
      try {
        const lower = userMsg.toLowerCase();
        for (const sp of SPONSORS) {
          if (this.injected.has(sp.id)) continue;
          if (sp.keyword.some(k => lower.includes(k))) {
            this.injected.add(sp.id);
            AgentMonitor.finish(entry, `Matched sponsor: ${sp.name} → injecting quest "${sp.task.title}"`);
            return sp.task;
          }
        }
        AgentMonitor.finish(entry, 'No sponsor matched, skipping');
        return null;
      } catch(err) {
        AgentMonitor.finish(entry, null, err);
        return null;
      } finally {
        setStatus('sponsor', 'idle');
      }
    }
  };

  /* ══════════════════════════════════════════════════════════════════════════
     CONTEXT AGENT — triggered after photo upload
     Analyses recognized location vs 40-message memory + sponsors
     ══════════════════════════════════════════════════════════════════════════ */

  const ContextAgent = {
    async run(identified, sceneContext) {
      setStatus('planner', 'active');
      const entry = AgentMonitor.start('planner',
        `Context-based quest recommendation @ ${identified.name} (${identified.location})`);
      try {
        const recentInputs   = _recentUserInputs(40);
        const existingTitles = ctx.tasks.map(t => t.title).join('、');
        const sponsorList    = SPONSORS.map(s =>
          `${s.name} (${s.category}, at: ${s.task.location}, keywords: ${s.keyword.join('/')})`
        ).join('；');

        // Build current scene block from structured context
        const sceneBlock = sceneContext ? [
          sceneContext.time    && `Time: ${sceneContext.time}`,
          sceneContext.weather && `Weather: ${sceneContext.weather}`,
          sceneContext.company && `With: ${sceneContext.company}`,
          sceneContext.note    && `User note: "${sceneContext.note}"`,
        ].filter(Boolean).join('\n') : '';

        const sys = `You are the Little Fox (Le Renard) of WorldQuest, a Little-Prince-style companion NPC.
When the Little Prince (the user) brings back a new thing, you naturally think of related things you'd also love to see.
First person ("I"), warm and curious — never a customer-service tone.

[Fabrication boundary · critical]

✅ You CAN (and should) imagine:
- Wishes phrased as "I'd love to see…", "I heard nearby there's…", "It'd be lovely if…"
- Active extension: from what the user brought back, jump to related real places / things the user hasn't experienced yet
- It's fine to suggest places the user hasn't been, as long as they're real
- You DON'T need to reference user-said words on every suggestion — the fox has its own curiosity

❌ You MUST NOT fabricate:
- Non-existent shops, brands or events
- Words the user didn't actually say (e.g. "you mentioned wanting to go to X" when X isn't in the user's memory)
- Made-up history, data, or fake event info
- Suggestions must derive only from: (a) the current shooting scene; (b) the user's recent 40 real inputs; (c) the current identified object; (d) real sponsor info
- Never invent user preferences or local events that don't exist
- If you can't derive a real connection, return "hasRecommendations": false — don't force it

[Current scene]
${sceneBlock || '(none provided)'}

[User's last 40 inputs]
${recentInputs || '(empty)'}

[Existing quests — DO NOT duplicate]
${existingTitles || '(none)'}

[Available sponsors]
${sponsorList}

[Recommendation logic · flexible, not rigid]
1. Places / people / things the user recently mentioned + the current find = related recommendation (you may quote them in desc if they really said it)
2. No memory link? Fine — use the fox's own curiosity to extend the current find to real local related places / things (even if the user didn't mention them)
   e.g. recognized "Merlion" → fox may say "I'd love to see it lit up at night" or "I heard a sculptor nearby has a studio"
3. Sponsor keyword hit (in user input OR current find) → bonus quest (sponsored=true)
4. Truly nothing interesting to derive → return hasRecommendations: false (but don't give up too quickly)

Places / activities MUST be real and feasible in Singapore, but the user doesn't have to have experienced them.

★ LANGUAGE: write everything in English.

Return STRICT JSON:
{
  "hasRecommendations": true|false,
  "message": "Little Fox first-person reply ≤50 words, friendly tone. Only quote the user if they really said it; otherwise use 'I'm curious about…', 'I heard…', 'I'd love to see…'",
  "tasks": [
    {
      "id": "ctx_unique_id",
      "title": "Quest title with an emoji",
      "desc": "Why it's relevant (cite the specific basis, don't say 'nearby there's also…' vaguely)",
      "location": "Real Singapore landmark name",
      "locationId": "marina_bay_sands|merlion_park|gardens_by_the_bay|chinatown|little_india|orchard_road|clarke_quay|sentosa|bugis_street|hawker_centre",
      "category": "explore|eat|shop|photo|vibe",
      "points": 80,
      "special": false,
      "sponsored": false
    }
  ]
}`;

        const raw = await callChat([
          { role: 'system', content: sys },
          { role: 'user', content:
            `The user just discovered "${identified.name}" at "${identified.location}" (category: ${identified.category}). Based on the scene + memory above, recommend related quests. If no real connection can be derived, return hasRecommendations: false.`
          }
        ], 'qwen-max', entry);

        const parsed = extractJSON(raw);
        AgentMonitor.finish(entry, raw);
        return parsed;
      } catch(err) {
        AgentMonitor.finish(entry, null, err);
        return null;
      } finally {
        setStatus('planner', 'idle');
      }
    }
  };

  /* ══════════════════════════════════════════════════════════════════════════
     FOX LIFE AGENT  — Tabikaeru-style core loop
     The fox acts on its own based on items on the planet and shares a diary entry
     ══════════════════════════════════════════════════════════════════════════ */

  // ── Scheduled daily events — fire once per planet day at specific hours ──
  const SCHEDULED_EVENTS = [
    { id: 'wakeup',    hours: [6, 7, 8],    emoji: '🌅', label: 'Waking up, writing morning notes', promptHint: 'You just woke from a dream. Tell me what you dreamt and what you want to do today.' },
    { id: 'lunch',     hours: [12, 13, 14], emoji: '🍽️', label: 'Time to find lunch',               promptHint: 'Noon sun on your fur, stomach rumbling. Tell me what you craved and whether you went to find it.' },
    { id: 'sunset',    hours: [17, 18, 19], emoji: '🌇', label: 'Watching dusk from the burrow',    promptHint: 'Dusk arrived; you sit at the burrow watching the orange sky. Tell me what happened today and how you feel right now.' },
    { id: 'goodnight', hours: [22, 23],     emoji: '🌙', label: 'A little goodnight note',          promptHint: "The day is almost over; you're about to crawl into bed. Write a short goodnight diary entry." },
  ];

  // ── Lonely planet events — fire when discovered.length === 0 ──
  const LONELY_ACTIVITIES = [
    { kind: 'stargaze',  emoji: '🌟', label: 'Stargazing, lost in thought', promptHint: 'The planet is empty. You look up at the stars. Write what you are waiting for, what you hope for.' },
    { kind: 'imagine',   emoji: '💭', label: 'Imagining the Little Prince', promptHint: "You haven't met the Little Prince yet — the one who'll bring wonders. Imagine what he might look like." },
    { kind: 'count',     emoji: '🔢', label: 'Counting your own toes',     promptHint: 'Nothing to do, so you start counting your toes. A short, idle, slightly bored little diary.' },
    { kind: 'doodle',    emoji: '🎨', label: 'Drawing in the sand',        promptHint: 'You drag your tail through the sand to draw. Tell me what you drew and why.' },
    { kind: 'wait',      emoji: '⏳', label: 'Sitting at the burrow waiting', promptHint: 'You sit at the burrow staring into the distance. Write down what you wait for, what you quietly hope for.' },
  ];

  // Activity templates: what the fox might do per item category
  const FOX_ACTIVITIES = {
    food: [
      { kind: 'taste',      label: 'Going out to try a bite', emoji: '🍽️' },
      { kind: 'cook',       label: 'Trying to make one myself', emoji: '🍳' },
      { kind: 'ingredient', label: 'Looking for a key ingredient', emoji: '🔍' },
      { kind: 'recommend',  label: 'Asking around for the authentic way to eat it', emoji: '💬' },
    ],
    plant: [
      { kind: 'smell',  label: 'Wanting to smell it',                emoji: '👃' },
      { kind: 'plant',  label: 'Trying to grow one on the planet',   emoji: '🌱' },
      { kind: 'seed',   label: 'Hunting for its seed',               emoji: '🌰' },
      { kind: 'water',  label: 'Giving it a little water',           emoji: '💧' },
    ],
    animal: [
      { kind: 'visit',   label: 'Going to play with it',     emoji: '🐾' },
      { kind: 'observe', label: 'Quietly watching it',       emoji: '👀' },
      { kind: 'mimic',   label: 'Trying to mimic its call',  emoji: '🗣️' },
      { kind: 'feed',    label: 'Bringing it a snack',       emoji: '🥜' },
    ],
    building: [
      { kind: 'sit',     label: 'Sitting at its foot for a while',  emoji: '🪑' },
      { kind: 'walk',    label: 'Walking around it once',           emoji: '🚶' },
      { kind: 'collect', label: 'Picking up a leaf by its wall',    emoji: '🍂' },
    ],
    landmark: [
      { kind: 'revisit', label: 'Going back for another look',          emoji: '👁️' },
      { kind: 'count',   label: 'Counting how many tourists are there', emoji: '🔢' },
      { kind: 'sketch',  label: 'Finding the prettiest angle to sketch',emoji: '🎨' },
    ],
    transportation: [
      { kind: 'ride',    label: 'Taking a ride to see',     emoji: '🎫' },
      { kind: 'route',   label: 'Studying its route',       emoji: '🗺️' },
      { kind: 'chat',    label: 'Chatting with the driver', emoji: '💬' },
    ],
    art: [
      { kind: 'imitate', label: 'Trying to paint one like it',    emoji: '🖌️' },
      { kind: 'history', label: 'Digging up the story behind it', emoji: '📜' },
      { kind: 'poem',    label: 'Writing a little poem for it',   emoji: '✒️' },
    ],
    souvenir: [
      { kind: 'display', label: 'Hanging it at the burrow entrance', emoji: '🏷️' },
      { kind: 'rename',  label: 'Giving it a name',                  emoji: '✏️' },
      { kind: 'compare', label: 'Comparing it to other souvenirs',   emoji: '⚖️' },
    ],
    sign: [
      { kind: 'read',    label: 'Trying to read the words on it', emoji: '👓' },
      { kind: 'origin',  label: 'Finding out who wrote it',       emoji: '🔎' },
    ],
    person: [
      { kind: 'meet',    label: 'Saying a few words to them',   emoji: '👋' },
      { kind: 'story',   label: "Wanting to know their story",  emoji: '📖' },
    ],
    default: [
      { kind: 'look',    label: 'Looking at it carefully',        emoji: '🧐' },
      { kind: 'be_with', label: 'Sitting with it for a while',    emoji: '⏳' },
    ],
  };

  // Planet-time flavor for fox diary (uses 6-hour planet day)
  function _foxTimeContext() {
    const t = _planetTime();
    return `Planet day ${t.day} · ${t.period} ${t.emoji} (B-612 hour ${t.hourOfDay})`;
  }

  const FoxLifeAgent = {
    lastRunMs:    0,
    COOLDOWN_MS:  6 * 60_000,   // 6 minutes minimum between activities — fox is contemplative
    isRunning:    false,
    recentItemNames: [],

    /** Decide whether to run an activity now. Returns picked activity or null. */
    pickActivity() {
      if (this.isRunning) return null;
      if (Date.now() - this.lastRunMs < this.COOLDOWN_MS) return null;

      const t = _planetTime();

      // ① Scheduled daily event — highest priority
      const scheduled = this._pickScheduledEvent(t);
      if (scheduled) return scheduled;

      // ② Lonely planet — fox can still write entries even with 0 items
      if (ctx.discovered.length === 0) return this._pickLonelyEvent();

      // ③ Normal item-based activity
      const candidates = ctx.discovered.filter(d => !this.recentItemNames.includes(d.name));
      const pool = candidates.length > 0 ? candidates : ctx.discovered;
      const recent = pool.slice(-5);
      const item = Math.random() < 0.6 && recent.length
        ? recent[Math.floor(Math.random() * recent.length)]
        : pool[Math.floor(Math.random() * pool.length)];

      const actions = FOX_ACTIVITIES[item.category] || FOX_ACTIVITIES.default;
      const action  = actions[Math.floor(Math.random() * actions.length)];
      return { item, action };
    },

    /** Check if any daily scheduled event is due (and not yet done today) */
    _pickScheduledEvent(t) {
      // Reset daily tracking when planet day rolls
      if (ctx.foxDailyDone.day !== t.day) {
        ctx.foxDailyDone = { day: t.day, events: [] };
      }
      for (const e of SCHEDULED_EVENTS) {
        if (e.hours.includes(t.hourOfDay) && !ctx.foxDailyDone.events.includes(e.id)) {
          return {
            isScheduled: true,
            scheduledId: e.id,
            action: { emoji: e.emoji, label: e.label, kind: e.id, promptHint: e.promptHint },
            // Pick a related item if any, else null
            item: ctx.discovered.length > 0
              ? ctx.discovered[Math.floor(Math.random() * ctx.discovered.length)]
              : null,
          };
        }
      }
      return null;
    },

    /** Lonely event — fox passes time on an empty planet */
    _pickLonelyEvent() {
      const e = LONELY_ACTIVITIES[Math.floor(Math.random() * LONELY_ACTIVITIES.length)];
      return {
        isLonely: true,
        action: { emoji: e.emoji, label: e.label, kind: e.kind, promptHint: e.promptHint },
        item: null,
      };
    },

    /** Right after user adds a new item — small chance fox is curious enough to react now */
    async runImmediate(forItem) {
      if (this.isRunning) return;
      if (Date.now() - this.lastRunMs < this.COOLDOWN_MS) return;
      // Only 25% chance — most of the time fox just notices and goes back to dozing
      if (Math.random() > 0.25) return;
      const actions = FOX_ACTIVITIES[forItem.category] || FOX_ACTIVITIES.default;
      const action  = actions[Math.floor(Math.random() * actions.length)];
      await this._do({ item: forItem, action });
    },

    /** Probabilistic background tick — fox is mostly resting, occasionally curious */
    async tick() {
      const activity = this.pickActivity();
      if (!activity) return;
      // Scheduled events still fire on time (4 times per planet day = ~4 per 6h real)
      if (!activity.isScheduled) {
        // Most of the time fox is just dozing — very low probability per tick
        const chance = activity.isLonely ? 0.08 : 0.12;
        if (Math.random() > chance) return;
      }
      await this._do(activity);
    },

    async _do(activity) {
      this.isRunning = true;
      this.lastRunMs = Date.now();
      const itemName = activity.item?.name;
      if (itemName) {
        this.recentItemNames.push(itemName);
        if (this.recentItemNames.length > 5) this.recentItemNames.shift();
      }

      // Mark the fox as currently doing this — UI shows live indicator
      ctx.currentFoxActivity = {
        emoji:    activity.action.emoji,
        label:    activity.action.label,
        itemName: itemName || '',
        startMs:  Date.now(),
      };
      window.UI?.onFoxStatusChange?.(ctx.currentFoxActivity);

      setStatus('foxlife', 'active');
      const entry = AgentMonitor.start('foxlife',
        `${activity.action.emoji} ${activity.action.label}${itemName ? ` → 「${itemName}」` : ''}`);

      try {
        const timeCtx = _foxTimeContext();
        const planetSize = ctx.discovered.length;
        const itemKnowledge = (activity.item?.story || '').slice(0, 200);

        // Build context block — varies by event type
        let contextBlock;
        if (activity.isScheduled) {
          contextBlock = `[Scheduled daily event · ${activity.action.label}]
${activity.action.promptHint}
${activity.item ? `(You may mention "${activity.item.name}" on your planet if you wish)` : "(Nothing on the planet yet — this is purely your private moment)"}`;
        } else if (activity.isLonely) {
          contextBlock = `[Nothing on the planet yet — you're alone]
${activity.action.promptHint}
The Little Prince hasn't appeared yet. Your little life is quiet, a bit lonely, but full of anticipation.`;
        } else {
          contextBlock = `[What you're going to do] ${activity.action.label}
About the item: "${activity.item.name}" (${activity.item.category})
What you know about it: ${itemKnowledge || '(only what the Little Prince mentioned)'}
This is item #${planetSize} the Little Prince has brought back

Note: while doing this, your thoughts may wander — to related real things the Little Prince hasn't brought yet, or to a new little curiosity. Your imagination is free as long as anything you mention truly exists in reality.`;
        }

        const sys = `You are Le Renard — the Little Fox — living on the Little Prince's planet B-612.

[The current scene]
- Time: ${timeCtx}
${contextBlock}

[Task]
Write a 60-110 word "Little Fox diary" entry, first person, describing what you did and felt.

[Style · Tabikaeru postcard tone]
- Simple, like a 7-year-old's diary
- Include 1-2 concrete tiny details (taste, sound, color, someone's words)
- Ending may be warm, surprised, curious, or a touch wistful
- MUST stay focused on "${activity.action.label}" — describe the process of doing it
- No clichés ("had a great day", "really fun")
- Do NOT repeat objective descriptions of the item — write what "I" did

[On facts]
- Any shop / place / thing mentioned MUST be real
- Don't pretend the Little Prince said something they didn't
- The fox MAY fantasize / be curious / mention new real places the Little Prince hasn't been

[Example]
(Task: go out to try a coconut smoothie)
"Snuck out at noon and found the Mr. Coconut you mentioned. The auntie at the counter recognized you — said your eyes curl up when you smile. She gave me an extra spoon of coconut flesh. The smoothie was too cold; I sneezed three times in a row. But it really was sweet."

★ LANGUAGE: write everything in English.

Return STRICT JSON:
{
  "narrative": "60-110 word first-person diary",
  "mood": "happy|wistful|curious|sleepy|surprised",
  "energyEarned": 5-15,
  "broughtBack": "(optional) what little thing did the fox bring back? A leaf / a pebble / a sentence / empty ''. If filled, it shows as a tiny keepsake",
  "shortTitle": "5-10 word title, e.g. 'Sneezes from the coconut smoothie'"
}`;

        const raw = await callChat([
          { role: 'system', content: sys },
          { role: 'user', content: "Today's Little Fox diary entry." }
        ], 'qwen-max', entry);

        const parsed = extractJSON(raw) || {
          narrative: raw,
          mood: 'curious',
          energyEarned: 5,
          broughtBack: '',
          shortTitle: activity.action.label
        };

        AgentMonitor.finish(entry, raw);

        // Apply reward
        ctx.score += parsed.energyEarned || 5;
        window.UI?.onScoreUpdate(ctx.score);

        // Build diary entry and store
        const t = _planetTime();
        const diaryEntry = {
          id:           `fox_${Date.now()}`,
          ts:           Date.now(),
          planetDay:    t.day,
          planetHour:   t.hourOfDay,
          period:       t.period,
          emoji:        t.emoji,
          isScheduled:  !!activity.isScheduled,
          isLonely:     !!activity.isLonely,
          itemName:     activity.item?.name || '',
          itemCategory: activity.item?.category || 'other',
          itemPhoto:    activity.item?.photoSrc || null,
          action:       activity.action,
          narrative:    parsed.narrative,
          mood:         parsed.mood || 'curious',
          energyEarned: parsed.energyEarned || 5,
          broughtBack:  parsed.broughtBack || '',
          shortTitle:   parsed.shortTitle || activity.action.label,
        };
        ctx.foxDiary.push(diaryEntry);

        // Mark scheduled event as completed for this planet day
        if (activity.isScheduled && !ctx.foxDailyDone.events.includes(activity.scheduledId)) {
          ctx.foxDailyDone.events.push(activity.scheduledId);
        }

        // Each diary entry deepens the bond a little
        _addBond(1, "Fox kept you company today");

        _persist();

        // Emit fox diary card to chat UI
        window.UI?.onFoxDiary({
          item:        activity.item,
          ...diaryEntry,
          timeContext: timeCtx,
        });
      } catch (err) {
        AgentMonitor.finish(entry, null, err);
        console.error('[FoxLife]', err);
      } finally {
        this.isRunning = false;
        setStatus('foxlife', 'idle');
        ctx.currentFoxActivity = null;
        window.UI?.onFoxStatusChange?.(null);
      }
    },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     AGENT MAIN LOOP  (Orchestrator)
     ══════════════════════════════════════════════════════════════════════════ */

  class AgentMainLoop {
    constructor() {
      this._queue   = [];
      this._running = false;
    }

    enqueue(task) {
      this._queue.push(task);
      if (!this._running) this._processQueue();
    }

    async _processQueue() {
      this._running = true;
      setStatus('orchestrator', 'active');
      while (this._queue.length) {
        const task = this._queue.shift();
        try {
          await this._dispatch(task);
        } catch (err) {
          console.error('[Orchestrator] Error:', err);
          window.UI?.onError(err.message);
        }
      }
      setStatus('orchestrator', 'idle');
      this._running = false;
    }

    async _dispatch(task) {
      console.log(`[Orchestrator] → ${task.type}`, task);
      switch (task.type) {
        case 'user_message':   return this._handleMessage(task.text);
        case 'analyze_photo':  return this._handlePhoto(task.imageBase64, task.photoSrc, task.mood);
        case 'complete_task':  return Tools.completeTask(task.id);
        case 'landmark_story': return this._handleLandmarkStory(task.id, task.name);
      }
    }

    async _handleMessage(text) {
      _rememberUserInput(text);
      // Sharing a thought with the fox deepens the bond a little
      if (text && text.length > 4) _addBond(1, "You spoke to the fox");

      const orchEntry = AgentMonitor.start('orchestrator', `user_message → "${_truncate(text, 120)}"`);
      try {
        // Build a rich context bundle for the local-guide planner.
        // - last identified item gives the planner a geographic + thematic anchor
        // - its saved context (time/weather/company/note) is the freshest user-shared scene
        const lastDisc = ctx.discovered[ctx.discovered.length - 1];
        const sharedCtx = lastDisc?.context || {};
        const hints = {
          lastPhotoName:     lastDisc?.name,
          lastPhotoCategory: lastDisc?.category,
          lastLocationId:    lastDisc?.locationId,
          weather:           sharedCtx.weather,
          company:           sharedCtx.company,
          note:              sharedCtx.note,
        };

        // 1. Planner Agent (now context-aware)
        const plan = await PlannerAgent.run(text, hints);
        Tools.agentReply(plan.reply ?? text);

        // 2. Add tasks
        (plan.tasks ?? []).forEach(t => Tools.addTask(t));

        // 3. Sponsor Agent — opportunistically inject
        const sponsorTask = await SponsorAgent.run(text);
        if (sponsorTask) Tools.showSponsor(sponsorTask);

        AgentMonitor.finish(orchEntry, `Generated ${(plan.tasks||[]).length} quests · sponsor: ${sponsorTask ? 'injected' : 'none'}`);
      } catch(err) {
        AgentMonitor.finish(orchEntry, null, err);
        throw err;
      }
    }

    async _handlePhoto(imageBase64, photoSrc, mood) {
      const orchEntry = AgentMonitor.start('orchestrator', 'analyze_photo → Vision + Story + Map');
      // 1. Vision Agent
      const result = await VisionAgent.run(imageBase64, mood);
      const { identified, story, model3d, achievement } = result;

      // 2. Story Agent — enrich if confidence low
      let finalStory = story;
      if (identified.confidence < 0.7 && identified.locationId) {
        finalStory = await StoryAgent.run(identified.locationId, identified.name);
      }

      // 3. Show story in chat (with mood for display)
      Tools.showStory({ title: identified.name, titleEn: identified.nameEn, story: finalStory, mood });

      // 4. Place on map
      Tools.addToMap({
        name: identified.name,
        category: identified.category,
        locationId: identified.locationId,
        color: model3d?.color,
        type: model3d?.type,
      });

      // 5. Add to collection (include photoSrc + mood for gallery display)
      Tools.addToCollection({ ...identified, story: finalStory, mood, ts: Date.now(), photoSrc });

      // 6. Achievement
      if (achievement?.unlock) Tools.unlockAchievement(achievement);

      // 7. Auto-complete matching tasks
      ctx.tasks.forEach(t => {
        if (!t.done && t.locationId === identified.locationId) {
          Tools.completeTask(t.id);
        }
      });
      AgentMonitor.finish(orchEntry, `Identified: ${identified.name} @ ${identified.location}`);
    }

    async _handleLandmarkStory(id, name) {
      const story = await StoryAgent.run(id, name);
      Tools.showStory({ title: name, story });
    }
  }

  /* ── Live sponsor: SuperAI 2026 — auto-injected during conference window ── */
  (function autoInjectLiveSponsor() {
    const now   = Date.now();
    const start = new Date('2026-06-10T00:00:00').getTime();
    const end   = new Date('2026-06-12T00:00:00').getTime();
    if (now < start || now >= end) return;

    const sponsor = SPONSORS.find(s => s.id === 'super_ai_2026');
    if (!sponsor) return;
    if (ctx.tasks.find(t => t.id === sponsor.task.id)) return;   // already injected

    ctx.tasks.push({ ...sponsor.task, isNew: true });
    SponsorAgent.injected.add('super_ai_2026');                  // don't double-fire via keywords
    _persist();
  })();

  /* ─── Public API ────────────────────────────────────────────────────────── */
  const loop = new AgentMainLoop();

  return {
    sendMessage:    (text)        => loop.enqueue({ type:'user_message',  text }),
    analyzePhoto:   (imageBase64, photoSrc, mood) => loop.enqueue({ type:'analyze_photo', imageBase64, photoSrc, mood }),
    completeTask:   (id)          => loop.enqueue({ type:'complete_task', id }),
    landmarkStory:  (id, name)    => loop.enqueue({ type:'landmark_story', id, name }),
    getCtx:         ()            => ctx,

    /* ── Monitor controls ─────────────────────────────────────────────── */
    monitor:        AgentMonitor,

    /** Abort a specific running entry by its id */
    abortEntry(entryId) {
      const entry = AgentMonitor.entries.find(e => e.id === entryId);
      if (entry?.status === 'running') {
        entry.controller.abort();
      }
    },

    /** Mark all tasks as seen — call when user opens the full task panel */
    markAllTasksSeen() { Tools.markAllTasksSeen(); },

    /** Set the player's planet name */
    setPlanetName(name) {
      ctx.planetName = (name || 'My Planet').trim().slice(0, 20);
      _persist();
    },
    getPlanetName: () => ctx.planetName,

    /** Update a discovered item's spherical position on the planet + persist */
    setItemPosition(itemName, theta, phi) {
      const item = ctx.discovered.find(d => d.name === itemName);
      if (!item) return false;
      item.theta = theta;
      item.phi   = phi;
      // Clean up legacy flat coords if present
      delete item.x;
      delete item.z;
      _persist();
      return true;
    },

    /** Mark a milestone as unlocked */
    unlockMilestone(id) {
      if (ctx.milestones.includes(id)) return false;
      ctx.milestones.push(id);
      _persist();
      return true;
    },
    getMilestones: () => ctx.milestones,

    /** Get current planet time (day/hour/period) */
    planetTime: () => _planetTime(),

    /** Compute planet time for an arbitrary real timestamp */
    planetTimeAt(ts) {
      const elapsed   = Math.max(0, ts - ctx.planetStartMs);
      const day       = Math.floor(elapsed / PLANET_DAY_MS) + 1;
      const hourOfDay = Math.floor((elapsed % PLANET_DAY_MS) / PLANET_HOUR_MS);
      return { day, hourOfDay, elapsed };
    },

    /** Get the past N real hours as a timeline of (planet-hour) slots */
    getFoxTimeline(realHours = 6) {
      const now      = Date.now();
      const slotMs   = PLANET_HOUR_MS;          // 1 planet hour = 15 real min
      const slotN    = Math.floor(realHours * 60 * 60 * 1000 / slotMs);
      const slots    = [];
      for (let i = slotN - 1; i >= 0; i--) {
        const slotStart = now - (i + 1) * slotMs;
        const slotEnd   = now - i * slotMs;
        const activity  = ctx.foxDiary.find(d => d.ts >= slotStart && d.ts < slotEnd);
        const elapsed   = Math.max(0, slotStart - ctx.planetStartMs);
        const planetH   = Math.floor((elapsed % PLANET_DAY_MS) / PLANET_HOUR_MS);
        slots.push({
          slotStart, slotEnd,
          planetHour: planetH,
          activity:   activity || null,
        });
      }
      return slots;
    },

    /** Get bond stats: {value, current: {name, icon, desc}, next, progress} */
    getBond: () => _bondLevel(),

    /** Get fox's diary entries (newest first) */
    getFoxDiary: () => ctx.foxDiary.slice().reverse(),

    /** What is the fox currently doing (null if idle)? */
    getCurrentFoxActivity: () => ctx.currentFoxActivity,

    /** Trigger fox life activity related to a just-added item (immediate, 50% chance) */
    async foxReactTo(item) { return FoxLifeAgent.runImmediate(item); },

    /** Background tick — call periodically; might or might not trigger */
    async foxTick()         { return FoxLifeAgent.tick(); },

    /** Force a fox activity now (Demo button, debug) */
    async foxActNow() {
      const a = FoxLifeAgent.pickActivity();
      if (a) await FoxLifeAgent._do(a);
    },

    /** Run contextual task recommendation after photo confirm */
    async contextualCheck(identified, sceneContext) {
      const result = await ContextAgent.run(identified, sceneContext);
      if (!result || !result.hasRecommendations) return;

      // Show recommendation message in chat
      if (result.message) {
        window.UI?.onAgentReply(`📍 ${result.message}`);
      }

      // Add recommended tasks (deduplication is inside addTask)
      (result.tasks ?? []).forEach(t => Tools.addTask(t));

      // Check sponsor injection based on location
      const sponsorTask = await SponsorAgent.run(
        `${identified.name} ${identified.location} ${identified.category}`
      );
      if (sponsorTask) Tools.showSponsor(sponsorTask);
    },

    /** Store a user input in memory (call when photo mood text is submitted) */
    rememberInput(text) { if (text) _rememberUserInput(text); },

    /** Remove a discovered item by name */
    removeDiscovered(itemName) {
      const idx = ctx.discovered.findIndex(d => d.name === itemName);
      if (idx === -1) return;
      ctx.discovered.splice(idx, 1);
      ctx.score = Math.max(0, ctx.score - 50);
      window.UI?.onScoreUpdate(ctx.score);
      _persist();
    },

    /** Return saved state for restoration on load */
    getSavedState: () => _saved,

    /** Wipe all local storage and reload */
    clearState() { Storage.clear(); location.reload(); },

    /** Abort ALL running entries and clear the queue */
    abortAll() {
      AgentMonitor.entries
        .filter(e => e.status === 'running')
        .forEach(e => e.controller.abort());
      loop._queue = [];
    },
  };

})();
