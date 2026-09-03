import type { RuntimeCharacter } from "./types/runtime";

type ChatAuditChannel = "local" | "global" | "private" | "party" | "clan";

type ChatAuditLogInput = {
    channel: ChatAuditChannel;
    sender: RuntimeCharacter;
    message: string;
    recipient?: RuntimeCharacter | null;
    groupId?: string | null;
    recipientsCount?: number;
};

function logChat(_input: ChatAuditLogInput): void {
    void _input;
}

module.exports = {
    logChat,
};
