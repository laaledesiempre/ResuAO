// Unit tests for the register form rules (src/lib/registration.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationFormRules } from "../src/lib/registration";
import { DEFAULT_SITE_CONFIG } from "../src/lib/siteConfig";

test("registrationFormRules mirrors the site config registration block", () => {
    assert.deepEqual(
        registrationFormRules(DEFAULT_SITE_CONFIG.registration),
        { registrationOpen: true, emailRequired: true },
    );
    assert.deepEqual(
        registrationFormRules({ enabled: false, requireEmail: true }),
        { registrationOpen: false, emailRequired: true },
    );
    assert.deepEqual(
        registrationFormRules({ enabled: true, requireEmail: false }),
        { registrationOpen: true, emailRequired: false },
    );
});
