import pool from "../db";

const BRANDING_CONFIG_KEY = "branding";

export type SiteConfig = Record<string, unknown>;

type SiteConfigRecord = {
    key: string;
    value: SiteConfig | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getSiteConfig(): Promise<SiteConfig | null> {
    const result = await pool.query<SiteConfigRecord>(
        `
      SELECT key, value
      FROM site_config
      WHERE key = $1
      LIMIT 1
    `,
        [BRANDING_CONFIG_KEY],
    );

    const value = result.rows[0]?.value;

    return isPlainObject(value) ? value : null;
}

export type RegistrationSettings = {
    enabled: boolean;
    requireEmail: boolean;
};

/**
 * Instance-level registration settings stored inside the site_config JSON
 * under the "registration" key. Defaults keep registration open with a
 * required email.
 */
export async function getRegistrationSettings(): Promise<RegistrationSettings> {
    const config = await getSiteConfig();
    const registration = isPlainObject(config?.registration)
        ? config.registration
        : {};

    return {
        enabled:
            typeof registration.enabled === "boolean"
                ? registration.enabled
                : true,
        requireEmail:
            typeof registration.requireEmail === "boolean"
                ? registration.requireEmail
                : true,
    };
}

export async function setSiteConfig(config: unknown): Promise<SiteConfig> {
    if (!isPlainObject(config)) {
        throw new Error("La configuracion debe ser un objeto");
    }

    await pool.query(
        `
      INSERT INTO site_config (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value,
                    updated_at = NOW()
    `,
        [BRANDING_CONFIG_KEY, JSON.stringify(config)],
    );

    return config;
}
