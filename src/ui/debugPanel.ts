/**
 * PhysicsDebugTools
 * ---------------------------------------------------------------------------
 * A live tuning panel plus the debug visualisations:
 *   - the flow field (arrows showing where the water pushes),
 *   - buoyancy sample points on every log,
 *   - Rapier's own collider debug render.
 *
 * Every slider writes straight into the tuning table, so the prototype can
 * be balanced without touching source.
 */

import { PARAM_SPECS, getParam, setParam, exportTuning, importTuning, saveTuningToStorage } from '../core/config';

export interface DebugPanelOptions {
  onReset: () => void;
  onRespawn: () => void;
  onTeleportLogs: () => void;
}

export class DebugPanel {
  private root: HTMLElement;
  private rows: { path: string; input: HTMLInputElement; label: HTMLElement }[] = [];
  private toggles: Map<string, { el: HTMLElement; state: boolean; onChange: (v: boolean) => void }> = new Map();
  private open = false;

  constructor(container: HTMLElement, opts: DebugPanelOptions) {
    this.root = container;
    this.build(opts);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open = !this.open;
    this.root.classList.toggle('show', this.open);
  }

  private build(opts: DebugPanelOptions): void {
    this.root.innerHTML = '';

    const title = document.createElement('h2');
    title.textContent = 'Physics Debug';
    this.root.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML =
      'Live tuning. Values are saved to local storage.<br />' +
      'F1 flow field &middot; F2 buoyancy points &middot; F3 colliders';
    this.root.appendChild(hint);

    // --- groups -----------------------------------------------------------
    let currentGroup = '';
    for (const spec of PARAM_SPECS) {
      const group = spec.path.split('.')[0];
      if (group !== currentGroup) {
        currentGroup = group;
        const g = document.createElement('div');
        g.className = 'grp';
        g.textContent = group;
        this.root.appendChild(g);
      }

      const row = document.createElement('div');
      row.className = 'row';

      const lab = document.createElement('div');
      lab.className = 'lab';
      const name = document.createElement('span');
      name.textContent = spec.label;
      const val = document.createElement('b');
      val.textContent = fmt(getParam(spec.path));
      lab.appendChild(name);
      lab.appendChild(val);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(getParam(spec.path));

      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        setParam(spec.path, v);
        val.textContent = fmt(v);
      });

      row.appendChild(lab);
      row.appendChild(input);
      this.root.appendChild(row);
      this.rows.push({ path: spec.path, input, label: val });
    }

    // --- toggles ----------------------------------------------------------
    const tg = document.createElement('div');
    tg.className = 'grp';
    tg.textContent = 'visualisations';
    this.root.appendChild(tg);

    this.addToggle('Flow field', false, (v) => this.emit('flow', v));
    this.addToggle('Buoyancy points', false, (v) => this.emit('buoyancy', v));
    this.addToggle('Colliders', false, (v) => this.emit('colliders', v));
    this.addToggle('Free camera', false, (v) => this.emit('freecam', v));

    // --- actions ----------------------------------------------------------
    const ag = document.createElement('div');
    ag.className = 'grp';
    ag.textContent = 'actions';
    this.root.appendChild(ag);

    const btnRow = document.createElement('div');
    btnRow.className = 'btnrow';
    btnRow.appendChild(this.button('reset physics', opts.onReset));
    btnRow.appendChild(this.button('respawn', opts.onRespawn));
    btnRow.appendChild(this.button('teleport logs', opts.onTeleportLogs));
    btnRow.appendChild(this.button('export', () => {
      const blob = new Blob([exportTuning()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'driftwood-tuning.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }));
    btnRow.appendChild(this.button('import', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        if (importTuning(await f.text())) {
          this.refresh();
          saveTuningToStorage();
        }
      });
      input.click();
    }));
    btnRow.appendChild(this.button('defaults', () => {
      localStorage.removeItem('driftwood-racer.tuning');
      location.reload();
    }));
    this.root.appendChild(btnRow);
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private addToggle(label: string, initial: boolean, onChange: (v: boolean) => void): void {
    const row = document.createElement('div');
    row.className = 'row clickable';
    const el = document.createElement('span');
    el.className = 'tog' + (initial ? ' on' : '');
    const text = document.createElement('span');
    text.textContent = label;
    row.appendChild(el);
    row.appendChild(text);
    let state = initial;
    row.addEventListener('click', () => {
      state = !state;
      el.classList.toggle('on', state);
      onChange(state);
    });
    this.root.appendChild(row);
    this.toggles.set(label, { el, state, onChange });
  }

  /** Re-read every slider from the tuning table (after an import). */
  refresh(): void {
    for (const row of this.rows) {
      const v = getParam(row.path);
      row.input.value = String(v);
      row.label.textContent = fmt(v);
    }
  }

  private listeners: Record<string, (v: boolean) => void> = {};

  on(name: string, fn: (v: boolean) => void): void {
    this.listeners[name] = fn;
  }

  private emit(name: string, v: boolean): void {
    this.listeners[name]?.(v);
  }
}

function fmt(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
