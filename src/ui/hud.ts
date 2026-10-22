/**
 * Heads up display: live state readout, transient toasts and the end-of-run
 * banner. Plain DOM so it stays crisp and costs nothing on the GPU.
 */

export interface HudData {
  state: string;
  speed: number;
  logDrift: string;
  altitude: number;
  distance: number;
  fps: number;
}

export class Hud {
  private readonly elState = document.getElementById('s-state')!;
  private readonly elSpeed = document.getElementById('s-speed')!;
  private readonly elDrift = document.getElementById('s-drift')!;
  private readonly elAlt = document.getElementById('s-alt')!;
  private readonly elDist = document.getElementById('s-dist')!;
  private readonly elFps = document.getElementById('s-fps')!;
  private readonly elToast = document.getElementById('toast')!;
  private readonly elTitle = document.getElementById('title')!;
  private readonly elFinish = document.getElementById('finish')!;
  private readonly elPrompt = document.getElementById('click-to-play')!;

  private toastTimer = 0;
  private lastState = '';

  setPromptVisible(v: boolean): void {
    this.elPrompt.classList.toggle('hidden', !v);
  }

  showTitle(v: boolean): void {
    this.elTitle.classList.toggle('show', v);
  }

  showFinish(v: boolean): void {
    this.elFinish.classList.toggle('show', v);
  }

  toast(message: string, seconds = 2.6): void {
    this.elToast.textContent = message;
    this.elToast.classList.add('show');
    this.toastTimer = seconds;
  }

  update(dt: number, data: HudData): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.elToast.classList.remove('show');
    }

    if (data.state !== this.lastState) {
      this.lastState = data.state;
      this.elState.textContent = data.state;
    }
    this.elSpeed.textContent = `${data.speed.toFixed(1)} m/s`;
    this.elDrift.textContent = data.logDrift;
    this.elAlt.textContent = `${data.altitude.toFixed(1)} m`;
    this.elDist.textContent = `${data.distance.toFixed(0)} m`;
    this.elFps.textContent = `${Math.round(data.fps)}`;
  }
}
