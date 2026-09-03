import type { Texture } from "pixi.js";

export type SharedTextureCaches = {
    baseTextureCache: Map<string, Texture>;
    pendingAssetLoads: Map<string, Promise<Texture>>;
    textureCache: Map<string, Texture>;
    animatedTextureCache: Map<string, Texture[]>;
};

export function destroySharedTextureCaches(caches: SharedTextureCaches): void {
    for (const texture of caches.textureCache.values()) {
        if (!texture.destroyed) {
            texture.destroy(false);
        }
    }

    for (const textures of caches.animatedTextureCache.values()) {
        for (const texture of textures) {
            if (!texture.destroyed) {
                texture.destroy(false);
            }
        }
    }

    caches.textureCache.clear();
    caches.animatedTextureCache.clear();
    caches.baseTextureCache.clear();
    caches.pendingAssetLoads.clear();
}
