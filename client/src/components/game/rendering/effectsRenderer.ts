import { Container, Graphics, GraphicsContext } from "pixi.js";
import type { SpellData } from "../../../types/game";
import { isSelfFirstSupportSpell } from "../input/combatTargeting";
import { destroyDisplayObjectSafely } from "./pixiUtils";

const SPELL_PROJECTILE_CORE_RADIUS = 5;
const SPELL_PROJECTILE_RING_RADIUS = 9;
const SPELL_PROJECTILE_TRAIL_RADIUS = 3;
const SPELL_PROJECTILE_PARTICLE_INTERVAL_MS = 12;
const SPELL_PROJECTILE_PARTICLE_LIFETIME_MS = 240;
const SPELL_PROJECTILE_PARTICLE_JITTER = 9;
const SPELL_PROJECTILE_ALPHA_CORE = 0.95;
const SPELL_PROJECTILE_ALPHA_RING = 0.7;
const SPELL_PROJECTILE_ALPHA_TRAIL = 0.65;
const SPELL_PROJECTILE_ALPHA_TRAIL_SECONDARY = 0.35;
const SPELL_PROJECTILE_ALPHA_CONTAINER = 0.95;
const SPELL_PROJECTILE_ALPHA_RING_END_MULTIPLIER = 0.65;
const SPELL_PROJECTILE_ALPHA_TRAIL_END_MULTIPLIER = 0.4;
const SPELL_PROJECTILE_ALPHA_CONTAINER_END_MULTIPLIER = 0.8;
const SPELL_PROJECTILE_ALPHA_PARTICLE_MIN = 0.5;
const SPELL_PROJECTILE_ALPHA_PARTICLE_MAX = 0.9;
const SPELL_PROJECTILE_PARTICLE_POOL_MAX_SIZE = 256;

type SpellProjectileParticleShape = "orb" | "spark";

type SpellProjectileVisualConfig = {
    coreColor: number;
    ringColor: number;
    trailColor: number;
    magnitude: number;
};

type SpellProjectileParticle = {
    sprite: Graphics;
    createdAt: number;
    velocityX: number;
    velocityY: number;
    initialAlpha: number;
    scaleGrowth: number;
    rotationSpeed: number;
    baseScaleX: number;
    baseScaleY: number;
};

const spellProjectileParticlePool: Graphics[] = [];
const spellProjectileParticleContextCache = new Map<string, GraphicsContext>();

function getSpellProjectileParticleContext(
    shape: SpellProjectileParticleShape,
    color: number,
): GraphicsContext {
    const cacheKey = `${shape}:${color}`;
    const cachedContext = spellProjectileParticleContextCache.get(cacheKey);

    if (cachedContext) {
        return cachedContext;
    }

    const context = new GraphicsContext();

    if (shape === "spark") {
        context
            .moveTo(-0.5, 0)
            .lineTo(0, -1)
            .lineTo(0.5, 0)
            .lineTo(0, 1)
            .closePath()
            .fill({ color, alpha: 1 });
    } else {
        context.circle(0, 0, 1).fill({ color, alpha: 1 });
    }

    spellProjectileParticleContextCache.set(cacheKey, context);

    return context;
}

function acquireSpellProjectileParticle(
    shape: SpellProjectileParticleShape,
    color: number,
): Graphics {
    const pooledParticle = spellProjectileParticlePool.pop();
    const particle =
        pooledParticle && !pooledParticle.destroyed
            ? pooledParticle
            : new Graphics();

    particle.context = getSpellProjectileParticleContext(shape, color);
    particle.visible = true;
    particle.alpha = 1;
    particle.rotation = 0;
    particle.scale?.set(1);

    return particle;
}

function releaseSpellProjectileParticle(particle: Graphics): void {
    if (particle.destroyed) {
        return;
    }

    if (particle.parent) {
        particle.parent.removeChild(particle);
    }

    particle.visible = false;
    particle.alpha = 1;
    particle.rotation = 0;
    particle.position?.set(0, 0);
    particle.scale?.set(1);
    particle.zIndex = 0;

    if (
        spellProjectileParticlePool.length >=
        SPELL_PROJECTILE_PARTICLE_POOL_MAX_SIZE
    ) {
        destroyDisplayObjectSafely(particle, { context: false });
        return;
    }

    spellProjectileParticlePool.push(particle);
}

function parseProjectileHexColor(
    value: string | null | undefined,
    fallback: number,
): number {
    const normalized = String(value ?? "")
        .trim()
        .replace(/^#/, "");

    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return fallback;
    }

    return Number.parseInt(normalized, 16);
}

function clampSpellProjectileMagnitude(
    value: number | null | undefined,
): number {
    if (!Number.isFinite(value)) {
        return 1;
    }

    return Math.max(0.65, Math.min(2.5, Number(value)));
}

function getSpellProjectileVisualConfig(
    spellData: SpellData | null | undefined,
): SpellProjectileVisualConfig {
    if (isSelfFirstSupportSpell(spellData)) {
        return {
            coreColor: parseProjectileHexColor(
                spellData?.projectileVisual?.coreColor,
                0x7ef9c6,
            ),
            ringColor: parseProjectileHexColor(
                spellData?.projectileVisual?.ringColor,
                0xb8ffe8,
            ),
            trailColor: parseProjectileHexColor(
                spellData?.projectileVisual?.trailColor,
                0x4ade80,
            ),
            magnitude: clampSpellProjectileMagnitude(
                spellData?.projectileVisual?.magnitude,
            ),
        };
    }

    return {
        coreColor: parseProjectileHexColor(
            spellData?.projectileVisual?.coreColor,
            0xf9a8ff,
        ),
        ringColor: parseProjectileHexColor(
            spellData?.projectileVisual?.ringColor,
            0xc084fc,
        ),
        trailColor: parseProjectileHexColor(
            spellData?.projectileVisual?.trailColor,
            0x60a5fa,
        ),
        magnitude: clampSpellProjectileMagnitude(
            spellData?.projectileVisual?.magnitude,
        ),
    };
}

export function createSpellProjectileVisual(
    getOverlayContainerForWorldY: (worldY: number) => Container,
    rotation: number,
    spellData: SpellData | null | undefined,
): {
    container: Container;
    updateVisual: (progress: number, worldX: number, worldY: number) => void;
    cleanupVisual: () => void;
} {
    const visualConfig = getSpellProjectileVisualConfig(spellData);
    const container = new Container();
    const coreRadius = SPELL_PROJECTILE_CORE_RADIUS * visualConfig.magnitude;
    const ringRadius = SPELL_PROJECTILE_RING_RADIUS * visualConfig.magnitude;

    const trailRadius = Math.max(
        2,
        SPELL_PROJECTILE_TRAIL_RADIUS * (0.8 + visualConfig.magnitude * 0.45),
    );
    const core = new Graphics();
    core.circle(0, 0, coreRadius).fill({
        color: visualConfig.coreColor,
        alpha: SPELL_PROJECTILE_ALPHA_CORE,
    });

    const ring = new Graphics();
    ring.circle(0, 0, ringRadius).stroke({
        color: visualConfig.ringColor,
        alpha: SPELL_PROJECTILE_ALPHA_RING,
        width: Math.max(2, visualConfig.magnitude * 1.8),
    });

    const trail = new Graphics();
    trail.circle(-10 * visualConfig.magnitude, 0, trailRadius).fill({
        color: visualConfig.trailColor,
        alpha: SPELL_PROJECTILE_ALPHA_TRAIL,
    });
    trail
        .circle(
            -18 * visualConfig.magnitude,
            0,
            Math.max(1.6, visualConfig.magnitude * 2.2),
        )
        .fill({
            color: visualConfig.trailColor,
            alpha: SPELL_PROJECTILE_ALPHA_TRAIL_SECONDARY,
        });

    container.addChild(trail, ring, core);
    container.rotation = rotation;
    container.alpha = SPELL_PROJECTILE_ALPHA_CONTAINER;

    const travelDirectionX = Math.cos(rotation);
    const travelDirectionY = Math.sin(rotation);
    const particles: SpellProjectileParticle[] = [];
    let lastParticleEmissionAt = -Infinity;
    const particleIntervalMs = Math.max(
        6,
        SPELL_PROJECTILE_PARTICLE_INTERVAL_MS /
            (0.8 + visualConfig.magnitude * 0.55),
    );
    const particleLifetimeMs =
        SPELL_PROJECTILE_PARTICLE_LIFETIME_MS *
        (0.9 + visualConfig.magnitude * 0.35);
    const particleJitter =
        SPELL_PROJECTILE_PARTICLE_JITTER *
        (0.8 + visualConfig.magnitude * 0.35);
    const secondaryParticleChance = Math.min(
        0.85,
        0.2 + visualConfig.magnitude * 0.22,
    );

    return {
        container,
        updateVisual: (progress: number, worldX: number, worldY: number) => {
            const now = performance.now();

            if (now - lastParticleEmissionAt >= particleIntervalMs) {
                lastParticleEmissionAt = now;

                const particleCount =
                    Math.random() < secondaryParticleChance ? 2 : 1;
                for (
                    let particleIndex = 0;
                    particleIndex < particleCount;
                    particleIndex += 1
                ) {
                    const radius =
                        (1.5 + Math.random() * 1.8) *
                        (0.75 + visualConfig.magnitude * 0.35);
                    const initialAlpha =
                        SPELL_PROJECTILE_ALPHA_PARTICLE_MIN +
                        Math.random() *
                            Math.max(
                                0,
                                SPELL_PROJECTILE_ALPHA_PARTICLE_MAX -
                                    SPELL_PROJECTILE_ALPHA_PARTICLE_MIN,
                            );
                    const particleColor =
                        particleIndex === 0
                            ? visualConfig.trailColor
                            : visualConfig.ringColor;
                    const useSparkShape = Math.random() < 0.65;
                    const particle = acquireSpellProjectileParticle(
                        useSparkShape ? "spark" : "orb",
                        particleColor,
                    );
                    let baseScaleX = radius;
                    let baseScaleY = radius;

                    if (useSparkShape) {
                        const sparkLength =
                            (6 + Math.random() * 6) *
                            (0.8 + visualConfig.magnitude * 0.5);
                        const sparkWidth =
                            (1 + Math.random() * 1.4) *
                            (0.8 + visualConfig.magnitude * 0.2);
                        baseScaleX = sparkLength;
                        baseScaleY = sparkWidth;
                        particle.rotation =
                            rotation + (Math.random() - 0.5) * 1.2;
                    }

                    particle.x = Math.round(
                        worldX -
                            travelDirectionX * (8 + particleIndex * 4) +
                            (Math.random() - 0.5) * particleJitter,
                    );
                    particle.y = Math.round(
                        worldY -
                            travelDirectionY * (8 + particleIndex * 4) +
                            (Math.random() - 0.5) * particleJitter,
                    );
                    getOverlayContainerForWorldY(particle.y).addChild(particle);

                    particles.push({
                        sprite: particle,
                        createdAt: now,
                        velocityX:
                            -travelDirectionX *
                                (0.35 + Math.random() * 0.35) *
                                visualConfig.magnitude +
                            (Math.random() - 0.5) *
                                (0.55 + visualConfig.magnitude * 0.4),
                        velocityY:
                            -travelDirectionY *
                                (0.35 + Math.random() * 0.35) *
                                visualConfig.magnitude +
                            (Math.random() - 0.5) *
                                (0.55 + visualConfig.magnitude * 0.4),
                        initialAlpha,
                        scaleGrowth:
                            (0.9 + Math.random() * 1.2) *
                            (0.9 + visualConfig.magnitude * 0.25),
                        rotationSpeed: (Math.random() - 0.5) * 0.08,
                        baseScaleX,
                        baseScaleY,
                    });
                }
            }

            for (let index = particles.length - 1; index >= 0; index -= 1) {
                const particle = particles[index];
                const ageMs = now - particle.createdAt;
                const particleProgress = Math.max(
                    0,
                    Math.min(1, ageMs / particleLifetimeMs),
                );

                if (particleProgress >= 1) {
                    releaseSpellProjectileParticle(particle.sprite);
                    particles.splice(index, 1);
                    continue;
                }

                particle.sprite.x += particle.velocityX;
                particle.sprite.y += particle.velocityY;
                particle.sprite.rotation += particle.rotationSpeed;
                particle.sprite.alpha =
                    particle.initialAlpha * (1 - particleProgress);
                particle.sprite.scale.set(
                    particle.baseScaleX *
                        (0.75 + particleProgress * particle.scaleGrowth),
                    particle.baseScaleY *
                        (0.75 + particleProgress * particle.scaleGrowth),
                );
            }

            const pulse = 0.92 + Math.sin(progress * Math.PI * 6) * 0.08;
            core.scale.set(pulse);
            ring.scale.set(0.9 + progress * 0.45);
            ring.alpha =
                SPELL_PROJECTILE_ALPHA_RING *
                (1 -
                    progress *
                        (1 - SPELL_PROJECTILE_ALPHA_RING_END_MULTIPLIER));
            trail.alpha =
                SPELL_PROJECTILE_ALPHA_TRAIL *
                (1 -
                    progress *
                        (1 - SPELL_PROJECTILE_ALPHA_TRAIL_END_MULTIPLIER));
            container.alpha =
                SPELL_PROJECTILE_ALPHA_CONTAINER *
                (1 -
                    progress *
                        (1 - SPELL_PROJECTILE_ALPHA_CONTAINER_END_MULTIPLIER));
        },
        cleanupVisual: () => {
            for (const particle of particles) {
                releaseSpellProjectileParticle(particle.sprite);
            }
            particles.length = 0;
        },
    };
}
