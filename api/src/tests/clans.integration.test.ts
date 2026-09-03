import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    type ClanOverviewPayload,
    acceptClanRequest,
    createAccountFixture,
    createCharacterFixture,
    createClan,
    createClanFixture,
    createClanRequest,
    deleteClan,
    ensureApiReady,
    expectSuccessPayload,
    getAuthClanDetails,
    getAuthClans,
    getCharacterState,
    kickClanMember,
    leaveClan,
    patchCharacter,
    rejectClanRequest,
    setClanMemberRole,
    transferClanLeadership,
    uniqueLetters,
} from "./helpers/api";

beforeAll(async () => {
    await ensureApiReady();
});

test("auth/clans requires a selected character", async () => {
    const account = await createAccountFixture();
    const response = await getAuthClans(account.session.sessionToken);
    assert.equal(response.status, 409);
    assert.equal(
        (response.data as { error?: string }).error,
        "No hay un personaje seleccionado en la sesion.",
    );
});

test("create clan enforces minimum level and gold", async () => {
    const lowLevel = await createCharacterFixture({
        namePrefix: "LowL",
        level: 29,
        gold: 2_000_000,
    });
    const lowGold = await createCharacterFixture({
        namePrefix: "LowG",
        level: 30,
        gold: 100,
    });

    const lowLevelResponse = await createClan({
        characterId: lowLevel.id,
        name: `Clan ${uniqueLetters(4)}`,
        minJoinLevel: 1,
    });
    const lowGoldResponse = await createClan({
        characterId: lowGold.id,
        name: `Gold ${uniqueLetters(4)}`,
        minJoinLevel: 1,
    });

    assert.equal(lowLevelResponse.status, 400);
    assert.match(
        String(lowLevelResponse.data.error ?? ""),
        /Necesitas nivel 30/i,
    );
    assert.equal(lowGoldResponse.status, 400);
    assert.equal(
        lowGoldResponse.data.error,
        "No tienes el oro suficiente para crear un clan",
    );
});

test("create clan request rejects duplicates and accept updates membership", async () => {
    const leader = await createCharacterFixture({
        namePrefix: "Lead",
        level: 30,
        gold: 1_600_000,
    });
    const applicant = await createCharacterFixture({
        namePrefix: "Appl",
        level: 30,
        gold: 500,
    });

    const clanResponse = await createClan({
        characterId: leader.id,
        name: `Test ${uniqueLetters(4)}`,
        minJoinLevel: 1,
    });
    assert.equal(clanResponse.status, 201);
    const clanId = clanResponse.data.clanId as string;

    const firstRequest = await createClanRequest({
        characterId: applicant.id,
        clanId,
        message: "quiero entrar",
    });
    const duplicateRequest = await createClanRequest({
        characterId: applicant.id,
        clanId,
        message: "otra vez",
    });

    assert.equal(firstRequest.status, 201);
    assert.equal(duplicateRequest.status, 400);
    assert.equal(
        duplicateRequest.data.error,
        "Ya enviaste una solicitud a este clan",
    );

    const overview = await getAuthClans(leader.sessionToken);
    assert.equal(overview.status, 200);
    const requestId = expectSuccessPayload<ClanOverviewPayload>(overview.data)
        .currentClan?.requests?.[0]?.id;
    assert.ok(requestId);

    const accepted = await acceptClanRequest(requestId as string, {
        reviewerCharacterId: leader.id,
    });
    assert.equal(accepted.status, 200);

    const applicantState = await getCharacterState(
        applicant.accountId,
        applicant.id,
        applicant.email,
    );
    assert.equal(applicantState.clanId, clanId);
});

test("reject clan request removes the pending application", async () => {
    const leader = await createCharacterFixture({
        namePrefix: "RejL",
        level: 30,
        gold: 1_600_000,
    });
    const applicant = await createCharacterFixture({
        namePrefix: "RejA",
        level: 30,
        gold: 500,
    });

    const clanResponse = await createClan({
        characterId: leader.id,
        name: `Rej ${uniqueLetters(4)}`,
        minJoinLevel: 1,
    });
    const clanId = clanResponse.data.clanId as string;
    await createClanRequest({
        characterId: applicant.id,
        clanId,
        message: "hola",
    });

    const overview = await getAuthClans(leader.sessionToken);
    const requestId = expectSuccessPayload<ClanOverviewPayload>(overview.data)
        .currentClan?.requests?.[0]?.id as string;
    const rejected = await rejectClanRequest(requestId, {
        reviewerCharacterId: leader.id,
    });
    assert.equal(rejected.status, 200);

    const applicantOverview = await getAuthClans(applicant.sessionToken);
    assert.equal(applicantOverview.status, 200);
    assert.equal(
        expectSuccessPayload<ClanOverviewPayload>(applicantOverview.data)
            .pendingRequestClanId,
        null,
    );
});

test("leader cannot leave clan and can kick members by name", async () => {
    const { leader, member } = await createClanFixture();

    const leaderLeave = await leaveClan({ characterId: leader.id });
    assert.equal(leaderLeave.status, 400);
    assert.equal(leaderLeave.data.error, "El lider no puede abandonar el clan");

    const kicked = await kickClanMember({
        leaderCharacterId: leader.id,
        targetName: member.name,
    });
    assert.equal(kicked.status, 200);

    const memberState = await getCharacterState(
        member.accountId,
        member.id,
        member.email,
    );
    assert.equal(memberState.clanId, null);
});

test("member can leave clan and leader sees request details in auth endpoints", async () => {
    const { clanId, leader, member } = await createClanFixture();

    const details = await getAuthClanDetails(leader.sessionToken, clanId);
    assert.equal(details.status, 200);
    assert.equal(details.data.id, clanId);
    assert.equal(Array.isArray(details.data.members), true);

    const leave = await leaveClan({ characterId: member.id });
    assert.equal(leave.status, 200);

    const memberState = await getCharacterState(
        member.accountId,
        member.id,
        member.email,
    );
    assert.equal(memberState.clanId, null);
});

test("leader can assign co-leaders and co-leaders can accept requests", async () => {
    const { clanId, leader, member, outsider } = await createClanFixture();
    const applicant = await createCharacterFixture({
        namePrefix: "ApcL",
        level: 30,
        gold: 500,
    });

    const promoted = await setClanMemberRole({
        leaderCharacterId: leader.id,
        targetCharacterId: member.id,
        role: "co_leader",
    });
    assert.equal(promoted.status, 200);

    const memberOverview = await getAuthClans(member.sessionToken);
    assert.equal(memberOverview.status, 200);
    const promotedClan = expectSuccessPayload<ClanOverviewPayload>(
        memberOverview.data,
    ).currentClan;
    assert.ok(promotedClan);
    assert.equal(Array.isArray(promotedClan.members), true);
    assert.equal(
        promotedClan.members?.find((entry) => entry.characterId === member.id)
            ?.role,
        "co_leader",
    );

    const outsiderPromotion = await setClanMemberRole({
        leaderCharacterId: outsider.id,
        targetCharacterId: member.id,
        role: "member",
    });
    assert.equal(outsiderPromotion.status, 400);

    const request = await createClanRequest({
        characterId: applicant.id,
        clanId,
        message: "aceptame",
    });
    assert.equal(request.status, 201);

    const coLeaderOverview = await getAuthClans(member.sessionToken);
    const requestId = expectSuccessPayload<ClanOverviewPayload>(
        coLeaderOverview.data,
    ).currentClan?.requests?.[0]?.id;
    assert.ok(requestId);

    const accepted = await acceptClanRequest(requestId as string, {
        reviewerCharacterId: member.id,
    });
    assert.equal(accepted.status, 200);

    const applicantState = await getCharacterState(
        applicant.accountId,
        applicant.id,
        applicant.email,
    );
    assert.equal(applicantState.clanId, clanId);
});

// Timeout elevado: crea 50 cuentas+personajes (~450 requests HTTP); contra el
// proceso unificado (API + game server comparten event loop) supera los 60s.
test("clans enforce a maximum of 50 members", { timeout: 240_000 }, async () => {
    const leader = await createCharacterFixture({
        namePrefix: "MaxL",
        level: 30,
        gold: 1_600_000,
    });

    const clanResponse = await createClan({
        characterId: leader.id,
        name: `Max ${uniqueLetters(4)}`,
        minJoinLevel: 1,
    });
    assert.equal(clanResponse.status, 201);
    const clanId = clanResponse.data.clanId as string;

    async function submitAndAccept(applicantId: string) {
        const requestResponse = await createClanRequest({
            characterId: applicantId,
            clanId,
            message: "quiero entrar",
        });
        assert.equal(requestResponse.status, 201);

        const overview = await getAuthClans(leader.sessionToken);
        assert.equal(overview.status, 200);
        const requestId = expectSuccessPayload<ClanOverviewPayload>(
            overview.data,
        ).currentClan?.requests?.find(
            (request) => request.characterId === applicantId,
        )?.id;
        assert.ok(requestId);

        const acceptResponse = await acceptClanRequest(requestId as string, {
            reviewerCharacterId: leader.id,
        });
        assert.equal(acceptResponse.status, 200);
    }

    for (let index = 0; index < 48; index += 1) {
        const member = await createCharacterFixture({
            namePrefix: `Mx${uniqueLetters(3)}`,
            level: 30,
            gold: 500,
        });

        await submitAndAccept(member.id);
    }

    const pendingApplicant = await createCharacterFixture({
        namePrefix: "Pend",
        level: 30,
        gold: 500,
    });
    const pendingRequest = await createClanRequest({
        characterId: pendingApplicant.id,
        clanId,
        message: "dejame entrar",
    });
    assert.equal(pendingRequest.status, 201);

    const pendingOverview = await getAuthClans(leader.sessionToken);
    assert.equal(pendingOverview.status, 200);
    const pendingRequestId = expectSuccessPayload<ClanOverviewPayload>(
        pendingOverview.data,
    ).currentClan?.requests?.find(
        (request) => request.characterId === pendingApplicant.id,
    )?.id;
    assert.ok(pendingRequestId);

    const lastAvailableSlot = await createCharacterFixture({
        namePrefix: "Last",
        level: 30,
        gold: 500,
    });
    await submitAndAccept(lastAvailableSlot.id);

    const fullClanOverview = await getAuthClans(leader.sessionToken);
    assert.equal(fullClanOverview.status, 200);
    assert.equal(
        expectSuccessPayload<ClanOverviewPayload>(fullClanOverview.data)
            .currentClan?.memberCount,
        50,
    );

    const acceptWhenFull = await acceptClanRequest(pendingRequestId as string, {
        reviewerCharacterId: leader.id,
    });
    assert.equal(acceptWhenFull.status, 400);
    assert.equal(
        acceptWhenFull.data.error,
        "El clan ya alcanzo el maximo de 50 miembros",
    );

    const overflowApplicant = await createCharacterFixture({
        namePrefix: "Over",
        level: 30,
        gold: 500,
    });
    const overflowRequest = await createClanRequest({
        characterId: overflowApplicant.id,
        clanId,
        message: "hay lugar?",
    });
    assert.equal(overflowRequest.status, 400);
    assert.equal(
        overflowRequest.data.error,
        "El clan ya alcanzo el maximo de 50 miembros",
    );
});

test("leader can delete clan and all members lose membership", async () => {
    const { clanId, leader, member } = await createClanFixture();

    const deleted = await deleteClan({
        leaderCharacterId: leader.id,
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(
        new Set(deleted.data.memberCharacterIds ?? []),
        new Set([leader.id, member.id]),
    );

    const leaderState = await getCharacterState(
        leader.accountId,
        leader.id,
        leader.email,
    );
    const memberState = await getCharacterState(
        member.accountId,
        member.id,
        member.email,
    );
    assert.equal(leaderState.clanId, null);
    assert.equal(memberState.clanId, null);

    const details = await getAuthClanDetails(leader.sessionToken, clanId);
    assert.equal(details.status, 400);
    assert.equal(details.data.error, "Clan invalido");
});

test("leader can transfer clan leadership to another member", async () => {
    const { clanId, leader, member } = await createClanFixture();

    const transferred = await transferClanLeadership({
        leaderCharacterId: leader.id,
        targetCharacterId: member.id,
    });
    assert.equal(transferred.status, 200);
    assert.equal(transferred.data.clanId, clanId);
    assert.equal(transferred.data.previousLeaderCharacterId, leader.id);
    assert.equal(transferred.data.newLeaderCharacterId, member.id);

    const leaderOverview = await getAuthClans(leader.sessionToken);
    const memberOverview = await getAuthClans(member.sessionToken);
    const leaderClan = expectSuccessPayload<ClanOverviewPayload>(
        leaderOverview.data,
    ).currentClan;
    const memberClan = expectSuccessPayload<ClanOverviewPayload>(
        memberOverview.data,
    ).currentClan;
    assert.ok(leaderClan);
    assert.ok(memberClan);
    assert.equal(Array.isArray(leaderClan.members), true);
    assert.equal(Array.isArray(memberClan.members), true);
    assert.equal(leaderClan.leaderCharacterId, member.id);
    assert.equal(memberClan.leaderCharacterId, member.id);
    assert.equal(
        leaderClan.members?.find((entry) => entry.characterId === leader.id)
            ?.role,
        "member",
    );
    assert.equal(
        memberClan.members?.find((entry) => entry.characterId === member.id)
            ?.role,
        "leader",
    );

    const oldLeaderDelete = await deleteClan({
        leaderCharacterId: leader.id,
    });
    assert.equal(oldLeaderDelete.status, 400);
    assert.equal(
        oldLeaderDelete.data.error,
        "Solo el lider puede borrar el clan",
    );

    const newLeaderDelete = await deleteClan({
        leaderCharacterId: member.id,
    });
    assert.equal(newLeaderDelete.status, 200);
});

test("clan alignment is derived from leader and respects citizen/armada and criminal/caos combinations", async () => {
    const citizenLeader = await createCharacterFixture({
        namePrefix: "CitL",
        level: 30,
        gold: 1_600_000,
    });
    const criminalLeader = await createCharacterFixture({
        namePrefix: "CriL",
        level: 30,
        gold: 1_600_000,
        items: [],
    });
    const armadaApplicant = await createCharacterFixture({
        namePrefix: "Arma",
        level: 30,
        gold: 500,
    });
    const caosApplicant = await createCharacterFixture({
        namePrefix: "Caos",
        level: 30,
        gold: 500,
    });

    await patchCharacter(criminalLeader.id, {
        criminal: true,
        faction: "none",
    });
    await patchCharacter(armadaApplicant.id, {
        criminal: false,
        faction: "armada",
    });
    await patchCharacter(caosApplicant.id, {
        criminal: false,
        faction: "caos",
    });

    const citizenClan = await createClan({
        characterId: citizenLeader.id,
        name: `Cit ${uniqueLetters(4)}`,
        minJoinLevel: 1,
    });
    const criminalClan = await createClan({
        characterId: criminalLeader.id,
        name: `Cri ${uniqueLetters(4)}`,
        minJoinLevel: 1,
    });

    assert.equal(citizenClan.status, 201);
    assert.equal(criminalClan.status, 201);

    const citizenOverview = await getAuthClanDetails(
        citizenLeader.sessionToken,
        citizenClan.data.clanId as string,
    );
    const criminalOverview = await getAuthClanDetails(
        criminalLeader.sessionToken,
        criminalClan.data.clanId as string,
    );
    assert.equal(citizenOverview.data.alignment, "citizen");
    assert.equal(criminalOverview.data.alignment, "criminal");

    const citizenArmadaRequest = await createClanRequest({
        characterId: armadaApplicant.id,
        clanId: citizenClan.data.clanId,
    });
    assert.equal(citizenArmadaRequest.status, 201);

    const criminalArmadaRequest = await createClanRequest({
        characterId: armadaApplicant.id,
        clanId: criminalClan.data.clanId,
    });
    assert.equal(criminalArmadaRequest.status, 400);

    const criminalCaosRequest = await createClanRequest({
        characterId: caosApplicant.id,
        clanId: criminalClan.data.clanId,
    });
    assert.equal(criminalCaosRequest.status, 201);

    const citizenCaosRequest = await createClanRequest({
        characterId: caosApplicant.id,
        clanId: citizenClan.data.clanId,
    });
    assert.equal(citizenCaosRequest.status, 400);
});

test("transferring clan leadership requires the same alignment group", async () => {
    const { clanId, leader, member } = await createClanFixture();
    await patchCharacter(member.id, {
        criminal: false,
        faction: "none",
    });

    const promotedMember = await transferClanLeadership({
        leaderCharacterId: leader.id,
        targetCharacterId: member.id,
    });
    assert.equal(promotedMember.status, 200);

    await patchCharacter(leader.id, {
        criminal: false,
        faction: "armada",
    });

    const transferredToArmada = await transferClanLeadership({
        leaderCharacterId: member.id,
        targetCharacterId: leader.id,
    });

    assert.equal(transferredToArmada.status, 200);

    const transferredBackToCitizen = await transferClanLeadership({
        leaderCharacterId: leader.id,
        targetCharacterId: member.id,
    });

    assert.equal(transferredBackToCitizen.status, 200);

    await patchCharacter(member.id, {
        criminal: true,
        faction: "none",
    });

    const transferredBack = await transferClanLeadership({
        leaderCharacterId: member.id,
        targetCharacterId: leader.id,
    });

    assert.equal(transferredBack.status, 400);
    assert.equal(
        transferredBack.data.error,
        "Solo puedes transferir el liderazgo a un miembro de tu misma faccion",
    );

    await patchCharacter(leader.id, {
        criminal: true,
        faction: "none",
    });

    const transferredToSameFaction = await transferClanLeadership({
        leaderCharacterId: member.id,
        targetCharacterId: leader.id,
    });

    assert.equal(transferredToSameFaction.status, 200);

    const previousLeaderState = await getCharacterState(
        member.accountId,
        member.id,
        member.email,
    );
    const newLeaderState = await getCharacterState(
        leader.accountId,
        leader.id,
        leader.email,
    );
    const clanDetails = await getAuthClanDetails(leader.sessionToken, clanId);

    assert.equal(previousLeaderState.clanId, clanId);
    assert.equal(newLeaderState.clanId, clanId);
    assert.equal(clanDetails.status, 200);
    assert.equal(clanDetails.data.alignment, "criminal");
    assert.ok(clanDetails.data.members);
    assert.equal(
        clanDetails.data.members?.some(
            (entry) => entry.characterId === member.id,
        ),
        true,
    );
});
