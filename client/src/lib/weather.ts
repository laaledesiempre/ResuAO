// Lluvia por mapa, port del AO clasico VB6 (ao-libre):
// - bLluvia(UserMap): INIT/FK.ind del cliente VB6, un byte por mapa
//   (modCarga.bas CargarArrayLluvia). Portado a public/init/lluvia.json.
// - bRain global alternado por el paquete RainToggle sin payload
//   (CP.bas HandleRainToggle; servidor Protocol.bas /LLUVIA).
// - Render: particulas de lluvia solo si bRain y bLluvia(UserMap)
//   (TileEngine.bas RenderScreen / mDx8_Particulas Engine_Weather_Update).
// - Sonido en loop (TileEngine.bas RenderSounds) y sonido de cierre al
//   parar la lluvia (CP.bas HandleRainToggle).
// Desviacion: el VB6 elige lluviain.wav bajo techo segun el trigger del
// tile (BAJOTECHO/CASA/ZONASEGURA); el cliente Resu no recibe triggers por
// tile, asi que suena siempre la variante exterior (lluviaout).

import { Howl } from "howler";

const RAIN_FLAGS_URL = "/init/lluvia.json";
const RAIN_LOOP_URL = "/sounds/weather/lluviaout.ogg";
const RAIN_END_URL = "/sounds/weather/lluviaoutend.ogg";
const RAIN_DROP_COUNT = 140;
const RAIN_DROP_MIN_SPEED = 700;
const RAIN_DROP_MAX_SPEED = 1100;
const RAIN_DROP_ANGLE = -0.18;

type RainDrop = {
    x: number;
    y: number;
    speed: number;
    length: number;
};

export class WeatherManager {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D | null;
    private rainFlags: number[] = [];
    private raining = false;
    private currentMap = 0;
    private effectActive = false;
    private animationFrame = 0;
    private lastFrameAt = 0;
    private drops: RainDrop[] = [];
    private rainLoop: Howl | null = null;
    private volume = 1;
    private destroyed = false;

    constructor(container: HTMLElement) {
        this.canvas = document.createElement("canvas");
        this.canvas.className = "weather-canvas";
        this.context = this.canvas.getContext("2d");
        container.append(this.canvas);

        void fetch(RAIN_FLAGS_URL)
            .then((response) => (response.ok ? response.json() : []))
            .then((flags: unknown) => {
                if (this.destroyed) return;
                this.rainFlags = Array.isArray(flags)
                    ? flags.map((value) => Number(value) || 0)
                    : [];
                this.refreshEffect();
            })
            .catch(() => {
                this.rainFlags = [];
            });
    }

    setMap(map: number): void {
        this.currentMap = map;
        this.refreshEffect();
    }

    // VB6 CP.bas HandleRainToggle: si estaba lloviendo en este mapa, frena
    // el loop y suena el cierre; luego bRain = Not bRain.
    toggleRain(): void {
        if (this.raining && this.mapHasRain(this.currentMap)) {
            this.stopRainLoop();
            this.playOneShot(RAIN_END_URL);
        }
        this.raining = !this.raining;
        this.refreshEffect();
    }

    setVolume(volume: number): void {
        this.volume = Math.min(1, Math.max(0, volume));
        this.rainLoop?.volume(this.volume * 0.7);
    }

    destroy(): void {
        this.destroyed = true;
        cancelAnimationFrame(this.animationFrame);
        this.stopRainLoop();
        this.rainLoop?.unload();
        this.rainLoop = null;
        this.canvas.remove();
    }

    private mapHasRain(map: number): boolean {
        return map >= 1 && map <= this.rainFlags.length && this.rainFlags[map - 1] === 1;
    }

    private refreshEffect(): void {
        const active = !this.destroyed && this.raining && this.mapHasRain(this.currentMap);
        if (active === this.effectActive) {
            return;
        }
        this.effectActive = active;
        if (active) {
            this.startRainLoop();
            this.startAnimation();
        } else {
            this.stopRainLoop();
            this.stopAnimation();
        }
    }

    private startRainLoop(): void {
        if (!this.rainLoop) {
            this.rainLoop = new Howl({
                src: [RAIN_LOOP_URL],
                loop: true,
                volume: this.volume * 0.7,
            });
        }
        if (!this.rainLoop.playing()) {
            this.rainLoop.play();
        }
    }

    private stopRainLoop(): void {
        this.rainLoop?.stop();
    }

    private playOneShot(url: string): void {
        const sound = new Howl({ src: [url], volume: this.volume * 0.7 });
        sound.once("end", () => sound.unload());
        sound.play();
    }

    private startAnimation(): void {
        if (!this.context) {
            return;
        }
        this.lastFrameAt = performance.now();
        const tick = (now: number) => {
            if (!this.effectActive || this.destroyed) {
                return;
            }
            const elapsed = Math.min(0.05, (now - this.lastFrameAt) / 1000);
            this.lastFrameAt = now;
            this.drawFrame(elapsed);
            this.animationFrame = requestAnimationFrame(tick);
        };
        this.animationFrame = requestAnimationFrame(tick);
    }

    private stopAnimation(): void {
        cancelAnimationFrame(this.animationFrame);
        if (this.context) {
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        this.drops = [];
    }

    private drawFrame(elapsed: number): void {
        const ctx = this.context;
        if (!ctx) {
            return;
        }

        const width = this.canvas.clientWidth || 1;
        const height = this.canvas.clientHeight || 1;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        while (this.drops.length < RAIN_DROP_COUNT) {
            this.drops.push(this.spawnDrop(Math.random() * height));
        }

        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = "rgba(174, 194, 224, 0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (const drop of this.drops) {
            drop.y += drop.speed * elapsed;
            drop.x += drop.speed * RAIN_DROP_ANGLE * elapsed;
            if (drop.y > height + drop.length) {
                Object.assign(drop, this.spawnDrop(-drop.length));
            }
            ctx.moveTo(drop.x, drop.y);
            ctx.lineTo(
                drop.x + drop.length * RAIN_DROP_ANGLE,
                drop.y - drop.length,
            );
        }

        ctx.stroke();
    }

    private spawnDrop(y: number): RainDrop {
        const width = this.canvas.clientWidth || 1;
        return {
            x: Math.random() * (width + 40) - 20,
            y,
            speed:
                RAIN_DROP_MIN_SPEED +
                Math.random() * (RAIN_DROP_MAX_SPEED - RAIN_DROP_MIN_SPEED),
            length: 9 + Math.random() * 7,
        };
    }
}
