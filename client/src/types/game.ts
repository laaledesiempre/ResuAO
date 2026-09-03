// Graphics data structure from graficos.json
export interface GraphicData {
    numFrames: number;
    numFile: string;
    sX: number;
    sY: number;
    width: number;
    height: number;
    frames: Record<string, string>;
    speed?: number; // Animation speed in milliseconds per frame
    offset: {
        x: number;
        y: number;
    };
}

// Object data structure from objs.json
export interface ObjectData {
    name: string;
    objType?: number;
    grhIndex: string | number;
    minHit?: number;
    maxHit?: number;
    minDef?: number;
    maxDef?: number;
    minDefMag?: number;
    maxDefMag?: number;
    resistenciaMagica?: number;
    apu?: number;
    proyectil?: number;
    magicDamageBonus?: number;
}

// NPC data structure from npcs.json
export interface NPCData {
    name: string;
    idHead: number;
    idBody: number;
    npcType?: number;
    desc?: string;
    exp?: number;
    gold?: number;
    hp?: number;
    maxHp?: number;
    maxHit?: number;
    minHit?: number;
    def?: number;
    poderAtaque?: number;
    poderEvasion?: number;
    drop?: Array<{
        item: number;
        cant: number;
    }>;
}

// Body data structure from bodies.json
export interface BodyData {
    "1": number; // Right direction
    "2": number; // Left direction
    "3": number; // North direction
    "4": number; // South direction
    headOffsetX: number;
    headOffsetY: number;
}

// Head data structure from heads.json
export interface HeadData {
    "1": number; // Right direction
    "2": number; // Left direction
    "3": number; // North direction
    "4": number; // South direction
}

export interface DirectionalGraphicData {
    "1": number;
    "2": number;
    "3": number;
    "4": number;
}

export interface HelmetData extends DirectionalGraphicData {
    offsetX: number;
    offsetY: number;
}

// Map tile data structure from mapa_1.map
export interface MapTile {
    blocked?: number; // blocking/collision
    graphics?: Record<string, number>; // graphics layers
    tileExit?: {
        map: number;
        x: number;
        y: number;
    };
    trigger?: number;
    npcIndex?: number; // NPC reference
    objInfo?: {
        objIndex: number;
        amount: number;
    };
}

// Map data structure
export interface MapData {
    [mapNumber: string]: {
        [y: string]: {
            [x: string]: MapTile;
        };
    };
}

// Graphics database
export interface GraphicsDB {
    [id: string]: GraphicData;
}

// Objects database
export interface ObjectsDB {
    [id: string]: ObjectData;
}

// NPCs database
export interface NPCsDB {
    [id: string]: NPCData;
}

// Bodies database
export interface BodiesDB {
    [id: string]: BodyData;
}

// Heads database
export interface HeadsDB {
    [id: string]: HeadData;
}

export interface WeaponsDB {
    [id: string]: DirectionalGraphicData;
}

export interface ShieldsDB {
    [id: string]: DirectionalGraphicData;
}

export interface HelmetsDB {
    [id: string]: HelmetData;
}

export interface FXData {
    grh: number;
    offsetX: number;
    offsetY: number;
}

export interface FXsDB {
    [id: string]: FXData;
}

export interface SpellData {
    name: string;
    desc?: string;
    type?: number;
    target?: number;
    wav?: number;
    fxGrh: number;
    manaRequired?: number;
    minSkill?: number;
    minHp?: number;
    maxHp?: number;
    subeHp?: number;
    removerParalisis?: number;
    invisibilidad?: number;
    subeAg?: number;
    subeFz?: number;
    projectileVisual?: {
        coreColor?: string;
        ringColor?: string;
        trailColor?: string;
        magnitude?: number;
    };
}

export interface SpellsDB {
    [id: string]: SpellData;
}
