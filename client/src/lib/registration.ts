// Pure rules for the register form, derived from the site config.
// The server enforces the same rules on POST /api/auth/register.
import type { SiteRegistration } from "./siteConfig";

export interface RegistrationFormRules {
    registrationOpen: boolean;
    emailRequired: boolean;
}

export function registrationFormRules(
    registration: SiteRegistration,
): RegistrationFormRules {
    return {
        registrationOpen: registration.enabled,
        emailRequired: registration.requireEmail,
    };
}
