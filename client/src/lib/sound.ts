import { Howl, Howler } from "howler";

export interface SoundPosition {
    map?: number;
    x: number;
    y: number;
}

interface PlaySoundOptions {
    soundId: number;
    listener?: SoundPosition;
    source?: SoundPosition;
    fadeInMs?: number;
    fadeOutMs?: number;
}

const SOUND_FILE_EXTENSIONS = ["ogg", "mp3", "wav"] as const;
const DEFAULT_BASE_VOLUME = 0.7;
const MAX_AUDIBLE_DISTANCE_TILES = 15;
const MIN_DISTANCE_VOLUME = 0.18;
const SOUND_POOL_SIZE = 12;
const HTML5_SOUND_POOL_SIZE = 4;
const MAX_CACHED_SOUNDS = 64;
const SOUND_EXTENSION_OVERRIDES = new Map<
    number,
    (typeof SOUND_FILE_EXTENSIONS)[number]
>([
    [23, "mp3"],
    [24, "mp3"],
]);

export class GameSoundManager {
    private readonly basePath: string;
    private readonly unavailableSoundIds = new Set<number>();
    private readonly soundCache = new Map<number, Howl>();
    private readonly preferWebAudio: boolean;
    private masterVolume = 1;
    private preferredExtension: (typeof SOUND_FILE_EXTENSIONS)[number] =
        SOUND_FILE_EXTENSIONS[0];

    constructor(basePath = "/sounds") {
        this.basePath = basePath.replace(/\/$/, "");
        this.preferredExtension = this.resolvePreferredExtension();
        this.preferWebAudio = this.shouldUseWebAudio();
    }

    play({
        soundId,
        listener,
        source,
        fadeInMs = 0,
        fadeOutMs = 0,
    }: PlaySoundOptions): void {
        if (typeof window === "undefined" || soundId <= 0) {
            return;
        }

        if (this.unavailableSoundIds.has(soundId)) {
            return;
        }

        const computedVolume = this.getVolume(listener, source);
        if (computedVolume <= 0) {
            return;
        }

        const sound = this.getOrCreateSound(soundId);
        if (!sound) {
            return;
        }

        const playbackId = sound.play();
        if (typeof playbackId === "number") {
            if (fadeInMs > 0) {
                sound.volume(0, playbackId);
                sound.fade(0, computedVolume, fadeInMs, playbackId);
            } else {
                sound.volume(computedVolume, playbackId);
            }

            if (fadeOutMs > 0) {
                const durationMs = sound.duration() * 1000;
                const fadeOutStartMs = durationMs - fadeOutMs;

                if (fadeOutStartMs > 0) {
                    window.setTimeout(() => {
                        if (!sound.playing(playbackId)) {
                            return;
                        }

                        sound.fade(
                            Math.max(0, computedVolume),
                            0,
                            fadeOutMs,
                            playbackId,
                        );
                    }, fadeOutStartMs);
                }
            }
        }
    }

    setMasterVolume(volume: number): void {
        this.masterVolume = Math.min(1, Math.max(0, volume));
        Howler.volume(this.masterVolume);
    }

    destroy(): void {
        for (const sound of this.soundCache.values()) {
            sound.unload();
        }

        this.soundCache.clear();
        Howler.volume(1);
    }

    private getOrCreateSound(soundId: number): Howl | null {
        const cachedSound = this.soundCache.get(soundId);
        if (cachedSound) {
            this.markSoundAsRecentlyUsed(soundId, cachedSound);
            return cachedSound;
        }

        if (this.unavailableSoundIds.has(soundId)) {
            return null;
        }

        if (!this.ensureSoundCacheCapacity()) {
            return null;
        }

        const sound = new Howl({
            src: this.getSoundUrls(soundId),
            format: [...SOUND_FILE_EXTENSIONS],
            preload: true,
            html5: !this.preferWebAudio,
            pool: this.preferWebAudio ? SOUND_POOL_SIZE : HTML5_SOUND_POOL_SIZE,
            onloaderror: () => {
                this.unavailableSoundIds.add(soundId);
                this.soundCache.delete(soundId);
                sound.unload();
            },
            onplayerror: () => {
                this.unavailableSoundIds.add(soundId);
                this.soundCache.delete(soundId);
                sound.unload();
            },
        });

        this.markSoundAsRecentlyUsed(soundId, sound);
        return sound;
    }

    private getSoundUrls(soundId: number): string[] {
        const preferredExtension =
            SOUND_EXTENSION_OVERRIDES.get(soundId) ?? this.preferredExtension;
        const extensions = [
            preferredExtension,
            ...SOUND_FILE_EXTENSIONS.filter(
                (extension) => extension !== preferredExtension,
            ),
        ];

        return extensions.map((extension) => `${this.basePath}/${soundId}.${extension}`);
    }

    private shouldUseWebAudio(): boolean {
        if (typeof window === "undefined") {
            return false;
        }

        const webAudioContext =
            window.AudioContext ??
            (
                window as typeof window & {
                    webkitAudioContext?: typeof AudioContext;
                }
            ).webkitAudioContext;

        return typeof webAudioContext === "function";
    }

    private markSoundAsRecentlyUsed(soundId: number, sound: Howl): void {
        this.soundCache.delete(soundId);
        this.soundCache.set(soundId, sound);
    }

    private ensureSoundCacheCapacity(): boolean {
        if (this.soundCache.size < MAX_CACHED_SOUNDS) {
            return true;
        }

        for (const [cachedSoundId, cachedSound] of this.soundCache) {
            if (cachedSound.playing()) {
                continue;
            }

            this.soundCache.delete(cachedSoundId);
            cachedSound.unload();
            return true;
        }

        return false;
    }

    private resolvePreferredExtension(): (typeof SOUND_FILE_EXTENSIONS)[number] {
        if (typeof document === "undefined") {
            return SOUND_FILE_EXTENSIONS[0];
        }

        const probe = document.createElement("audio");

        if (probe.canPlayType("audio/ogg") !== "") {
            return "ogg";
        }

        if (probe.canPlayType("audio/mpeg") !== "") {
            return "mp3";
        }

        return "wav";
    }

    private getVolume(
        listener?: SoundPosition,
        source?: SoundPosition,
    ): number {
        if (!listener || !source) {
            return DEFAULT_BASE_VOLUME;
        }

        if (
            listener.map != null &&
            source.map != null &&
            listener.map !== source.map
        ) {
            return 0;
        }

        const deltaX = listener.x - source.x;
        const deltaY = listener.y - source.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distance >= MAX_AUDIBLE_DISTANCE_TILES) {
            return 0;
        }

        const attenuation = 1 - distance / MAX_AUDIBLE_DISTANCE_TILES;
        const normalizedVolume = Math.max(MIN_DISTANCE_VOLUME, attenuation);

        return Math.min(1, normalizedVolume * DEFAULT_BASE_VOLUME);
    }
}
