/**
 * Keyboard + mouse input with pointer-lock mouse look.
 *
 * The class exposes a stable "snapshot" API: continuous axes for movement,
 * edge-triggered `pressed()` for one-shot actions.
 */

export class Input {
  readonly keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  private mouseButtons = new Set<number>();
  private mousePressedThisFrame = new Set<number>();
  private mouseReleasedThisFrame = new Set<number>();

  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  enabled = true;

  /** Called by the game when pointer lock is engaged / released. */
  onLockChange?: (locked: boolean) => void;

  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = e.code;
      if (BLOCKED.has(code)) e.preventDefault();
      this.keys.add(code);
      this.pressedThisFrame.add(code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedThisFrame.add(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });

    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseButtons.add(e.button);
      this.mousePressedThisFrame.add(e.button);
    });

    window.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
      this.mouseReleasedThisFrame.add(e.button);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.mouseButtons.clear();
        this.keys.clear();
      }
      this.onLockChange?.(this.locked);
    });

    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock(): void {
    if (!this.locked) this.el.requestPointerLock?.();
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock?.();
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  released(code: string): boolean {
    return this.releasedThisFrame.has(code);
  }

  mouseDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  mousePressed(button: number): boolean {
    return this.mousePressedThisFrame.has(button);
  }

  mouseReleased(button: number): boolean {
    return this.mouseReleasedThisFrame.has(button);
  }

  /** Movement axes in local space: x = strafe (right +), y = forward (+). */
  get moveX(): number {
    if (!this.enabled) return 0;
    return (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0);
  }

  get moveY(): number {
    if (!this.enabled) return 0;
    return (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0);
  }

  get sprint(): boolean {
    return this.enabled && this.down('ShiftLeft');
  }

  /** Call at the end of every rendered frame to clear edge-triggered state. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mousePressedThisFrame.clear();
    this.mouseReleasedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}

const BLOCKED = new Set([
  'Space',
  'Tab',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
