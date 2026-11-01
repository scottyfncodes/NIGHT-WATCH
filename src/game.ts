import * as THREE from 'three';
import { LAYOUT, SpawnDef, WaveDef, AmmoType, AMMO_COLORS, UpgradeId } from './config';
import { loadSave, writeSave, computeLoadout, Loadout, SaveData, purchase, computeReward, defaultSave, Settings } from './save';
import { audio } from './audio';
import { Environment } from './world/environment';
import { Tent, Opening } from './world/tent';
import { Campsite, Cooler, makeLoot } from './world/campsite';
import { Raccoon, RaccoonWorld, Lure, DroppedLoot } from './raccoon/ai';
import { Marker, ProjectilePool, Projectile, GRAVITY } from './weapon';
import { Splats, Particles, WatcherEyes } from './fx';
import { Player } from './player';
import { Input } from './input';
import { Director, DirectorHost } from './director';
import { UI, Warning } from './ui';
import { grainDataURL } from './textures';

type Mode = 'menu' | 'intro' | 'playing' | 'paused' | 'results' | 'ending';

interface Interactable {
  label: string;
  pos: THREE.Vector3;
  range: number;
  hold?: number; // seconds to hold
  act: () => void;
  progress?: () => number;
}

export class Game implements RaccoonWorld, DirectorHost {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  save: SaveData;
  loadout: Loadout;
  env!: Environment;
  tent!: Tent;
  camp!: Campsite;
  cooler!: Cooler;
  player: Player;
  marker: Marker;
  projectiles: ProjectilePool;
  splats: Splats;
  particles: Particles;
  watchers: WatcherEyes;
  input: Input;
  director: Director;
  ui: UI;
  raccoons: Raccoon[] = [];
  lures: Lure[] = [];
  drops: DroppedLoot[] = [];
  mode: Mode = 'menu';
  time = 0;
  night = 1;
  nerve = 0;
  speedScale = 1;
  dayMix = 0;
  stats = { deterred: 0, tanks: 0, boss: false };
  hotdogReady = false;
  pots = 0;
  hintsShown = new Set<string>();
  private clock = new THREE.Clock();
  static readonly USE_RANGE = 11;
  private interactTarget: Interactable | null = null;
  private holdT = 0;
  private menuT = 0;
  private lookDelta = new THREE.Vector2();
  private warnings: { pos: THREE.Vector3; kind: Warning['kind']; t: number }[] = [];
  private endT = 0;
  private endWon = false;
  private endReason = '';
  private boss: Raccoon | null = null;
  private quality: 'low' | 'medium' | 'high';
  private firstHit = false;
  private dangerSmooth = 0;
  private dryT = 0;
  private podsThisWave = 0;

  get playerPos() { return this.player.pos; }
  get playerInTent() { return this.player.inTent; }

  constructor(private container: HTMLElement) {
    this.save = loadSave();
    this.quality = this.save.settings.quality;
    this.loadout = computeLoadout(this.save);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.player = new Player(window.innerWidth / window.innerHeight);
    this.scene.add(this.player.camera);
    this.buildWorld();
    this.marker = new Marker();
    this.projectiles = new ProjectilePool(this.scene);
    this.splats = new Splats(this.scene);
    this.particles = new Particles(this.scene);
    this.watchers = new WatcherEyes(this.scene);
    this.ui = new UI(container);
    this.input = new Input(this.renderer.domElement, this.ui.root);
    this.director = new Director(this);
    this.applySettings(this.save.settings);
    this.ui.setTouch(this.input.touch);
    (this.ui.root.querySelector('.grain') as HTMLElement).style.backgroundImage = `url(${grainDataURL()})`;

    this.wireUI();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'playing') this.pause(); });
    this.input.onLockLost = () => { if (this.mode === 'playing') this.pause(); };

    this.ui.refreshMenu(this.save);
    this.ui.show('menu');
    this.setupMenuScene();
    this.renderer.setAnimationLoop(() => this.frame());
    (window as any).__nw = this; // debug / automated testing hook
  }

  private buildWorld() {
    this.env = new Environment(this.scene, this.quality);
    this.tent = new Tent(this.scene);
    this.camp = new Campsite(this.scene, this.quality);
    this.cooler = new Cooler(this.scene);
  }

  private applySettings(s: Settings) {
    audio.setVolume(s.volume, s.ambience);
    this.input.sensitivity = s.sensitivity;
    this.input.touchSensitivity = s.touchSensitivity;
    this.input.invertY = s.invertY;
  }

  private onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const maxDPR = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDPR));
    this.renderer.setSize(w, h);
    const cam = this.player.camera;
    cam.aspect = w / h;
    // keep a comfortable horizontal FOV in portrait
    const hFov = 92;
    const vFromH = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hFov) / 2) / cam.aspect));
    cam.fov = cam.aspect < 1.2 ? Math.min(100, vFromH) : 70;
    cam.updateProjectionMatrix();
    document.body.classList.toggle('portrait', h > w);
  }

  private wireUI() {
    const ui = this.ui;
    ui.onClick = () => { audio.unlock(); audio.play('click', { vol: 0.6 }); };
    ui.onPlay = () => this.beginNight();
    ui.onResume = () => this.resume();
    ui.onRestart = () => { this.cleanupNight(); this.startNight(); };
    ui.onQuit = () => this.toMenu();
    ui.onNext = () => this.beginNight();
    ui.onPauseBtn = () => this.pause();
    ui.onBuy = (id: UpgradeId) => {
      if (purchase(this.save, id)) {
        audio.play('buy', { vol: 0.8 });
        writeSave(this.save);
        this.loadout = computeLoadout(this.save);
      } else audio.play('dry', { vol: 0.7 });
      ui.renderUpgrades(this.save);
      ui.refreshMenu(this.save);
    };
    ui.onPaint = (id) => {
      this.save.paint = id;
      writeSave(this.save);
      this.loadout = computeLoadout(this.save);
      ui.renderEquipment(this.save);
    };
    ui.onSettings = (s) => {
      this.save.settings = s;
      writeSave(this.save);
      this.applySettings(s);
    };
    ui.onReset = () => {
      const keepSettings = this.save.settings;
      this.save = defaultSave();
      this.save.settings = keepSettings;
      writeSave(this.save);
      this.loadout = computeLoadout(this.save);
      ui.refreshMenu(this.save);
      ui.show('menu');
    };
  }

  // ─── flow ──────────────────────────────────────────────
  private setupMenuScene() {
    this.cleanupNight();
    this.cooler.reset();
    this.tent.reset();
    this.camp.reset();
    this.dayMix = 0;
    // a couple of lurkers watching from the trees on the menu
    for (const [x, z, type] of [[-4.2, 1.6, 'bandit'], [5.6, -0.4, 'scout']] as [number, number, 'bandit' | 'scout'][]) {
      const r = new Raccoon(type, this, 0);
      const p = new THREE.Vector3(x, 0, z);
      r.spawnAt(p);
      r.heading = Math.atan2(2 - x, -11 - z);
      r.setState('lurk');
      r.stateTime = -1e9; // never leave lurk
      this.raccoons.push(r);
    }
  }

  async beginNight() {
    audio.unlock();
    this.save = loadSave();
    if (this.save.settings.quality !== this.quality) {
      // graphics tier changed — reload so the renderer is rebuilt cleanly
      writeSave(this.save);
      location.reload();
      return;
    }
    if (!this.save.seenIntro) {
      this.mode = 'intro';
      this.cleanupNight();
      this.cooler.reset();
      await this.ui.intro();
      this.save.seenIntro = true;
      writeSave(this.save);
    }
    this.startNight();
  }

  private cleanupNight() {
    for (const r of this.raccoons) if (!r.removed) r.leave();
    this.raccoons = [];
    for (const l of this.lures) l.mesh?.removeFromParent();
    this.lures = [];
    for (const d of this.drops) d.mesh.removeFromParent();
    this.drops = [];
    this.projectiles.clear();
    this.splats.clear();
    this.watchers.clear();
    this.warnings = [];
  }

  startNight() {
    this.cleanupNight();
    this.save = loadSave();
    this.loadout = computeLoadout(this.save);
    this.night = this.save.night;
    this.speedScale = 1 + Math.min(0.3, (this.night - 1) * 0.06);
    this.cooler.reset();
    this.tent.reset();
    this.camp.reset();
    this.player.reset(this.loadout);
    this.marker.configure(this.loadout);
    this.nerve = 0;
    this.dayMix = 0;
    this.stats = { deterred: 0, tanks: 0, boss: false };
    this.pots = this.loadout.pots;
    this.boss = null;
    this.firstHit = false;
    this.hintsShown.clear();
    this.camp.tripwires.forEach((t, i) => { t.group.visible = i < this.loadout.tripwires; t.armed = i < this.loadout.tripwires; });
    this.mode = 'playing';
    this.ui.show('hud');
    this.input.setEnabled(true);
    this.input.requestLock();
    this.director.start();
    audio.play('sting', { vol: 0.5 });
    // tutorial beats for the first minute
    if (this.night === 1) {
      setTimeout(() => this.hint('start', this.input.touch ? 'Something’s at the cooler. Drag to aim, hold FIRE to shoot.' : 'Something’s at the cooler. Click to shoot — paintballs drop, so aim a little high at range.'), 1200);
      setTimeout(() => this.hint('light', this.input.touch ? 'Tap LIGHT for the flashlight. Their eyes shine back.' : 'Press F for the flashlight. Their eyes shine back.'), 9000);
    }
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.setEnabled(false);
    this.input.exitLock();
    audio.suspend(true);
    this.ui.show('pause');
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = 'playing';
    this.ui.show('hud');
    this.input.setEnabled(true);
    this.input.requestLock();
    audio.suspend(false);
    this.clock.getDelta();
  }

  toMenu() {
    this.mode = 'menu';
    this.input.setEnabled(false);
    this.input.exitLock();
    audio.suspend(false);
    audio.radioOn = false;
    this.director.phase = 'idle';
    this.ui.refreshMenu(this.save);
    this.ui.show('menu');
    this.setupMenuScene();
  }

  private endNight(won: boolean, reason: string) {
    if (this.mode !== 'playing') return;
    this.mode = 'ending';
    this.endT = 0;
    this.endWon = won;
    this.endReason = reason;
    this.input.setEnabled(false);
    this.input.exitLock();
    audio.radioOn = false;
    if (!won) audio.play('lose', { vol: 0.8 });
  }

  private finishNight() {
    const won = this.endWon;
    const reward = computeReward({
      won, wavesCleared: won ? this.director.totalWaves : this.director.waveIndex,
      food: this.cooler.food, deterred: this.stats.deterred, tanks: this.stats.tanks, boss: this.stats.boss,
      shots: this.marker.shots, hits: this.marker.hits,
    });
    this.save.supplies += reward.total;
    this.save.totalDeterred += this.stats.deterred;
    if (won) {
      this.save.bestNight = Math.max(this.save.bestNight, this.night);
      this.save.night = this.night + 1;
    }
    writeSave(this.save);
    this.mode = 'results';
    this.ui.refreshMenu(this.save);
    this.ui.showResults({
      won, reason: this.endReason, night: this.night, food: this.cooler.food, deterred: this.stats.deterred,
      accuracy: this.marker.shots ? this.marker.hits / this.marker.shots : 0,
      lines: reward.lines, total: reward.total, supplies: this.save.supplies,
    });
  }

  // ─── RaccoonWorld ─────────────────────────────────────
  isInBeam(p: THREE.Vector3) { return this.player.isInBeam(p, this.loadout); }
  isLit(p: THREE.Vector3) {
    for (const l of this.camp.lanterns) if (l.on && p.distanceTo(l.pos) < 6.5) return true;
    return this.dayMix > 0.5;
  }
  addNerve(n: number) {
    if (this.mode !== 'playing') return;
    this.nerve = Math.min(100, this.nerve + n);
    if (this.nerve >= 100) this.endNight(false, 'You bolted for the camper. Dad is not impressed.');
  }
  onFoodStolen(_r: Raccoon, amount: number) {
    this.cooler.food = Math.max(0, this.cooler.food - amount);
    this.cooler.refreshItems();
    if (amount >= 1) this.hint('stolen', 'They got some food! Tag a thief before it reaches the trees and it drops the loot.');
    if (this.cooler.food <= 0) this.endNight(false, 'The raccoons cleaned out the cooler. Every last marshmallow.');
  }
  onLootEscaped(r: Raccoon) {
    audio.play('chitter3', { pos: r.pos, vol: 0.5, rate: r.def.pitch });
  }
  onDeterred(r: Raccoon) {
    this.stats.deterred++;
    if (r.def.id === 'tank') this.stats.tanks++;
    if (r.isBoss) {
      this.stats.boss = true;
      this.ui.banner('Big Earl is leaving', 'He’s had enough.', 'The crew scatters into the pines.');
      for (const o of this.raccoons) if (o.active && o !== r) { o.resolve = 0; o.stun = 0.01; o.setState('stunned'); }
    }
  }
  dropLoot(r: Raccoon) {
    if (!r.carrying) return;
    const mesh = makeLoot(r.carrying);
    mesh.position.copy(r.pos).setY(0.06);
    mesh.rotation.set(Math.PI / 2 * (r.carrying === 'chips' ? 1 : 0), Math.random() * 6, 0);
    this.scene.add(mesh);
    this.drops.push({ kind: r.carrying, amount: r.carryAmount, pos: r.pos.clone().setY(0), mesh, time: 7, claimed: null });
    audio.play('drop', { pos: r.pos, vol: 0.8 });
    r.detachLoot();
    r.carrying = null;
    r.carryAmount = 0;
    this.hint('drop', 'It dropped the food! Aim at it and hit E/USE to grab it — or it rolls back to camp in a few seconds.');
  }
  onBreach(_r: Raccoon, op: Opening) {
    this.ui.toast(`The ${op.label} is torn! Aim at it and hold ${this.input.touch ? 'USE' : 'E'} to duct-tape it.`);
  }
  onBossCommand(r: Raccoon) {
    this.warnings.push({ pos: r.pos.clone(), kind: 'boss', t: 1.5 });
    this.hint('command', 'Big Earl is rallying the crew — they’re fearless while they glow orange!');
  }
  onBossHalf(r: Raccoon) {
    this.ui.toast('Big Earl whistles for backup!');
    for (let i = 0; i < 2; i++) {
      const side = THREE.MathUtils.radToDeg(Math.atan2(r.pos.x, -r.pos.z)) + 120 + i * 120;
      const { pos, angle } = this.director.spawnPos(side, 24);
      this.spawnRaccoon({ type: i === 0 ? 'bandit' : 'sneak', at: 0, side }, pos, angle);
    }
  }
  hint(id: string, text: string) {
    if (this.hintsShown.has(id) || !this.save.settings.hints) return;
    this.hintsShown.add(id);
    this.ui.toast(text, 4200);
  }

  // ─── DirectorHost ─────────────────────────────────────
  spawnRaccoon(def: SpawnDef, pos: THREE.Vector3, angle: number) {
    const r = new Raccoon(def.type, this, angle, def.role);
    r.spawnAt(pos);
    if (def.type === 'visitor') {
      r.setState('lurk');
      r.target.copy(pos);
    }
    this.raccoons.push(r);
  }
  spawnBoss() {
    // Big Earl steps into wherever your flashlight is pointing
    const f = this.player.forward().setY(0);
    if (f.lengthSq() < 0.01) f.set(0, 0, -1);
    f.normalize();
    let pos = this.player.pos.clone().addScaledVector(f, 13);
    if (Math.hypot(pos.x, pos.z) < 6) pos = new THREE.Vector3(0.6, 0, -14);
    for (const t of this.env.trees) if (Math.hypot(t.x - pos.x, t.z - pos.z) < 1.2) pos.x += 1.4;
    const r = new Raccoon('boss', this, Math.atan2(pos.x, -pos.z));
    r.spawnAt(pos);
    r.heading = Math.atan2(this.player.pos.x - pos.x, this.player.pos.z - pos.z);
    r.setState('bossIntro');
    this.raccoons.push(r);
    this.boss = r;
    this.ui.banner('Final Encounter', 'BIG EARL', 'Hold the cooler until sunrise.', 4);
  }
  aliveCount() { return this.raccoons.filter((r) => !r.removed).length; }
  bossDeterred() { return !!this.boss && this.boss.deterred; }
  onWaveStart(w: WaveDef, i: number) {
    audio.play('beep', { vol: 0.6 });
    if (!w.isBoss) this.ui.banner(`Wave ${i + 1} of ${this.director.totalWaves - 1}`, w.name, w.flavor);
    if (i > 0) audio.play('sting', { vol: 0.45 });
    // resupply between waves
    if (w.resupply > 0) {
      this.marker.reserve += w.resupply;
      this.player.battery = Math.min(this.loadout.battery, this.player.battery + this.loadout.battery * 0.4);
      setTimeout(() => this.ui.toast(`+${w.resupply} paintballs dug out of the duffel. Flashlight batteries swapped.`, 3000), 3400);
    }
    this.hotdogReady = this.loadout.hotdog;
    this.podsThisWave = 0;
    if (this.loadout.autoStrap) this.cooler.strap = this.loadout.bungeeTime;
    this.camp.tripwires.forEach((t, k) => (t.armed = k < this.loadout.tripwires));
    if (w.id === 3) setTimeout(() => this.hint('strap', this.input.touch ? 'Tip: aim at the cooler and tap USE to bungee-strap the lid.' : 'Tip: aim at the cooler and press E to bungee-strap the lid.'), 6000);
    if (w.id === 4) setTimeout(() => this.hint('tent', 'Watch the tent — zip the windows and doors with E/USE. Torn mesh can be taped.'), 9000);
  }
  onWaveClear(w: WaveDef, i: number) {
    audio.play('chime', { vol: 0.6 });
    const next = this.director.waves[i + 1];
    this.ui.banner('All quiet', next ? 'For now.' : '', next ? `${w.name} survived. Something’s still out there…` : '', 3);
    if (this.cooler.lidTarget > 0) this.hint('lid', 'The cooler lid is hanging open — close it (E/USE) or the next raccoon gets a free meal.');
  }
  onSunrise() {
    this.ui.banner('6:00 AM', 'Sunrise', 'The raccoons melt back into the pines.', 4.5);
    audio.play('sunrise', { vol: 0.9 });
    for (const r of this.raccoons) if (r.active) { r.resolve = 0; r.stun = 0.01; r.setState('stunned'); if (r.carrying) this.dropLoot(r); }

  }
  warnAt(pos: THREE.Vector3, kind: 'approach' | 'noise') {
    this.warnings.push({ pos: pos.clone(), kind, t: 2.2 });
  }
  stallWave(level: 1 | 2) {
    for (const r of this.raccoons) {
      if (!r.active) continue;
      if (level === 1) { r.rally = 60; r.scares = 9; }
      else { r.resolve = 0; r.setState('escape'); r.target.set(r.pos.x * 4, 0, r.pos.z * 4); }
    }
    if (level === 1) this.ui.toast('The stragglers are getting bold…', 2200);
  }
  watcherEyes(count: number) {
    this.watchers.spawn(count, this.time);
    audio.play('chitter3', { vol: 0.5 });
    setTimeout(() => audio.play('chitter', { pos: new THREE.Vector3(-14, 0.5, -10), vol: 0.6 }), 400);
    setTimeout(() => audio.play('chitter2', { pos: new THREE.Vector3(12, 0.5, -14), vol: 0.6 }), 900);
  }

  // ─── frame ────────────────────────────────────────────
  private frame() {
    let dt = this.clock.getDelta();
    if (dt > 0.1) dt = 0.1;
    if (this.mode === 'paused') { this.render(); return; }
    this.simulate(dt);
    this.render();
  }

  /** Advance the whole simulation by dt (also used by the automated test harness). */
  simulate(dt: number) {
    this.time += dt;
    const t = this.time;
    this.ui.tick(dt);

    if (this.mode === 'playing' || this.mode === 'ending') this.updateGame(dt, t);
    else this.updateMenu(dt, t);

    // shared world updates
    this.env.update(t, dt, this.dayMix);
    this.tent.update(dt, t);
    this.camp.update(dt, t);
    this.cooler.update(dt, t);
    this.watchers.update(t);
    this.particles.update(dt);
    for (const r of this.raccoons) r.update(dt, t);
    this.raccoons = this.raccoons.filter((r) => !r.removed);
    audio.dayMix = this.dayMix;
    audio.radioOn = this.camp.radio.on && this.mode === 'playing';
    audio.update(dt, this.mode === 'playing', this.director.waveIndex / 6);
  }

  private updateMenu(dt: number, t: number) {
    // slow drift around the campsite
    this.menuT += dt;
    const a = 0.25 + Math.sin(this.menuT * 0.06) * 0.35;
    const cam = this.player.camera;
    cam.position.set(Math.sin(a) * 8.2 + 0.6, 1.55 + Math.sin(this.menuT * 0.2) * 0.12, -Math.cos(a) * 8.2 - 3.2);
    cam.lookAt(4.8, 1.2, -1.2);
    this.player.flashOn = false;
    this.player.flashlight.intensity = 0;
    audio.setListener(cam.position, new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion));
    audio.setMood(0.1, 0.05, dt);
    this.marker.lowered = 1;
  }

  private updateGame(dt: number, t: number) {
    const L = this.loadout;
    const playing = this.mode === 'playing';
    // input
    if (playing) {
      const look = this.input.consumeLook();
      this.lookDelta.copy(look);
      this.player.look(look.x, look.y);
      for (const a of this.input.takeActions()) this.handleAction(a);
    } else {
      this.lookDelta.set(0, 0);
    }
    this.player.update(dt, L);
    // firing
    this.marker.lowered += ((playing ? 0 : 1) - this.marker.lowered) * Math.min(1, dt * 4);
    if (playing && this.input.fireHeld) {
      const fired = this.marker.tryFire(L);
      if (fired) this.fire(fired);
      if (!L.semiAuto && fired) this.input.fireHeld = this.input.touch ? this.input.fireHeld : false;
    }
    this.marker.update(dt, L, this.player.moving, this.lookDelta, this.player.flashOn);
    // bone dry? there's always one more pod rattling around in the sleeping bag
    if (playing && this.marker.hopper + this.marker.reserve === 0 && this.podsThisWave < 2) {
      this.dryT += dt;
      if (this.dryT > 4) {
        this.dryT = 0;
        this.podsThisWave++;
        this.marker.reserve += 20;
        audio.play('hopper', { vol: 0.8 });
        this.ui.toast('Found a forgotten paint pod in your sleeping bag. (+20) Make them count.', 3000);
      }
    } else this.dryT = 0;
    this.updateProjectiles(dt);
    this.updateLuresDrops(dt);
    this.updateTripwires();
    if (playing) this.updateInteract(dt);
    this.director.update(dt);

    // sunrise light
    if (this.director.phase === 'sunrise') {
      this.dayMix = Math.min(1, this.dayMix + dt / 5);
      if (this.director.sunriseT > 5.5 && playing) {
        const f = this.cooler.food;
        this.endNight(true, f > 70 ? 'The cooler survived. Breakfast is saved.' : f > 35 ? 'Breakfast is… mostly saved.' : 'You held on. Barely. Dad asks why there are only two hot dogs left.');
      }
    }
    else if (this.director.wave?.isBoss) this.dayMix = Math.max(this.dayMix, Math.pow(1 - Math.max(0, this.director.bossTimer) / (this.director.wave.duration ?? 1), 3) * 0.35);

    // nerve decays when nothing is in your face
    const close = this.raccoons.some((r) => r.active && r.pos.distanceTo(this.player.pos) < 1.6 && r.state !== 'stunned');
    if (!close) this.nerve = Math.max(0, this.nerve - dt * 5);
    else this.addNerve(dt * 4);
    if (this.nerve > 40 && Math.random() < dt * (this.nerve / 50)) audio.play('heart', { vol: this.nerve / 120 });

    // mood: crickets fall silent when danger is near
    let nearest = 99;
    for (const r of this.raccoons) if (r.active && r.model.root.visible) nearest = Math.min(nearest, r.pos.distanceTo(this.player.pos));
    const danger = THREE.MathUtils.clamp(1 - (nearest - 3) / 12, 0, 1);
    this.dangerSmooth += (danger - this.dangerSmooth) * Math.min(1, dt * 2);
    const tension = Math.min(1, this.director.waveIndex / 5 + this.dangerSmooth * 0.3);
    audio.setMood(this.dangerSmooth, tension * (1 - this.dayMix), dt);
    audio.setListener(this.player.camera.position, this.player.forward());

    // warnings
    this.updateWarnings(dt);
    this.updateHUD();

    if (this.mode === 'ending') {
      this.endT += dt;
      if (this.endT > (this.endWon ? 0.5 : 2.2)) this.finishNight();
    }
  }

  private handleAction(a: string) {
    const L = this.loadout;
    switch (a) {
      case 'reload': this.marker.startReload(L); break;
      case 'flash':
        if (this.player.battery <= 0) { this.ui.toast('Flashlight batteries are dead. Spare batteries are on the picnic table.'); audio.play('flash', { vol: 0.5 }); break; }
        this.player.flashOn = !this.player.flashOn;
        audio.play('flash', { vol: 0.8 });
        break;
      case 'interact':
        if (this.interactTarget && !this.interactTarget.hold) this.interactTarget.act();
        break;
      case 'ammo': {
        const before = this.marker.ammo;
        const am = this.marker.cycleAmmo();
        if (am === before && am === 'standard') this.ui.toast('No special rounds yet — unlock them at the Trading Post.', 2200);
        break;
      }
      case 'hotdog': this.throwHotdog(); break;
      case 'pots': this.bangPots(); break;
      case 'pause': this.pause(); break;
    }
  }

  private fire(type: AmmoType) {
    const L = this.loadout;
    const cam = this.player.camera;
    const fwd = this.player.forward();
    const spread = L.spread * (this.player.moving > 0.1 ? L.moveSpreadMul : 1);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    const start = cam.position.clone().addScaledVector(fwd, 0.25).addScaledVector(up, -0.06).addScaledVector(right, 0.05);
    const color = type === 'standard' ? L.paint : AMMO_COLORS[type];
    this.projectiles.spawn(start, dir.multiplyScalar(L.muzzle), type, color);
    this.player.recoil = 1;
    // nearby raccoons flinch at the pop
    for (const rc of this.raccoons) if (rc.active && rc.pos.distanceTo(this.player.pos) < 4 && rc.def.fear > 0 && Math.random() < 0.3) rc.voiceT = 0;
  }

  private updateProjectiles(dt: number) {
    const tmpA = new THREE.Vector3();
    for (const p of this.projectiles.list) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      const dist = p.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.4));
      const h = dt / steps;
      for (let s = 0; s < steps && p.alive; s++) {
        p.prev.copy(p.pos);
        p.vel.y -= GRAVITY * h;
        p.vel.multiplyScalar(1 - 0.08 * h);
        p.pos.addScaledVector(p.vel, h);
        this.collide(p, tmpA);
      }
    }
    this.projectiles.sync();
  }

  private collide(p: Projectile, tmpA: THREE.Vector3) {
    const a = p.prev, b = p.pos;
    const seg = tmpA.subVectors(b, a);
    const segLen = seg.length();
    if (segLen < 1e-6) return;
    const dir = seg.clone().divideScalar(segLen);
    // raccoons
    let best: { r: Raccoon; t: number } | null = null;
    for (const r of this.raccoons) {
      if (r.removed || !r.model.root.visible || r.state === 'escape' || r.state === 'gone') continue;
      if (r.pos.distanceTo(a) > segLen + 3) continue;
      for (const [c, rad] of r.hitSpheres()) {
        const t = raySphere(a, dir, c, rad);
        if (t !== null && t <= segLen && (!best || t < best.t)) best = { r, t };
      }
    }
    // tent fabric
    const fab = this.tent.crossFabric(a, b);
    const fabT = fab ? fab.point.distanceTo(a) : Infinity;
    if (best && best.t < fabT) {
      const hitP = a.clone().addScaledVector(dir, best.t);
      this.impactRaccoon(p, best.r, hitP, dir);
      return;
    }
    if (fab) {
      // inside → roof: poke a climbing raccoon right through the fabric
      if (p.thrown) { this.landHotdog(p, fab.point); return; }
      const roofRac = fab.roof ? this.raccoons.find((r) => (r.state === 'roof') && Math.hypot(r.pos.x - fab.point.x, r.pos.z - fab.point.z) < 0.75) : null;
      if (roofRac && Tent.isInside(a)) {
        this.impactRaccoon(p, roofRac, fab.point, dir);
        return;
      }
      this.tent.impact(fab.point, 1);
      if (Tent.isInside(a) && fab.opening) this.hint('mesh', `That window is zipped — paint can't get through mesh. Aim at it and unzip it (${this.input.touch ? 'USE' : 'E'}).`);
      else if (Tent.isInside(a)) this.hint('fabric', 'You just painted the inside of your tent. Shoot through an open door or window.');
      this.impactSurface(p, fab.point, fab.opening ? fab.normal.clone().multiplyScalar(Tent.isInside(a) ? -1 : 1) : (Tent.isInside(a) ? fab.normal.clone().negate() : fab.normal), true);
      return;
    }
    // props
    for (const box of this.camp.boxes) {
      const t = rayBox(a, dir, box);
      if (t !== null && t <= segLen) {
        const hp = a.clone().addScaledVector(dir, t);
        if (p.thrown) { this.landHotdog(p, hp); return; }
        this.impactSurface(p, hp, boxNormal(hp, box), false);
        return;
      }
    }
    // trees
    if (b.y < 24) {
      for (const tr of this.env.trees) {
        const dx = b.x - tr.x, dz = b.z - tr.z;
        if (dx * dx + dz * dz > 4) continue;
        const t = rayCylinder(a, dir, tr.x, tr.z, tr.r);
        if (t !== null && t <= segLen) {
          const hp = a.clone().addScaledVector(dir, t);
          if (p.thrown) { this.landHotdog(p, hp.setY(0)); return; }
          const n = new THREE.Vector3(hp.x - tr.x, 0, hp.z - tr.z).normalize();
          this.impactSurface(p, hp, n, false);
          return;
        }
      }
    }
    // ground
    if (b.y <= 0.0) {
      const k = a.y / (a.y - b.y);
      const hp = a.clone().lerp(b, k);
      hp.y = 0.005;
      if (p.thrown) { this.landHotdog(p, hp); return; }
      this.impactSurface(p, hp, new THREE.Vector3(0, 1, 0), false);
    }
  }

  private impactRaccoon(p: Projectile, r: Raccoon, hitP: THREE.Vector3, dir: THREE.Vector3) {
    p.alive = false;
    if (p.thrown) { this.landHotdog(p, r.pos.clone()); return; }
    this.marker.hits++;
    this.particles.burst(hitP, dir.clone().negate(), p.color, 16, 2.5);
    if (p.type === 'burst') this.burstAt(hitP, p.color, r);
    else r.hit(hitP, dir, p.type, p.color);
    if (p.type === 'decoy') this.addLure(hitP.clone().setY(0), 'decoy');
    this.ui.hit(p.color, r.resolve <= 0);
    if (!this.firstHit) {
      this.firstHit = true;
      this.hint('hit', r.resolve > 0 ? 'Tagged it! It’ll be back. A couple more hits and it gives up.' : 'Tagged it!');
    }
    if (r.resolve <= 0 && r.state !== 'escape') audio.play('chime', { vol: 0.25, rate: 1.4 });
  }

  private impactSurface(p: Projectile, hp: THREE.Vector3, n: THREE.Vector3, fabric: boolean) {
    p.alive = false;
    this.splats.add(hp, n, p.color, fabric ? 0.13 : 0.3);
    this.particles.burst(hp, n, p.color, 9, 1.8);
    audio.play('splat', { pos: hp, vol: fabric ? 0.6 : 0.8, rate: fabric ? 0.8 : 1 });
    if (fabric) audio.play('swish', { pos: hp, vol: 0.4 });
    if (p.type === 'burst') this.burstAt(hp, p.color, null);
    if (p.type === 'decoy') this.addLure(hp.clone().setY(0), 'decoy');
    // near-miss scares: paint splatting next to a raccoon makes it jump
    for (const r of this.raccoons) {
      if (!r.active || r.isBoss) continue;
      const d = r.pos.distanceTo(hp);
      if (d < 1.1 && r.def.fear > 0 && ['lurk', 'sneak', 'approach', 'investigate', 'peek'].includes(r.state) && r.fearCooldown <= 0) {
        r.scareNoise();
      }
    }
  }

  private burstAt(p: THREE.Vector3, color: number, direct: Raccoon | null) {
    const R = this.loadout.burstRadius;
    this.particles.burst(p, new THREE.Vector3(0, 1, 0), color, 40, 5);
    audio.play('splat', { pos: p, vol: 1, rate: 0.7 });
    for (let k = 0; k < 6; k++) {
      const off = new THREE.Vector3((Math.random() - 0.5) * R * 1.4, 0.005, (Math.random() - 0.5) * R * 1.4);
      this.splats.add(p.clone().setY(0.005).add(off), new THREE.Vector3(0, 1, 0), color, 0.5);
    }
    for (const r of this.raccoons) {
      if (!r.active) continue;
      if (r === direct || r.pos.distanceTo(p) < R) {
        const hp = r.model.body.getWorldPosition(new THREE.Vector3());
        r.hit(hp, hp.clone().sub(p).setY(0).normalize(), 'burst', color);
        if (r !== direct) this.marker.hits += 0; // splash hits don't inflate accuracy
      }
    }
  }

  private addLure(pos: THREE.Vector3, kind: 'decoy' | 'hotdog', mesh?: THREE.Object3D) {
    this.lures.push({ pos, time: kind === 'decoy' ? 6 : 7, radius: kind === 'decoy' ? 10 : 15, kind, mesh });
  }

  private throwHotdog() {
    if (!this.loadout.hotdog) { this.ui.toast('Unlock the Decoy Hot Dog at the Trading Post.', 2000); return; }
    if (!this.hotdogReady) { this.ui.toast('Hot dog already thrown this wave.', 1500); return; }
    this.hotdogReady = false;
    const cam = this.player.camera;
    const fwd = this.player.forward();
    const v = fwd.clone().multiplyScalar(11).add(new THREE.Vector3(0, 4, 0));
    this.projectiles.spawn(cam.position.clone().addScaledVector(fwd, 0.4), v, 'standard', 0xc0574a, 'hotdog');
    audio.play('swish', { vol: 0.8 });
  }

  private landHotdog(p: Projectile, at: THREE.Vector3) {
    p.alive = false;
    const g = makeLoot('hotdogs');
    g.position.copy(at).setY(0.04);
    this.scene.add(g);
    this.addLure(at.clone().setY(0), 'hotdog', g);
    audio.play('drop', { pos: at, vol: 0.7 });
    this.hint('hotdog', 'Hot dog down — every raccoon nearby is going for it. Easy targets!');
  }

  private bangPots() {
    if (this.pots <= 0) { this.ui.toast(this.loadout.pots ? 'Out of pot-banging energy for tonight.' : 'Unlock Pots & Spoon at the Trading Post.', 2000); return; }
    this.pots--;
    audio.play('clang', { vol: 1.1 });
    for (const r of this.raccoons) if (r.active && r.pos.distanceTo(this.player.pos) < 14) r.scareNoise();
  }

  private updateLuresDrops(dt: number) {
    for (let i = this.lures.length - 1; i >= 0; i--) {
      const l = this.lures[i];
      l.time -= dt;
      if (l.time <= 0) { l.mesh?.removeFromParent(); this.lures.splice(i, 1); }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.time -= dt;
      d.mesh.position.y = 0.06 + Math.abs(Math.sin(this.time * 3)) * 0.02;
      if (d.time <= 0 && !d.claimed) this.recoverDrop(d, false);
      else if (d.claimed && (d.claimed.removed || d.claimed.state === 'stunned' || d.claimed.state === 'escape')) d.claimed = null;
    }
  }

  private recoverDrop(d: DroppedLoot, byPlayer: boolean) {
    const i = this.drops.indexOf(d);
    if (i < 0) return;
    this.drops.splice(i, 1);
    d.mesh.removeFromParent();
    this.cooler.food = Math.min(100, this.cooler.food + d.amount);
    this.cooler.refreshItems();
    audio.play('chime', { vol: byPlayer ? 0.7 : 0.4 });
    this.ui.toast(byPlayer ? `Recovered the ${d.kind}! (+${Math.round(d.amount)}%)` : `The ${d.kind} are back in the cooler. (+${Math.round(d.amount)}%)`, 1800);
  }

  private updateTripwires() {
    for (const tw of this.camp.tripwires) {
      if (!tw.armed) continue;
      for (const r of this.raccoons) {
        if (!r.active || r.isBoss) continue;
        // distance from raccoon to the wire segment
        const ab = tw.b.clone().sub(tw.a).setY(0);
        const ap = r.pos.clone().sub(tw.a).setY(0);
        const k = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
        const closest = tw.a.clone().setY(0).addScaledVector(ab, k);
        if (closest.distanceTo(r.pos.clone().setY(0)) < 0.35) {
          tw.armed = false;
          audio.play('trap', { pos: r.pos, vol: 1 });
          const hp = r.model.body.getWorldPosition(new THREE.Vector3());
          this.particles.burst(hp, new THREE.Vector3(0, 1, 0), 0xff7a1a, 30, 3);
          r.hit(hp, new THREE.Vector3(0, 0, 1), 'standard', 0xff7a1a);
          this.ui.toast('Tripwire got one!', 1500);
          break;
        }
      }
    }
  }

  private interactables(): Interactable[] {
    const list: Interactable[] = [];
    const E = this.input.touch ? 'USE' : 'E';
    for (const op of this.tent.openings) {
      if (op.state === 'torn') {
        list.push({ label: `Hold ${E} — duct-tape the ${op.label}`, pos: op.center, range: 1.7, hold: this.loadout.repairTime, act: () => {
          this.tent.setState(op, 'mesh'); audio.play('tape', { pos: op.center, vol: 0.8 });
        } });
      } else {
        list.push({ label: `${E} — ${op.state === 'open' ? 'Zip' : 'Unzip'} the ${op.label}`, pos: op.center, range: 1.6, act: () => {
          this.tent.setState(op, op.state === 'open' ? 'mesh' : 'open');
          audio.play('zipper', { pos: op.center, vol: 0.9 });
          this.tent.impact(op.center, 0.4);
        } });
      }
    }
    const c = this.cooler;
    const cpos = c.pos.clone().setY(0.4);
    if (c.lidTarget > 0) list.push({ label: `${E} — Slam the cooler lid`, pos: cpos, range: 1.9, act: () => { c.lidTarget = 0; audio.play('thunk', { pos: cpos, vol: 1 }); } });
    else if (c.strap <= 0) {
      if (c.strapCooldown > 0) list.push({ label: `Bungee is stretched out (${Math.ceil(c.strapCooldown)}s)`, pos: cpos, range: 1.9, act: () => {} });
      else list.push({ label: `${E} — Bungee-strap the cooler`, pos: cpos, range: 1.9, act: () => {
        c.strap = this.loadout.bungeeTime; c.strapCooldown = this.loadout.bungeeTime + 12; audio.play('zipper', { pos: cpos, vol: 0.7, rate: 0.6 });
      } });
    }
    for (const l of this.camp.lanterns) {
      list.push({ label: `${E} — ${l.on ? 'Turn off' : 'Light'} the ${l.label}${l.on ? '' : ' (lights them up… and draws them in)'}`, pos: l.pos, range: 2.0, act: () => {
        l.on = !l.on; audio.play('click', { pos: l.pos, vol: 1 });
      } });
    }
    const radio = this.camp.radio;
    if (radio.battery > 0) list.push({ label: `${E} — ${radio.on ? 'Turn off' : 'Turn on'} the radio${radio.on ? '' : ' (scares them off the tent, but drowns out their sounds)'}`, pos: radio.pos, range: 1.7, act: () => {
      radio.on = !radio.on; audio.play('click', { pos: radio.pos, vol: 1 });
    } });
    const sb = this.camp.spareBatteries;
    if (sb.uses > 0) list.push({ label: `${E} — Swap in spare batteries (${sb.uses} left)`, pos: sb.pos, range: 2.0, act: () => {
      sb.uses--; this.player.battery = this.loadout.battery; audio.play('flash', { vol: 1 }); this.ui.toast('Fresh batteries. The flashlight is blazing again.', 1800);
    } });
    for (const d of this.drops) list.push({ label: `${E} — Grab the ${d.kind}`, pos: d.pos.clone().setY(0.2), range: 1.8, act: () => this.recoverDrop(d, true) });
    return list;
  }

  private updateInteract(dt: number) {
    const cam = this.player.camera;
    const fwd = this.player.forward();
    let best: Interactable | null = null;
    let bs = -1;
    // The kid never leaves their post, so USE works on whatever the crosshair is on.
    for (const it of this.interactables()) {
      const to = it.pos.clone().sub(cam.position);
      const d = to.length();
      if (d > Game.USE_RANGE) continue;
      const facing = to.dot(fwd) / Math.max(0.01, d);
      if (facing <= 0) continue;
      const off = Math.acos(Math.min(1, facing)); // radians off the crosshair
      const tol = Math.max(0.09, Math.atan2(0.55, d)); // ~half a metre of slack around the target
      if (off > tol) continue;
      const score = 1 - off / tol - d * 0.01;
      if (score > bs) { bs = score; best = it; }
    }
    this.interactTarget = best;
    if (best?.hold) {
      if (this.input.interactHeld) {
        this.holdT += dt;
        if (Math.random() < dt * 4) audio.play('tape', { vol: 0.25, rate: 1.4 });
        if (this.holdT >= best.hold) { best.act(); this.holdT = 0; this.input.interactHeld = false; }
      } else this.holdT = 0;
    } else this.holdT = 0;
    const label = best ? (best.hold && this.holdT > 0 ? `Taping… ${Math.round((this.holdT / best.hold) * 100)}%` : best.label) : null;
    this.ui.prompt(label);
    this.input.useBtn.classList.toggle('ready', !!best);
  }

  private updateWarnings(dt: number) {
    const list: Warning[] = [];
    const yaw = this.player.yaw;
    const fwd = this.player.forward();
    const angleTo = (p: THREE.Vector3) => {
      const dx = p.x - this.player.pos.x, dz = p.z - this.player.pos.z;
      // screen angle: 0 = up (ahead), clockwise positive
      const world = Math.atan2(dx, -dz);
      const facing = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
      const fa = Math.atan2(fwd.x, -fwd.z);
      void facing;
      return world - fa;
    };
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.t -= dt;
      if (w.t <= 0) { this.warnings.splice(i, 1); continue; }
      list.push({ angle: angleTo(w.pos), kind: w.kind, strength: Math.min(1, w.t) });
    }
    const L = this.loadout;
    const cam = this.player.camera;
    for (const r of this.raccoons) {
      if (!r.active || !r.model.root.visible) continue;
      const d = r.pos.distanceTo(this.player.pos);
      let kind: Warning['kind'] | null = null;
      if (r.state === 'steal') kind = 'steal';
      else if (r.state === 'attack' || r.state === 'roof' || r.state === 'inside' || r.state === 'enterTent') kind = 'tent';
      else if (r.state === 'distract') kind = 'noise';
      else if (r.isBoss) kind = 'boss';
      else if (r.carrying) kind = 'steal';
      else {
        const sneaky = r.def.id === 'sneak' || r.def.id === 'acrobat';
        const range = L.motion ? 30 : sneaky ? 8 : 18;
        if (d < range && ['approach', 'sneak', 'charge'].includes(r.state)) kind = 'approach';
      }
      if (!kind) continue;
      // hide indicators for raccoons comfortably on screen
      const v = r.pos.clone().setY(0.4).project(cam);
      const onScreen = v.z < 1 && Math.abs(v.x) < 0.75 && Math.abs(v.y) < 0.8;
      if (onScreen && kind === 'approach') continue;
      list.push({ angle: angleTo(r.pos), kind, strength: onScreen ? 0.45 : 1 });
    }
    if (L.motion) {
      // little chime when a new sneaky one enters 30m
      for (const r of this.raccoons) if (r.active && (r.def.id === 'sneak' || r.def.id === 'acrobat') && r.stateTime < dt && r.state === 'sneak') audio.play('chime', { vol: 0.25, rate: 2 });
    }
    this.ui.setWarnings(list.slice(0, 10));
  }

  private updateHUD() {
    const d = this.director;
    const w = d.wave;
    const ck = Director.clockString(d.clock);
    this.ui.hud({
      clock: ck.time, ampm: ck.ampm,
      wave: w ? w.name : '',
      waveNum: w ? (w.isBoss ? 'FINAL' : `W${d.waveIndex + 1}/${d.totalWaves - 1}`) : '',
      food: this.cooler.food, strapped: this.cooler.strap, nerve: this.nerve,
      hopper: this.marker.hopper, hopperMax: this.loadout.hopper, reserve: this.marker.reserve,
      ammo: this.marker.ammo, ammoColor: this.marker.color, specials: this.marker.specials,
      reload: this.marker.reloading > 0 ? 1 - this.marker.reloading / this.marker.reloadTotal : 0,
      battery: this.player.battery / this.loadout.battery, flashOn: this.player.flashOn,
      hotdog: this.loadout.hotdog && this.hotdogReady, pots: this.pots,
      bossTimer: w?.isBoss && d.phase === 'wave' ? 1 - Math.max(0, d.bossTimer) / (w.duration ?? 1) : null,
      inTent: this.player.inTent, radio: this.camp.radio.battery, radioOn: this.camp.radio.on,
    });
    const inp = this.input;
    inp.ammoBtn.style.display = Object.values(this.marker.specials).some((v) => v > 0) || this.marker.ammo !== 'standard' ? '' : 'none';
    inp.hotdogBtn.style.display = this.loadout.hotdog ? '' : 'none';
    inp.potsBtn.style.display = this.loadout.pots ? '' : 'none';
    inp.lightBtn.classList.toggle('on', this.player.flashOn);
  }

  render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.player.camera);
    if (this.mode === 'playing' || this.mode === 'ending' || this.mode === 'paused') {
      // first-person marker on top
      r.clearDepth();
      this.marker.root.position.copy(this.player.camera.position);
      this.marker.root.quaternion.copy(this.player.camera.quaternion);
      r.render(this.marker.scene, this.player.camera);
    }
  }
}

// ─── geometry helpers ───────────────────────────────────
function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return cc < 0 ? 0 : null;
  return t;
}

function rayBox(o: THREE.Vector3, d: THREE.Vector3, box: THREE.Box3): number | null {
  let tmin = 0, tmax = Infinity;
  for (const ax of ['x', 'y', 'z'] as const) {
    const inv = 1 / (d[ax] || 1e-9);
    let t1 = (box.min[ax] - o[ax]) * inv, t2 = (box.max[ax] - o[ax]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

function boxNormal(p: THREE.Vector3, box: THREE.Box3): THREE.Vector3 {
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const d = p.clone().sub(c);
  const ax = Math.abs(d.x / s.x), ay = Math.abs(d.y / s.y), az = Math.abs(d.z / s.z);
  if (ax > ay && ax > az) return new THREE.Vector3(Math.sign(d.x), 0, 0);
  if (ay > az) return new THREE.Vector3(0, Math.sign(d.y), 0);
  return new THREE.Vector3(0, 0, Math.sign(d.z));
}

function rayCylinder(o: THREE.Vector3, d: THREE.Vector3, cx: number, cz: number, r: number): number | null {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 ? t : null;
}
