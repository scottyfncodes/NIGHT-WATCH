import { UPGRADES, UpgradeId, PAINT_COLORS, AmmoType, AMMO_NAMES, AMMO_COLORS } from './config';
import { SaveData, Settings, level, nextCost, computeLoadout, Loadout } from './save';

const CRATE = `<svg class="crate" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M1.5 7.5h13M5.5 3.5v10M10.5 3.5v10" stroke="currentColor" stroke-width="1.2"/></svg>`;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export interface HudData {
  clock: string; ampm: string; wave: string; waveNum: string;
  food: number; strapped: number; nerve: number;
  hopper: number; hopperMax: number; reserve: number;
  ammo: AmmoType; ammoColor: number; specials: Record<string, number>;
  reload: number; battery: number; flashOn: boolean;
  hotdog: boolean; pots: number; bossTimer: number | null; inTent: boolean;
  radio: number; radioOn: boolean;
}

export interface Warning { angle: number; kind: 'approach' | 'steal' | 'tent' | 'noise' | 'boss'; strength: number }

export interface ResultData {
  won: boolean; reason: string; night: number; food: number; deterred: number; accuracy: number;
  lines: [string, number][]; total: number; supplies: number;
}

export class UI {
  root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private toastTimer = 0;
  private bannerTimer = 0;
  private warnEls: HTMLElement[] = [];
  onPlay: () => void = () => {};
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onQuit: () => void = () => {};
  onBuy: (id: UpgradeId) => void = () => {};
  onPaint: (id: string) => void = () => {};
  onSettings: (s: Settings) => void = () => {};
  onReset: () => void = () => {};
  onNext: () => void = () => {};
  onClick: () => void = () => {};
  private settingsBack: string = 'menu';
  private shopBack: string = 'menu';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'ui';
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <div class="grain"></div>
      <div class="vignette"></div>
      <div class="nerve-vignette"></div>
      <div class="fade"></div>

      <section class="screen menu" data-screen="menu">
        <div class="menu-inner">
          <div class="eyes-mark" aria-hidden="true"><i></i><i></i></div>
          <h1 class="wordmark"><span>NIGHT</span><span>WATCH</span></h1>
          <p class="tagline">One kid. One tent. Fifteen raccoons. No backup.</p>
          <nav class="menu-nav">
            <button class="btn primary" data-act="play"><span class="play-label">Start the Night</span><small class="play-sub">Night 1</small></button>
            <div class="menu-row">
              <button class="btn" data-act="equipment">Equipment</button>
              <button class="btn" data-act="upgrades">Upgrades</button>
              <button class="btn" data-act="settings">Settings</button>
            </div>
          </nav>
          <div class="menu-foot"><span class="supplies-chip">${CRATE}<b class="sup-count">0</b> supplies</span><span class="loc">Piney Woods, East Texas · Summer 1998</span></div>
        </div>
      </section>

      <section class="screen intro" data-screen="intro">
        <div class="intro-lines"></div>
        <button class="skip" data-act="skip">Skip ›</button>
      </section>

      <section class="screen hud" data-screen="hud">
        <div class="watch">
          <div class="watch-face">
            <div class="watch-time"><b class="clock">10:25</b><small class="ampm">PM</small></div>
            <div class="watch-sub"><span class="wave-num">W1</span><span class="wave-name">The Visitor</span></div>
          </div>
          <div class="sunrise-bar"><i></i></div>
        </div>
        <button class="pause-btn" data-act="pause" aria-label="Pause"><i></i><i></i></button>
        <div class="food">
          <div class="food-icon" aria-hidden="true"><i class="lid"></i><i class="box"></i></div>
          <div class="food-meta">
            <div class="food-top"><span>COOLER</span><b class="food-pct">100%</b><em class="strap-chip">STRAPPED</em></div>
            <div class="food-bar"><i></i></div>
            <div class="nerve"><span>NERVE</span><div class="nerve-bar"><i></i></div></div>
          </div>
        </div>
        <div class="ammo">
          <div class="ammo-main"><b class="hopper">12</b><span class="reserve">/ 110</span></div>
          <div class="ammo-type"><i class="ammo-dot"></i><span class="ammo-name">Standard</span><span class="ammo-count"></span></div>
          <div class="gear"><span class="batt"><i></i></span><span class="radio-chip">RADIO</span><span class="gadget-chip hd">🌭</span><span class="gadget-chip pt">🔔<b>2</b></span></div>
        </div>
        <div class="crosshair"><i class="dot"></i><svg class="ring" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16"/></svg></div>
        <div class="hitmarker"></div>
        <div class="warnings"></div>
        <div class="prompt"></div>
        <div class="banner"><small class="banner-kicker"></small><h2 class="banner-title"></h2><p class="banner-sub"></p></div>
        <div class="toast"></div>
        <div class="keys-hint">WASD move · Mouse aim · Click fire · R reload · F light · E use · Q ammo · Esc pause</div>
      </section>

      <section class="screen panel-screen pause" data-screen="pause">
        <div class="card small">
          <h2 class="card-title">Paused</h2>
          <p class="card-sub">The raccoons are waiting. Politely.</p>
          <div class="stack">
            <button class="btn primary" data-act="resume">Resume</button>
            <button class="btn" data-act="pause-settings">Settings</button>
            <button class="btn" data-act="restart">Restart Night</button>
            <button class="btn ghost" data-act="quit">Quit to Menu</button>
          </div>
        </div>
      </section>

      <section class="screen panel-screen results" data-screen="results">
        <div class="card report">
          <div class="report-head"><small class="report-kicker">Incident Report · Night 1</small><h2 class="report-title">Sunrise</h2><p class="report-reason"></p></div>
          <dl class="report-stats"></dl>
          <div class="report-earn"><span>Supplies earned</span><b class="earn-total">+0</b></div>
          <ul class="report-lines"></ul>
          <div class="stack row">
            <button class="btn primary" data-act="next">Next Night</button>
            <button class="btn" data-act="results-upgrades">Upgrades</button>
            <button class="btn ghost" data-act="results-menu">Menu</button>
          </div>
        </div>
      </section>

      <section class="screen panel-screen upgrades" data-screen="upgrades">
        <div class="card wide">
          <div class="card-head"><div><small class="kicker">Trading Post</small><h2 class="card-title">Upgrades</h2></div><span class="supplies-chip big">${CRATE}<b class="sup-count">0</b></span></div>
          <div class="tabs"><button data-tab="weapon" class="on">Marker</button><button data-tab="defense">Defense</button><button data-tab="utility">Utility</button></div>
          <div class="upgrade-list"></div>
          <div class="card-foot"><button class="btn primary" data-act="shop-play">Start Night</button><button class="btn ghost" data-act="shop-back">Back</button></div>
        </div>
      </section>

      <section class="screen panel-screen equipment" data-screen="equipment">
        <div class="card wide">
          <div class="card-head"><div><small class="kicker">The Duffel Bag</small><h2 class="card-title">Equipment</h2></div></div>
          <div class="equip-grid"></div>
          <h3 class="sub-title">Paint color</h3>
          <div class="paint-row"></div>
          <div class="card-foot"><button class="btn ghost" data-act="equip-back">Back</button></div>
        </div>
      </section>

      <section class="screen panel-screen settings" data-screen="settings">
        <div class="card">
          <h2 class="card-title">Settings</h2>
          <div class="settings-form">
            <label>Volume <input type="range" min="0" max="1" step="0.05" data-set="volume"></label>
            <label>Night ambience <input type="range" min="0" max="1" step="0.05" data-set="ambience"></label>
            <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-set="sensitivity"></label>
            <label>Touch sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-set="touchSensitivity"></label>
            <label class="check"><input type="checkbox" data-set="invertY"> Invert look</label>
            <label class="check"><input type="checkbox" data-set="hints"> Show hints</label>
            <label>Graphics
              <select data-set="quality"><option value="low">Low (battery saver)</option><option value="medium">Medium</option><option value="high">High</option></select>
            </label>
            <p class="note">Graphics changes apply on the next night.</p>
          </div>
          <div class="card-foot"><button class="btn primary" data-act="settings-back">Done</button><button class="btn ghost danger" data-act="reset">Reset progress</button></div>
        </div>
      </section>

      <div class="rotate-hint">Turn your phone sideways for the best view</div>
    `;
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    const keys = ['clock', 'ampm', 'wave-num', 'wave-name', 'food-pct', 'strap-chip', 'hopper', 'reserve', 'ammo-name', 'ammo-count', 'ammo-dot',
      'prompt', 'banner', 'banner-kicker', 'banner-title', 'banner-sub', 'toast', 'hitmarker', 'warnings', 'crosshair', 'nerve', 'fade', 'nerve-vignette',
      'batt', 'gadget-chip hd', 'gadget-chip pt', 'sunrise-bar', 'radio-chip', 'intro-lines', 'food', 'keys-hint', 'play-sub', 'play-label'];
    for (const k of keys) this.els[k] = q('.' + k.replace(' ', '.'));
    this.els.foodBar = q('.food-bar i');
    this.els.nerveBar = q('.nerve-bar i');
    this.els.ring = q('.crosshair .ring circle');
    this.els.sunFill = q('.sunrise-bar i');

    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act],[data-tab],[data-buy],[data-paint]') as HTMLElement | null;
      if (!t) return;
      this.onClick();
      const act = t.dataset.act;
      if (t.dataset.tab) { this.tab = t.dataset.tab as any; this.renderUpgrades(this.lastSave!); return; }
      if (t.dataset.buy) { this.onBuy(t.dataset.buy as UpgradeId); return; }
      if (t.dataset.paint) { this.onPaint(t.dataset.paint); return; }
      switch (act) {
        case 'play': case 'shop-play': this.onPlay(); break;
        case 'equipment': this.show('equipment'); break;
        case 'upgrades': this.shopBack = 'menu'; this.show('upgrades'); break;
        case 'results-upgrades': this.shopBack = 'results'; this.show('upgrades'); break;
        case 'settings': this.settingsBack = 'menu'; this.show('settings'); break;
        case 'pause-settings': this.settingsBack = 'pause'; this.show('settings'); break;
        case 'settings-back': this.show(this.settingsBack); break;
        case 'equip-back': this.show('menu'); break;
        case 'shop-back': this.show(this.shopBack); break;
        case 'resume': this.onResume(); break;
        case 'restart': this.onRestart(); break;
        case 'quit': case 'results-menu': this.onQuit(); break;
        case 'next': this.onNext(); break;
        case 'reset': if (confirm('Reset all progress and upgrades?')) this.onReset(); break;
        case 'skip': this.skipIntro = true; break;
        case 'pause': this.onPauseBtn(); break;
      }
    });
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-set]').forEach((el) => {
      el.addEventListener('input', () => this.emitSettings());
      el.addEventListener('change', () => this.emitSettings());
    });
  }
  onPauseBtn: () => void = () => {};
  skipIntro = false;
  tab: 'weapon' | 'defense' | 'utility' = 'weapon';
  lastSave: SaveData | null = null;
  current = '';

  show(name: string) {
    this.current = name;
    this.root.querySelectorAll<HTMLElement>('.screen').forEach((s) => s.classList.toggle('on', s.dataset.screen === name));
    this.root.classList.toggle('in-game', name === 'hud');
    if (name === 'upgrades' && this.lastSave) this.renderUpgrades(this.lastSave);
    if (name === 'equipment' && this.lastSave) this.renderEquipment(this.lastSave);
    if (name === 'settings' && this.lastSave) this.renderSettings(this.lastSave.settings);
  }

  setTouch(on: boolean) { document.body.classList.toggle('touch', on); }

  refreshMenu(save: SaveData) {
    this.lastSave = save;
    this.root.querySelectorAll('.sup-count').forEach((e) => (e.textContent = String(save.supplies)));
    this.els['play-sub'].textContent = `Night ${save.night}${save.bestNight ? ` · best: night ${save.bestNight}` : ''}`;
    this.els['play-label'].textContent = save.night === 1 && !save.bestNight ? 'Start the Night' : 'Next Night';
  }

  fade(on: boolean) { this.els.fade.classList.toggle('on', on); }

  async intro(): Promise<void> {
    this.skipIntro = false;
    this.show('intro');
    const lines = [
      'East Texas. July, 1998.',
      'The pop-up camper was full, so you got the tent.',
      'Around midnight, the cooler lid creaked open.',
      'You grabbed the paintball gun.',
    ];
    const box = this.els['intro-lines'];
    box.innerHTML = '';
    for (const l of lines) {
      const p = document.createElement('p');
      p.textContent = l;
      box.appendChild(p);
      await this.wait(40);
      p.classList.add('on');
      await this.wait(1900);
      if (this.skipIntro) break;
    }
    if (!this.skipIntro) await this.wait(500);
  }

  private wait(ms: number) {
    return new Promise<void>((r) => {
      const start = performance.now();
      const tick = () => (this.skipIntro || performance.now() - start >= ms ? r() : requestAnimationFrame(tick));
      tick();
    });
  }

  toast(text: string, ms = 3600) {
    const t = this.els.toast;
    t.textContent = text;
    t.classList.add('on');
    this.toastTimer = ms / 1000;
  }

  banner(kicker: string, title: string, sub: string, secs = 3.2) {
    this.els['banner-kicker'].textContent = kicker;
    this.els['banner-title'].textContent = title;
    this.els['banner-sub'].textContent = sub;
    this.els.banner.classList.remove('on');
    void this.els.banner.offsetWidth;
    this.els.banner.classList.add('on');
    this.bannerTimer = secs;
  }

  prompt(text: string | null) {
    const p = this.els.prompt;
    if (text) { if (p.textContent !== text) p.textContent = text; p.classList.add('on'); }
    else p.classList.remove('on');
  }

  hit(color: number, big: boolean) {
    const h = this.els.hitmarker;
    h.style.setProperty('--hc', hex(color));
    h.classList.remove('on', 'big');
    void h.offsetWidth;
    h.classList.add('on');
    if (big) h.classList.add('big');
  }

  tick(dt: number) {
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.els.toast.classList.remove('on'); }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.els.banner.classList.remove('on'); }
  }

  hud(d: HudData) {
    const set = (k: string, v: string) => { const e = this.els[k]; if (e.textContent !== v) e.textContent = v; };
    set('clock', d.clock);
    set('ampm', d.ampm);
    set('wave-num', d.waveNum);
    set('wave-name', d.wave);
    set('food-pct', `${Math.ceil(d.food)}%`);
    this.els.foodBar.style.transform = `scaleX(${Math.max(0, d.food) / 100})`;
    this.els.food.classList.toggle('low', d.food < 30);
    this.els['strap-chip'].classList.toggle('on', d.strapped > 0);
    this.els['strap-chip'].textContent = d.strapped > 0 ? `STRAPPED ${Math.ceil(d.strapped)}s` : 'STRAPPED';
    this.els.nerve.classList.toggle('on', d.nerve > 1);
    this.els.nerveBar.style.transform = `scaleX(${d.nerve / 100})`;
    this.els['nerve-vignette'].style.opacity = String(Math.min(1, Math.pow(d.nerve / 100, 1.4)));
    set('hopper', String(d.hopper));
    set('reserve', `/ ${d.reserve}`);
    this.els.hopper.classList.toggle('empty', d.hopper === 0);
    set('ammo-name', AMMO_NAMES[d.ammo]);
    set('ammo-count', d.ammo === 'standard' ? '' : `×${d.specials[d.ammo]}`);
    this.els['ammo-dot'].style.background = hex(d.ammoColor);
    const r = this.els.ring as unknown as SVGCircleElement;
    const C = 2 * Math.PI * 16;
    r.style.strokeDasharray = `${C}`;
    r.style.strokeDashoffset = `${C * (1 - d.reload)}`;
    this.els.crosshair.classList.toggle('reloading', d.reload > 0 && d.reload < 1);
    const b = this.els.batt;
    (b.firstElementChild as HTMLElement).style.transform = `scaleX(${d.battery})`;
    b.classList.toggle('on', d.flashOn);
    b.classList.toggle('low', d.battery < 0.18);
    this.els['gadget-chip hd'].classList.toggle('on', d.hotdog);
    this.els['gadget-chip pt'].classList.toggle('on', d.pots > 0);
    (this.els['gadget-chip pt'].querySelector('b') as HTMLElement).textContent = String(d.pots);
    this.els['radio-chip'].classList.toggle('on', d.radioOn);
    this.els['radio-chip'].textContent = d.radioOn ? `RADIO ${Math.ceil(d.radio)}s` : 'RADIO';
    if (d.bossTimer !== null) {
      this.els['sunrise-bar'].classList.add('on');
      this.els.sunFill.style.transform = `scaleX(${d.bossTimer})`;
    } else this.els['sunrise-bar'].classList.remove('on');
  }

  setWarnings(list: Warning[]) {
    while (this.warnEls.length < list.length) {
      const e = document.createElement('i');
      this.els.warnings.appendChild(e);
      this.warnEls.push(e);
    }
    this.warnEls.forEach((e, i) => {
      const w = list[i];
      if (!w) { e.style.opacity = '0'; return; }
      e.className = `warn ${w.kind}`;
      e.style.opacity = String(Math.min(1, w.strength));
      e.style.transform = `rotate(${w.angle}rad)`;
    });
  }

  showResults(r: ResultData) {
    const card = this.root.querySelector('.report') as HTMLElement;
    card.classList.toggle('lost', !r.won);
    (card.querySelector('.report-kicker') as HTMLElement).textContent = `Incident Report · Night ${r.night}`;
    (card.querySelector('.report-title') as HTMLElement).textContent = r.won ? 'Sunrise.' : 'Raccoons Win.';
    (card.querySelector('.report-reason') as HTMLElement).textContent = r.reason;
    (card.querySelector('.report-stats') as HTMLElement).innerHTML = `
      <div><dt>Food left</dt><dd>${Math.ceil(r.food)}%</dd></div>
      <div><dt>Raccoons deterred</dt><dd>${r.deterred}</dd></div>
      <div><dt>Accuracy</dt><dd>${Math.round(r.accuracy * 100)}%</dd></div>`;
    (card.querySelector('.report-lines') as HTMLElement).innerHTML = r.lines.map(([k, v]) => `<li><span>${k}</span><i></i><b>+${v}</b></li>`).join('');
    const tot = card.querySelector('.earn-total') as HTMLElement;
    const nextBtn = card.querySelector('[data-act="next"]') as HTMLElement;
    nextBtn.textContent = r.won ? `Night ${r.night + 1} →` : 'Try Again';
    this.show('results');
    // count-up
    const start = performance.now();
    const run = () => {
      const k = Math.min(1, (performance.now() - start) / 1100);
      tot.innerHTML = `+${Math.round(r.total * (1 - Math.pow(1 - k, 3)))} ${CRATE}`;
      if (k < 1) requestAnimationFrame(run);
    };
    run();
  }

  renderUpgrades(save: SaveData) {
    this.lastSave = save;
    this.root.querySelectorAll('.sup-count').forEach((e) => (e.textContent = String(save.supplies)));
    this.root.querySelectorAll<HTMLElement>('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const list = this.root.querySelector('.upgrade-list') as HTMLElement;
    list.innerHTML = UPGRADES.filter((u) => u.cat === this.tab).map((u) => {
      const lv = level(save, u.id);
      const max = u.costs.length;
      const cost = nextCost(save, u.id);
      const afford = cost !== null && save.supplies >= cost;
      const desc = lv >= max ? u.desc[max - 1] : u.desc[lv];
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      return `<article class="upg ${lv > 0 ? 'owned' : ''} ${lv >= max ? 'maxed' : ''}">
        <div class="badge"><span>${u.icon}</span></div>
        <div class="upg-body"><h4>${u.name}</h4><p>${desc}</p><div class="pips">${pips}</div></div>
        <button class="buy ${afford ? '' : 'cant'}" data-buy="${u.id}" ${cost === null ? 'disabled' : ''}>${cost === null ? 'MAXED' : `${CRATE}${cost}`}</button>
      </article>`;
    }).join('');
  }

  renderEquipment(save: SaveData) {
    this.lastSave = save;
    const L: Loadout = computeLoadout(save);
    const bar = (v: number, max: number) => `<span class="sbar"><i style="transform:scaleX(${Math.min(1, v / max)})"></i></span>`;
    const specials = (['glow', 'sticky', 'burst', 'decoy'] as const).map((k) =>
      `<span class="spec ${L.specials[k] ? '' : 'locked'}"><i style="background:${hex(AMMO_COLORS[k])}"></i>${AMMO_NAMES[k]} ${L.specials[k] ? '×' + L.specials[k] : '—'}</span>`).join('');
    (this.root.querySelector('.equip-grid') as HTMLElement).innerHTML = `
      <div class="eq"><h4>${L.semiAuto ? 'Semi-auto marker' : 'Pump-action marker'}</h4>
        <dl><dt>Fire rate</dt><dd>${bar(1 / L.fireInterval, 5.3)}</dd>
        <dt>Accuracy</dt><dd>${bar(0.03 - L.spread, 0.02)}</dd>
        <dt>Velocity</dt><dd>${bar(L.muzzle, 56)}</dd>
        <dt>Hopper</dt><dd>${L.hopper} balls</dd>
        <dt>Reload</dt><dd>${L.reload.toFixed(1)}s</dd>
        <dt>Paint per night</dt><dd>${L.reserve + L.hopper}</dd></dl></div>
      <div class="eq"><h4>Special rounds</h4><div class="specs">${specials}</div>
        <h4>Gear</h4>
        <dl><dt>Flashlight</dt><dd>${L.beamRange}m · ${Math.round(L.battery)}s battery</dd>
        <dt>Bungee strap</dt><dd>${L.bungeeTime}s${L.autoStrap ? ' · auto' : ''}</dd>
        <dt>Tripwires</dt><dd>${L.tripwires || '—'}</dd>
        <dt>Motion alarm</dt><dd>${L.motion ? 'Yes' : '—'}</dd>
        <dt>Decoy hot dog</dt><dd>${L.hotdog ? '1 per wave' : '—'}</dd>
        <dt>Pots &amp; spoon</dt><dd>${L.pots ? L.pots + ' per night' : '—'}</dd></dl></div>`;
    (this.root.querySelector('.paint-row') as HTMLElement).innerHTML = PAINT_COLORS.map((p) =>
      `<button class="paint ${save.paint === p.id ? 'on' : ''}" data-paint="${p.id}" style="--pc:${hex(p.hex)}"><i></i>${p.name}</button>`).join('');
  }

  renderSettings(s: Settings) {
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-set]').forEach((el) => {
      const k = el.dataset.set as keyof Settings;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(s[k]);
      else el.value = String(s[k]);
    });
  }

  private emitSettings() {
    if (!this.lastSave) return;
    const s = { ...this.lastSave.settings } as any;
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-set]').forEach((el) => {
      const k = el.dataset.set!;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') s[k] = el.checked;
      else if (el instanceof HTMLInputElement) s[k] = parseFloat(el.value);
      else s[k] = el.value;
    });
    this.onSettings(s);
  }
}
