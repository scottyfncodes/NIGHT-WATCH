import * as THREE from 'three';

export type Action = 'reload' | 'flash' | 'interact' | 'ammo' | 'hotdog' | 'pots' | 'pause';

export const isTouch = () =>
  typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;

export class Input {
  keys = new Set<string>();
  look = new THREE.Vector2();
  fireHeld = false;
  interactHeld = false;
  actions: Action[] = [];
  locked = false;
  enabled = false;
  touch: boolean;
  onLockLost: (() => void) | null = null;
  sensitivity = 1;
  touchSensitivity = 1;
  invertY = false;

  private lookIds = new Map<number, THREE.Vector2>();
  private touchRoot: HTMLElement;
  useBtn: HTMLElement;
  ammoBtn: HTMLElement;
  hotdogBtn: HTMLElement;
  potsBtn: HTMLElement;
  lightBtn: HTMLElement;
  reloadBtn: HTMLElement;

  constructor(private canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.touch = isTouch();
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === 'KeyR') this.actions.push('reload');
      if (k === 'KeyF') this.actions.push('flash');
      if (k === 'KeyE') { this.actions.push('interact'); this.interactHeld = true; }
      if (k === 'KeyQ' || k === 'Digit2') this.actions.push('ammo');
      if (k === 'KeyG') this.actions.push('hotdog');
      if (k === 'KeyN') this.actions.push('pots');
      if (k === 'Escape' || k === 'KeyP') this.actions.push('pause');
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE') this.interactHeld = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.fireHeld = false; this.interactHeld = false; });

    // Mouse
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touch) return;
      if (!this.locked) { this.requestLock(); }
      if (e.button === 0) this.fireHeld = true;
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.fireHeld = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.touch) return;
      if (this.locked || e.buttons & 1) {
        this.look.x += e.movementX * this.sensitivity;
        this.look.y += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked && this.enabled && this.onLockLost) this.onLockLost();
    });

    // Touch controls
    this.touchRoot = document.createElement('div');
    this.touchRoot.id = 'touch';
    this.touchRoot.innerHTML = `
      <div class="look-zone" data-zone="look"></div>
      <button class="tbtn fire" data-act="fire" aria-label="Fire"><span>FIRE</span></button>
      <button class="tbtn reload" data-act="reload" aria-label="Reload"><span>RELOAD</span></button>
      <button class="tbtn light" data-act="flash" aria-label="Flashlight"><span>LIGHT</span></button>
      <button class="tbtn use" data-act="interact" aria-label="Use"><span>USE</span></button>
      <button class="tbtn ammo" data-act="ammo" aria-label="Switch ammo"><span>AMMO</span></button>
      <button class="tbtn gadget hotdog" data-act="hotdog" aria-label="Throw hot dog"><span>🌭</span></button>
      <button class="tbtn gadget pots" data-act="pots" aria-label="Bang pots"><span>🔔</span></button>
    `;
    overlay.appendChild(this.touchRoot);
    this.useBtn = this.touchRoot.querySelector('.use')!;
    this.ammoBtn = this.touchRoot.querySelector('.ammo')!;
    this.hotdogBtn = this.touchRoot.querySelector('.hotdog')!;
    this.potsBtn = this.touchRoot.querySelector('.pots')!;
    this.lightBtn = this.touchRoot.querySelector('.light')!;
    this.reloadBtn = this.touchRoot.querySelector('.reload')!;
    this.touchRoot.style.display = 'none';

    const zoneLook = this.touchRoot.querySelector('[data-zone="look"]') as HTMLElement;


    const startLook = (e: PointerEvent, el: HTMLElement) => {
      this.lookIds.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
      try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
    };
    const moveLook = (e: PointerEvent) => {
      const last = this.lookIds.get(e.pointerId);
      if (!last) return;
      const k = 0.55 * this.touchSensitivity;
      this.look.x += (e.clientX - last.x) * k;
      this.look.y += (e.clientY - last.y) * k * (this.invertY ? -1 : 1);
      last.set(e.clientX, e.clientY);
    };
    const endLook = (e: PointerEvent) => { this.lookIds.delete(e.pointerId); };
    zoneLook.addEventListener('pointerdown', (e) => { e.preventDefault(); startLook(e, zoneLook); });
    zoneLook.addEventListener('pointermove', moveLook);
    zoneLook.addEventListener('pointerup', endLook);
    zoneLook.addEventListener('pointercancel', endLook);

    this.touchRoot.querySelectorAll<HTMLButtonElement>('.tbtn').forEach((b) => {
      const act = b.dataset.act!;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('down');
        if (act === 'fire') {
          this.fireHeld = true;
          startLook(e, b); // drag the fire button to aim while shooting
        } else {
          this.actions.push(act as Action);
          if (act === 'interact') this.interactHeld = true;
        }
      });
      if (act === 'fire') b.addEventListener('pointermove', moveLook);
      const up = (e: PointerEvent) => {
        b.classList.remove('down');
        if (act === 'fire') { this.fireHeld = false; endLook(e); }
        if (act === 'interact') this.interactHeld = false;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    // stop iOS gesture zoom / scroll
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (this.enabled) e.preventDefault(); }, { passive: false });
  }

  requestLock() {
    if (this.touch) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => { /* not allowed (e.g. iframe) — drag-to-look fallback */ });
    } catch { /* ignore */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.touchRoot.style.display = on && this.touch ? 'block' : 'none';
    if (!on) {
      this.fireHeld = false;
      this.interactHeld = false;
      this.keys.clear();
      this.lookIds.clear();
    }
  }

  consumeLook(): THREE.Vector2 {
    const v = this.look.clone();
    this.look.set(0, 0);
    return v;
  }

  takeActions(): Action[] {
    const a = this.actions;
    this.actions = [];
    return a;
  }
}
