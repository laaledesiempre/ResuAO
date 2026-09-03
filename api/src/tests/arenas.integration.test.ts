import assert from "node:assert/strict";
import { beforeAll, test } from "vitest";
import {
    type ArenaRoomPayload,
    type ConsumedGameTicketPayload,
    type GameTicketResponse,
    connectArenaRoom,
    consumeGameTicket,
    createAccountFixture,
    createArenaRoom,
    createArenaTicket,
    disconnectArenaRoom,
    ensureApiReady,
    expectErrorPayload,
    expectSuccessPayload,
    getArenaMembership,
    getArenaRoom,
    joinArenaRoom,
    joinArenaRoomByLink,
    leaveArenaRoom,
    listArenaRooms,
} from "./helpers/api";

beforeAll(async () => {
    await ensureApiReady();
});

test("public arena rooms can be created and listed", async () => {
    const owner = await createAccountFixture();

    const created = await createArenaRoom(owner.session.sessionToken, {
        name: "Sala Publica",
        isPublic: true,
        capacity: 4,
    });
    assert.equal(created.status, 201);
    const createdRoom = expectSuccessPayload<ArenaRoomPayload>(created.data);

    const listed = await listArenaRooms(owner.session.sessionToken);
    assert.equal(listed.status, 200);
    assert.equal(
        listed.data.rooms?.some((room) => room.id === createdRoom.id),
        true,
    );
});

test("private arena rooms require the correct password", async () => {
    const owner = await createAccountFixture();
    const guest = await createAccountFixture();

    const created = await createArenaRoom(owner.session.sessionToken, {
        name: "Sala Privada",
        isPublic: false,
        password: "Secreta123",
        capacity: 4,
    });
    const roomId = expectSuccessPayload<ArenaRoomPayload>(created.data).id;

    const noPassword = await joinArenaRoom(
        guest.session.sessionToken,
        roomId,
        {},
    );
    const wrongPassword = await joinArenaRoom(
        guest.session.sessionToken,
        roomId,
        {
            password: "mala",
        },
    );
    const joined = await joinArenaRoom(guest.session.sessionToken, roomId, {
        password: "Secreta123",
    });

    assert.equal(noPassword.status, 400);
    assert.equal(
        expectErrorPayload(noPassword.data).error,
        "La sala privada requiere password",
    );
    assert.equal(wrongPassword.status, 400);
    assert.equal(expectErrorPayload(wrongPassword.data).error, "Password invalida");
    assert.equal(joined.status, 200);
    assert.equal(expectSuccessPayload<ArenaRoomPayload>(joined.data).id, roomId);
});

test("joining by link moves the account into the room", async () => {
    const owner = await createAccountFixture();
    const guest = await createAccountFixture();

    const created = await createArenaRoom(owner.session.sessionToken, {
        name: "Sala Link",
        isPublic: true,
        capacity: 4,
    });
    const createdRoom = expectSuccessPayload<ArenaRoomPayload>(created.data);

    const joined = await joinArenaRoomByLink(
        guest.session.sessionToken,
        createdRoom.joinToken,
    );

    assert.equal(joined.status, 200);
    const membership = await getArenaMembership(guest.session.account._id);
    assert.equal(membership.roomId, createdRoom.id);
});

test("arena ticket creation requires membership and can be consumed", async () => {
    const owner = await createAccountFixture();
    const guest = await createAccountFixture();

    const created = await createArenaRoom(owner.session.sessionToken, {
        name: "Arena Ticket",
        isPublic: true,
        capacity: 4,
    });
    const roomId = expectSuccessPayload<ArenaRoomPayload>(created.data).id;

    const noMembership = await createArenaTicket(
        guest.session.sessionToken,
        roomId,
        2,
    );
    assert.equal(noMembership.status, 400);
    assert.equal(
        expectErrorPayload(noMembership.data).error,
        "Primero debes unirte a la sala",
    );

    await joinArenaRoom(guest.session.sessionToken, roomId, {});
    const ticketResponse = await createArenaTicket(
        guest.session.sessionToken,
        roomId,
        2,
    );
    assert.equal(ticketResponse.status, 200);
    const ticket = expectSuccessPayload<GameTicketResponse>(ticketResponse.data).ticket;

    const consumed = await consumeGameTicket(
        ticket,
        "198.51.100.44",
    );
    assert.equal(consumed.status, 200);
    const consumedTicket = expectSuccessPayload<ConsumedGameTicketPayload>(
        consumed.data,
    );
    assert.equal(consumedTicket.mode, "arena");
    assert.equal(consumedTicket.arena?.roomId, roomId);
    assert.equal(consumedTicket.arena?.pvpTemplateId, 2);
});

test("internal arena connect and disconnect update membership state", async () => {
    const owner = await createAccountFixture();
    const guest = await createAccountFixture();

    const created = await createArenaRoom(owner.session.sessionToken, {
        name: "Arena Conn",
        isPublic: true,
        capacity: 4,
    });
    const roomId = expectSuccessPayload<ArenaRoomPayload>(created.data).id;

    await joinArenaRoom(guest.session.sessionToken, roomId, {});

    const connect = await connectArenaRoom(roomId, guest.session.account._id);
    assert.equal(connect.status, 200);
    let membership = await getArenaMembership(guest.session.account._id);
    assert.equal(membership.connected, true);

    const disconnect = await disconnectArenaRoom(
        roomId,
        guest.session.account._id,
    );
    assert.equal(disconnect.status, 200);
    membership = await getArenaMembership(guest.session.account._id);
    assert.equal(membership.connected, false);
});

test("leaving an arena room removes membership", async () => {
    const owner = await createAccountFixture();
    const guest = await createAccountFixture();

    const created = await createArenaRoom(owner.session.sessionToken, {
        name: "Arena Leave",
        isPublic: true,
        capacity: 4,
    });
    const roomId = expectSuccessPayload<ArenaRoomPayload>(created.data).id;

    await joinArenaRoom(guest.session.sessionToken, roomId, {});
    const left = await leaveArenaRoom(guest.session.sessionToken, roomId);
    assert.equal(left.status, 200);

    const membership = await getArenaMembership(guest.session.account._id);
    assert.equal(membership.roomId, null);
});
