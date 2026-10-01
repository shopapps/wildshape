const test = require("node:test");
const assert = require("node:assert/strict");

const { createWildShapeMod } = require("../src/wildshape");

class FakeObject {
    constructor(store, type, id, attrs) {
        this.store = store;
        this.id = id;
        this.attrs = { ...attrs, _type: type };
    }

    get(name, callback) {
        const value = this.attrs[name];
        if (callback) {
            callback(value);
        }
        return value;
    }

    set(name, value) {
        if (typeof name === "object") {
            Object.assign(this.attrs, name);
        } else {
            this.attrs[name] = value;
        }
    }

    remove() {
        this.store.delete(this.id);
    }
}

function fakeRoll20() {
    const objects = new Map();
    const handlers = new Map();
    const chat = [];
    const formChanges = [];
    const campaign = {
        journalfolder: "[]",
        playerpageid: "page-1"
    };
    let nextId = 1;

    function add(type, id, attrs = {}) {
        const object = new FakeObject(objects, type, id, attrs);
        objects.set(id, object);
        return object;
    }

    function matches(object, criteria) {
        return Object.entries(criteria).every(([key, expected]) => {
            if (key === "_type" || key === "type") {
                return object.attrs._type === expected;
            }
            if (key === "_id") {
                return object.id === expected;
            }
            return object.attrs[key] === expected;
        });
    }

    const env = {
        state: {},
        Campaign: () => ({
            get: (name) => campaign[name],
            set: (name, value) => {
                campaign[name] = value;
            }
        }),
        createObj: (type, attrs) => add(type, `${type}-${nextId++}`, attrs),
        findObjs: (criteria) => Array.from(objects.values()).filter((object) => matches(object, criteria)),
        getObj: (type, id) => {
            const object = objects.get(id);
            return object && object.attrs._type === type ? object : null;
        },
        log: () => {},
        on: (event, callback) => {
            handlers.set(event, callback);
        },
        playerIsGM: (playerId) => playerId === "gm",
        reportFormChange: (change) => formChanges.push(change),
        sendChat: (who, message) => chat.push({ who, message }),
        setTimeout: (callback) => {
            callback();
            return 1;
        }
    };

    add("player", "gm", { _displayname: "Paul", _lastpage: "page-1" });
    add("player", "player-1", { _displayname: "Tylen Player", _lastpage: "page-1" });

    return { add, campaign, chat, env, formChanges, handlers, objects };
}

function tokenData(name, imgsrc, represents, bar1Value) {
    return JSON.stringify({
        name,
        imgsrc,
        represents,
        width: 70,
        height: 70,
        bar1_value: bar1Value,
        bar1_max: bar1Value
    });
}

function tylenGame() {
    const game = fakeRoll20();
    game.add("character", "tylen-2014", {
        name: "Tylen",
        controlledby: "player-1",
        avatar: "https://img.example/tylen.png",
        defaulttoken: tokenData("Tylen", "https://img.example/tylen-token.png", "tylen-2014", 12)
    });
    game.add("character", "tylen-2024", {
        name: "Tylen 2024",
        controlledby: "player-1",
        avatar: "https://img.example/tylen-2024.png",
        defaulttoken: tokenData("Tylen 2024", "https://img.example/tylen-2024-token.png", "tylen-2024", 14)
    });
    game.add("character", "boar", {
        name: "Boar",
        controlledby: "player-1",
        avatar: "https://img.example/boar.png",
        defaulttoken: tokenData("Boar", "https://img.example/boar-token.png", "boar", 11)
    });
    game.add("character", "wolf", {
        name: "Wolf",
        controlledby: "player-1",
        avatar: "https://img.example/wolf.png",
        defaulttoken: tokenData("Wolf", "https://img.example/wolf-token.png", "wolf", 7)
    });
    game.campaign.journalfolder = JSON.stringify([
        { n: "Tylen", id: "folder-tylen", i: ["wolf", "boar"] }
    ]);
    return game;
}

test("parses quoted setup names and repeated base choices", () => {
    const game = fakeRoll20();
    const mod = createWildShapeMod(game.env);

    assert.deepEqual(
        mod.parseCommand('!wildshape setup --folder "Tylen" --base "Tylen" --base "Tylen 2024"'),
        {
            command: "setup",
            options: {
                folder: "Tylen",
                base: ["Tylen", "Tylen 2024"]
            },
            args: []
        }
    );
});

test("refresh command rescans the folder and removes stale buttons", async () => {
    const game = tylenGame();
    const mod = createWildShapeMod(game.env);
    mod.setupGroup("Tylen", ["Tylen"]);

    game.campaign.journalfolder = JSON.stringify([
        { n: "Tylen", id: "folder-tylen", i: ["boar"] }
    ]);
    await mod.handleChat({
        type: "api",
        playerid: "gm",
        content: "!wildshape refresh Tylen"
    });

    const names = game.env.findObjs({ _type: "ability", _characterid: "tylen-2014" })
        .map((ability) => ability.get("name"));
    assert.deepEqual(names, ["Human", "Boar"]);
    const gmMessage = game.chat.find((entry) => entry.message.startsWith('/w "Paul"'));
    const playerMessage = game.chat.find((entry) => entry.message.startsWith('/w "Tylen Player"'));
    assert.match(gmMessage.message, /Tylen buttons and player access now match 1 animal form/);
    assert.match(gmMessage.message, /Close and reopen the character sheet/);
    assert.match(playerMessage.message, /WildShape buttons and animal access were updated for <b>Tylen<\/b>/);
    assert.match(playerMessage.message, /Close and reopen the character sheet/);
});

test("help lists the commands and the sheet refresh step", async () => {
    const game = tylenGame();
    const mod = createWildShapeMod(game.env);

    await mod.handleChat({
        type: "api",
        playerid: "player-1",
        content: "!wildshape help"
    });

    const message = game.chat.at(-1).message;
    assert.match(message, /!wildshape help/);
    assert.match(message, /!wildshape setup --folder/);
    assert.match(message, /!wildshape sync --group tylen/);
    assert.match(message, /!wildshape refresh Tylen/);
    assert.match(message, /close and reopen the character sheet/i);
});

test("sync privately tells each character controller", async () => {
    const game = tylenGame();
    game.add("player", "player-2", { _displayname: "Second Player", _lastpage: "page-1" });
    game.objects.get("tylen-2014").set("controlledby", "player-1,player-2");
    const mod = createWildShapeMod(game.env);
    mod.setupGroup("Tylen", ["Tylen"]);

    await mod.handleChat({
        type: "api",
        playerid: "gm",
        content: "!wildshape sync --group tylen"
    });

    assert.equal(game.chat.length, 3);
    assert.ok(game.chat.some((entry) => entry.message.startsWith('/w "Paul"')));
    assert.ok(game.chat.some((entry) => entry.message.startsWith('/w "Tylen Player"')));
    assert.ok(game.chat.some((entry) => entry.message.startsWith('/w "Second Player"')));
});

test("sync gives every animal the base character controllers", () => {
    const game = tylenGame();
    game.add("player", "player-2", { _displayname: "Second Player", _lastpage: "page-1" });
    game.objects.get("tylen-2014").set("controlledby", "player-1,player-2");
    game.objects.get("boar").set("controlledby", "old-player");
    game.objects.get("wolf").set("controlledby", "");
    const mod = createWildShapeMod(game.env);

    mod.setupGroup("Tylen", ["Tylen"]);

    assert.equal(game.objects.get("boar").get("controlledby"), "player-1,player-2");
    assert.equal(game.objects.get("wolf").get("controlledby"), "player-1,player-2");

    game.add("character", "spider", {
        name: "Spider",
        controlledby: "source-owner",
        avatar: "https://img.example/spider.png",
        defaulttoken: tokenData("Spider", "https://img.example/spider-token.png", "spider", 5)
    });
    game.campaign.journalfolder = JSON.stringify([
        { n: "Tylen", id: "folder-tylen", i: ["wolf", "boar", "spider"] }
    ]);
    game.objects.get("tylen-2014").set("controlledby", "player-2");

    mod.syncGroup("tylen");

    assert.equal(game.objects.get("boar").get("controlledby"), "player-2");
    assert.equal(game.objects.get("wolf").get("controlledby"), "player-2");
    assert.equal(game.objects.get("spider").get("controlledby"), "player-2");
});

test("sync joins controllers from more than one base character", () => {
    const game = tylenGame();
    game.add("player", "player-2", { _displayname: "Second Player", _lastpage: "page-1" });
    game.objects.get("tylen-2014").set("controlledby", "player-1");
    game.objects.get("tylen-2024").set("controlledby", "player-2");
    game.objects.get("boar").set("controlledby", "old-player");
    game.objects.get("wolf").set("controlledby", "old-player");
    const mod = createWildShapeMod(game.env);

    mod.setupGroup("Tylen", ["Tylen", "Tylen 2024"]);

    assert.equal(game.objects.get("boar").get("controlledby"), "player-1,player-2");
    assert.equal(game.objects.get("wolf").get("controlledby"), "player-1,player-2");
});

test("adds Human and animal buttons to both base character sheets", () => {
    const game = tylenGame();
    const mod = createWildShapeMod(game.env);

    const result = mod.setupGroup("Tylen", ["Tylen", "Tylen 2024"]);

    assert.equal(result.forms.length, 2);
    for (const characterId of ["tylen-2014", "tylen-2024"]) {
        const abilities = game.env.findObjs({ _type: "ability", _characterid: characterId });
        assert.deepEqual(abilities.map((ability) => ability.get("name")), ["Human", "Boar", "Wolf"]);
        assert.ok(abilities.every((ability) => ability.get("istokenaction") === true));
        assert.match(abilities[1].get("action"), /--form boar/);
    }
});

test("names each animal sheet for its player but keeps short button names", () => {
    const game = tylenGame();
    game.objects.get("wolf").set("name", "Tylen - Wolf");
    const mod = createWildShapeMod(game.env);

    mod.setupGroup("Tylen", ["Tylen 2024"]);

    assert.equal(game.objects.get("boar").get("name"), "Tylen-Boar");
    assert.equal(game.objects.get("wolf").get("name"), "Tylen-Wolf");
    const names = game.env.findObjs({ _type: "ability", _characterid: "tylen-2024" })
        .map((ability) => ability.get("name"));
    assert.deepEqual(names, ["Human", "Boar", "Wolf"]);

    mod.syncGroup("tylen");
    assert.equal(game.objects.get("wolf").get("name"), "Tylen-Wolf");
});

test("removes a managed button when its character leaves the folder", () => {
    const game = tylenGame();
    const mod = createWildShapeMod(game.env);
    mod.setupGroup("Tylen", ["Tylen"]);

    game.campaign.journalfolder = JSON.stringify([
        { n: "Tylen", id: "folder-tylen", i: ["boar"] }
    ]);
    mod.syncGroup("tylen");

    const names = game.env.findObjs({ _type: "ability", _characterid: "tylen-2014" })
        .map((ability) => ability.get("name"));
    assert.deepEqual(names, ["Human", "Boar"]);
});

test("changes to an animal, returns to Human, and remembers each form's bars", async () => {
    const game = tylenGame();
    const mod = createWildShapeMod(game.env);
    mod.setupGroup("Tylen", ["Tylen"]);
    const token = game.add("graphic", "token-1", {
        _subtype: "token",
        _pageid: "page-1",
        represents: "tylen-2014",
        controlledby: "player-1",
        name: "Tylen",
        imgsrc: "https://img.example/tylen-token.png",
        width: 70,
        height: 70,
        bar1_value: 12,
        bar1_max: 12
    });
    const msg = {
        type: "api",
        playerid: "player-1",
        selected: [{ _type: "graphic", _id: "token-1" }]
    };

    await mod.shift(msg, "tylen", "wolf", "tylen-2014");
    assert.equal(token.get("represents"), "wolf");
    assert.equal(game.objects.get("wolf").get("name"), "Tylen-Wolf");
    assert.equal(token.get("name"), "Tylen-Wolf");
    assert.equal(token.get("bar1_value"), 7);
    assert.deepEqual(game.formChanges[0], {
        playerId: "player-1",
        pageId: "page-1",
        characterId: "tylen-2014",
        characterName: "Tylen",
        tokenId: "token-1",
        tokenName: "Tylen-Wolf",
        fromForm: "Human",
        toForm: "Wolf"
    });

    token.set("bar1_value", 3);
    await mod.shift(msg, "tylen", "human", "tylen-2014");
    assert.equal(token.get("represents"), "tylen-2014");
    assert.equal(token.get("name"), "Tylen");
    assert.equal(token.get("bar1_value"), 12);
    assert.equal(game.formChanges[1].fromForm, "Wolf");
    assert.equal(game.formChanges[1].toForm, "Human");

    await mod.shift(msg, "tylen", "wolf", "tylen-2014");
    assert.equal(token.get("bar1_value"), 3);
    assert.equal(game.formChanges.length, 3);

    await mod.shift(msg, "tylen", "wolf", "tylen-2014");
    assert.equal(game.formChanges.length, 3);
});

test("does not change a token the player cannot control", async () => {
    const game = tylenGame();
    game.objects.get("tylen-2014").set("controlledby", "another-player");
    const mod = createWildShapeMod(game.env);
    mod.setupGroup("Tylen", ["Tylen"]);
    const token = game.add("graphic", "token-1", {
        _subtype: "token",
        _pageid: "page-1",
        represents: "tylen-2014",
        controlledby: "another-player",
        name: "Tylen",
        imgsrc: "https://img.example/tylen-token.png"
    });

    await assert.rejects(
        mod.shift({
            type: "api",
            playerid: "player-1",
            selected: [{ _type: "graphic", _id: "token-1" }]
        }, "tylen", "wolf", "tylen-2014"),
        /do not control/
    );
    assert.equal(token.get("represents"), "tylen-2014");
});

const scores = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const skills = ["athletics", "acrobatics", "sleight_of_hand", "stealth", "arcana", "history",
    "investigation", "nature", "religion", "animal_handling", "insight", "medicine", "perception",
    "survival", "deception", "intimidation", "performance", "persuasion"];

function tylen2024Game() {
    const game = tylenGame();
    game.objects.get("tylen-2024").set("charactersheetname", "dnd2024byroll20");
    const fields = { pb: 3, ac: 17, hp: 83, hp_max: 83, hp_temp: 0, lvl1_slots_expended: 2 };
    scores.forEach((score, i) => {
        fields[score] = [18, 14, 16, 16, 18, 15][i];
        fields[`${score}_save_prof`] = ["intelligence", "wisdom"].includes(score) ? 1 : 0;
    });
    skills.forEach((skill) => {
        fields[`${skill}_prof`] = ["perception", "nature"].includes(skill) ? 1 : 0;
        fields[`${skill}_type`] = 1;
        fields[`${skill}_flat`] = 0;
    });
    const data = { character: { creatureType: "Humanoid" }, integrants: { integrants: {
        level: { type: "Class Level", name: "Druid", level: 8 },
        moon: { type: "Subclass", name: "Circle of the Moon" },
        resource: { type: "Resource", name: "Wild Shape", value: 3, relations: { level: "modifiedBy" } },
        language: { type: "Language", name: "Common" },
        feature: { type: "Features", name: "Lucky" },
        strike: { type: "Effect", name: "Primal Strike" }
    } } };
    const writes = [];
    game.env.getComputed = async ({ characterId: id, property: key }) => {
        assert.equal(id, "tylen-2024");
        return key === "hp" ? { current: fields.hp, max: fields.hp_max } : fields[key];
    };
    game.env.setComputed = async ({ characterId: id, property: key, args: [value] }) => {
        assert.equal(id, "tylen-2024");
        assert.ok(["hp_current", "hp_temp"].includes(key), "never write class data, resources or max HP");
        writes.push([key, value]);
        fields[key === "hp_current" ? "hp" : key] = value;
    };
    game.add("attribute", "store", { _characterid: "tylen-2024", name: "store", current: data });
    for (const id of ["wolf", "boar"]) {
        const values = { npc: 1, npc_ac: 13, npc_challenge: "1/4", npc_type: "Medium beast, unaligned",
            npc_senses: "darkvision 60 ft., passive Perception 13", npc_perception: 3, npc_stealth: 4,
            npc_speed: "40 ft.", hp: 7, repeating_npcaction_bite_attack_tohit: "+4" };
        scores.forEach((score, i) => { values[score] = [12, 15, 12, 3, 12, 6][i]; });
        Object.entries(values).forEach(([name, current]) => game.add("attribute", `${id}-${name}`, {
            _characterid: id, name, current, max: name === "hp" ? 7 : ""
        }));
    }
    const token = game.add("graphic", "token-2024", {
        _subtype: "token", _pageid: "page-1", represents: "tylen-2024", name: "Tylen 2024",
        imgsrc: "https://img.example/tylen-2024-token.png", bar1_value: 11, bar1_max: 11
    });
    const msg = { type: "api", playerid: "player-1", selected: [{ _type: "graphic", _id: token.id }] };
    const mod = createWildShapeMod(game.env);
    mod.setupGroup("Tylen", ["Tylen 2024"]);
    const attr = (id, name) => game.env.findObjs({ _type: "attribute", _characterid: id, name })[0];
    return { ...game, attr, data, fields, writes, token, msg, mod };
}

test("2024 sync carries mental stats, proficiencies, Moon AC and saves without stacking", async () => {
    const { mod, attr, token, fields, writes, data, env } = tylen2024Game();
    const originalData = JSON.stringify(data);
    fields.nature_type = 2;
    fields.nature_flat = 1;
    await mod.syncStats2024("tylen");
    await mod.syncStats2024("tylen");
    assert.deepEqual(scores.map((score) => attr("wolf", score).get("current")), [12, 15, 12, 16, 18, 15]);
    assert.equal(attr("wolf", "npc_ac").get("current"), 17);
    assert.equal(attr("wolf", "npc_con_save").get("current"), 5);
    assert.equal(attr("wolf", "npc_int_save").get("current"), 6);
    assert.equal(attr("wolf", "npc_wis_save").get("current"), 7);
    assert.equal(attr("wolf", "npc_perception").get("current"), 7);
    assert.equal(attr("wolf", "npc_stealth").get("current"), 5);
    assert.equal(attr("wolf", "npc_nature").get("current"), 10);
    assert.equal(attr("wolf", "npc_religion").get("current"), 3);
    assert.equal(attr("wolf", "npc_languages").get("current"), "Common");
    assert.equal(attr("wolf", "npc_type").get("current"), "Medium Humanoid, unaligned");
    assert.equal(attr("wolf", "npc_senses").get("current"), "darkvision 60 ft., passive Perception 17");
    assert.equal(attr("wolf", "npc_speed").get("current"), "40 ft.");
    assert.equal(attr("wolf", "repeating_npcaction_bite_attack_tohit").get("current"), "+4");
    assert.match(attr("wolf", "repeating_npctrait_wildshapenext_description").get("current"), /Lucky/);
    assert.equal(attr("wolf", "npc_name").get("current"), "Tylen-Wolf");
    assert.equal(attr("wolf", "hp").get("current"), 83);
    assert.equal(token.get("bar1_value"), 83);
    assert.equal(token.get("bar2_value"), 17);
    assert.equal(token.get("bar3_value"), 0);
    assert.equal(JSON.stringify(data), originalData);
    assert.deepEqual(writes, []);
    assert.ok(env.findObjs({ _type: "ability", _characterid: "wolf" })
        .every((ability) => ability.get("action").endsWith("--base tylen-2024")));
});

test("2024 forms share damage and healing; changing back does not reset HP or resources", async () => {
    const { mod, msg, token, fields, attr, data, chat } = tylen2024Game();
    await mod.syncStats2024("tylen");
    await mod.shift(msg, "tylen", "wolf", "tylen-2024");
    assert.equal(token.get("represents"), "wolf");
    assert.equal(token.get("bar1_value"), 83);
    assert.equal(token.get("bar2_value"), 17);
    assert.equal(token.get("bar3_value"), 24);
    assert.match(chat.at(-1).message, /Spend one Wild Shape use by hand/);
    await mod.handleChat({ ...msg, content: "!wildshape damage Tylen 30" });
    assert.equal(fields.hp, 77);
    assert.equal(fields.hp_temp, 0);
    assert.equal(attr("boar", "hp").get("current"), 77);
    await mod.shift(msg, "tylen", "wolf", "tylen-2024");
    assert.equal(fields.hp_temp, 0, "clicking the current form must not refill temp HP");
    await mod.shift(msg, "tylen", "boar", "tylen-2024");
    assert.equal(fields.hp_temp, 24);
    assert.equal(token.get("bar1_value"), 77);
    await mod.shift(msg, "tylen", "human", "tylen-2024");
    assert.equal(token.get("represents"), "tylen-2024");
    assert.equal(token.get("bar1_value"), 77);
    assert.equal(token.get("bar1_link"), "hp");
    assert.equal(token.get("bar3_value"), 24);
    await mod.handleChat({ ...msg, content: "!wildshape heal Tylen 50" });
    assert.equal(fields.hp, 83);
    assert.equal(fields.hp_temp, 24);
    assert.equal(fields.lvl1_slots_expended, 2);
    assert.equal(data.integrants.integrants.resource.value, 3);
    assert.equal(data.integrants.integrants.resource.relations.level, "modifiedBy");
});

test("non-Moon druid temp HP uses Druid level, not total level, and does not replace a higher amount", async () => {
    const { mod, msg, token, fields, data, attr } = tylen2024Game();
    data.integrants.integrants.moon._enabled = false;
    data.integrants.integrants.level.level = 3;
    data.integrants.integrants.other = { type: "Class Level", name: "Cleric", level: 5 };
    fields.hp_temp = 10;
    await mod.shift(msg, "tylen", "wolf", "tylen-2024");
    assert.equal(token.get("bar3_value"), 10);
    assert.equal(attr("wolf", "npc_ac").get("current"), 13);
    assert.equal(attr("wolf", "npc_con_save").get("current"), 1);
    fields.hp_temp = 0;
    await mod.shift(msg, "tylen", "boar", "tylen-2024");
    assert.equal(token.get("bar3_value"), 3);
});

test("2024 health sheet edits flow both ways, including zero; animal max edits do not alter the main max", async () => {
    const { mod, fields, attr, handlers, token } = tylen2024Game();
    mod.start();
    await mod.syncStats2024("tylen");
    const hp = attr("wolf", "hp");
    hp.set({ current: 0, max: 7 });
    await handlers.get("change:attribute")(hp, { current: 83, max: 83 });
    assert.equal(fields.hp, 0);
    assert.equal(fields.hp_max, 83);
    assert.equal(hp.get("max"), 83);
    assert.equal(attr("boar", "hp").get("current"), 0);
    assert.equal(token.get("bar1_value"), 0);
    fields.hp = 20;
    fields.hp_temp = 6;
    await handlers.get("change:attribute")(attr("tylen-2024", "store"), { current: {} });
    assert.equal(hp.get("current"), 20);
    assert.equal(attr("wolf", "hp_temp").get("current"), 6);
    const temp = attr("wolf", "hp_temp");
    temp.set("current", 0);
    await handlers.get("change:attribute")(temp, { current: 6 });
    assert.equal(fields.hp_temp, 0);
});

test("removing and re-adding an animal updates ownership and all form buttons", async () => {
    const { mod, campaign, env, handlers, fields, attr } = tylen2024Game();
    mod.start();
    await mod.syncStats2024("tylen");
    campaign.journalfolder = JSON.stringify([{ n: "Tylen", i: ["boar"] }]);
    mod.syncGroup("tylen");
    await mod.syncStats2024("tylen");
    assert.equal(mod.stateRoot().formOwners.wolf, undefined);
    assert.equal(env.findObjs({ _type: "ability", _characterid: "wolf" }).length, 0);
    assert.deepEqual(env.findObjs({ _type: "ability", _characterid: "boar" }).map((a) => a.get("name")), ["Human", "Boar"]);
    const hp = attr("wolf", "hp");
    hp.set("current", 1);
    await handlers.get("change:attribute")(hp, { current: 83 });
    assert.equal(fields.hp, 83);
    campaign.journalfolder = JSON.stringify([{ n: "Tylen", i: ["boar", "wolf"] }]);
    await mod.handleChat({ type: "api", playerid: "gm", content: "!wildshape sync --group Tylen" });
    assert.equal(mod.stateRoot().formOwners.wolf, "tylen-2024");
    assert.equal(hp.get("current"), 83);
    assert.deepEqual(env.findObjs({ _type: "ability", _characterid: "boar" }).map((a) => a.get("name")), ["Human", "Boar", "Wolf"]);
});

test("old WildShape original cache avoids treating old PC bonuses as animal proficiencies", async () => {
    const { mod, env, attr } = tylen2024Game();
    const original = Object.fromEntries(scores.map((score) => [score, attr("wolf", score).get("current")]));
    const saved = { stats: original, saves: {}, skills: { perception: 3, stealth: 4 } };
    env.state.WILDSHAPE = { shifters: { Tylen: { shapes: { Wolf: {
        ID: "old-wolf", character: "Tylen - Wolf", stats_cache: saved
    } } } } };
    attr("wolf", "intelligence").set("current", 10);
    env.createObj("attribute", { _characterid: "wolf", name: "npc_religion", current: 3 });
    await mod.syncStats2024("tylen");
    assert.equal(attr("wolf", "npc_religion").get("current"), 3, "not 6 from the old PC's proficiency");
    assert.deepEqual(env.state.WILDSHAPE.shifters.Tylen.shapes.Wolf.stats_cache, saved);
    assert.equal(mod.stateRoot().beasts.wolf.scores.intelligence, 3);
});

test("higher original animal bonuses and AC are kept", async () => {
    const { mod, attr, env } = tylen2024Game();
    attr("wolf", "npc_ac").set("current", 20);
    env.createObj("attribute", { _characterid: "wolf", name: "npc_str_save", current: 12 });
    await mod.syncStats2024("tylen");
    assert.ok(attr("wolf", "npc_str_save").get("current") >= 12);
    assert.equal(attr("wolf", "npc_ac").get("current"), 20);
});

test("2024 setup refuses multiple main PCs without changing the existing group", () => {
    const { mod } = tylen2024Game();
    assert.throws(() => mod.setupGroup("Tylen", ["Tylen", "Tylen 2024"]), /one main character/);
    assert.deepEqual(mod.stateRoot().groups.tylen.baseCharacterIds, ["tylen-2024"]);
});

test("a main sheet placed in its own folder never becomes an animal", async () => {
    const { mod, campaign, objects } = tylen2024Game();
    campaign.journalfolder = JSON.stringify([{ n: "Tylen", i: ["tylen-2024", "wolf", "boar"] }]);
    mod.syncGroup("tylen");
    await mod.syncStats2024("tylen");
    assert.equal(objects.get("tylen-2024").get("name"), "Tylen 2024");
    assert.equal(mod.stateRoot().formOwners["tylen-2024"], undefined);
});

test("missing 2024 data, unsupported animal sheets, and missing images cannot change the token or grant temp HP", async () => {
    for (const failure of ["data", "sheet", "image"]) {
        const { mod, fields, msg, token, objects, writes } = tylen2024Game();
        if (failure === "data") fields.wisdom = undefined;
        if (failure === "sheet") objects.get("wolf").set("charactersheetname", "dnd2024byroll20");
        if (failure === "image") objects.get("wolf").set({ avatar: "", defaulttoken: "" });
        await assert.rejects(mod.shift(msg, "tylen", "wolf", "tylen-2024"));
        assert.equal(token.get("represents"), "tylen-2024");
        assert.equal(fields.hp_temp, 0);
        assert.deepEqual(writes, []);
    }
});

test("a failed sheet write is reported and cannot move the token", async () => {
    const game = tylen2024Game();
    game.env.setComputed = async () => { throw new Error("Sheet unavailable"); };
    const mod = createWildShapeMod(game.env);
    await mod.handleChat({ ...game.msg, content: "!wildshape shift --group Tylen --form wolf --base tylen-2024" });
    assert.equal(game.token.get("represents"), "tylen-2024");
    assert.equal(game.formChanges.length, 0);
    assert.match(game.chat.at(-1).message, /Sheet unavailable/);
});

test("damage and heal check control and reject bad numbers", async () => {
    const { mod, fields, msg, chat } = tylen2024Game();
    for (const content of ["!wildshape damage Tylen -5", "!wildshape heal Tylen NaN", "!wildshape damage Tylen 1.5"]) {
        await mod.handleChat({ ...msg, content });
    }
    await mod.handleChat({ ...msg, playerid: "another-player", content: "!wildshape damage Tylen 100" });
    assert.equal(fields.hp, 83);
    assert.match(chat.at(-1).message, /do not control/);
});

test("rapid damage commands are applied in order, not lost", async () => {
    const { mod, msg, fields } = tylen2024Game();
    fields.hp_temp = 5;
    await Promise.all([10, 20].map((amount) => mod.handleChat({ ...msg, content: `!wildshape damage Tylen ${amount}` })));
    assert.equal(fields.hp_temp, 0);
    assert.equal(fields.hp, 58);
});

test("2024 reads cannot be shadowed by old legacy fields in the same campaign", async () => {
    const game = tylen2024Game();
    game.env.getSheetItem = async () => 10;
    game.env.setSheetItem = async () => { assert.fail("must not write a stale legacy field"); };
    game.env.createObj("attribute", { _characterid: "tylen-2024", name: "wisdom", current: 10 });
    game.env.createObj("attribute", { _characterid: "tylen-2024", name: "hp", current: 0, max: 0 });
    const mod = createWildShapeMod(game.env);
    await mod.shift(game.msg, "tylen", "wolf", "tylen-2024");
    assert.equal(game.attr("wolf", "wisdom").get("current"), 18);
    assert.equal(game.token.get("bar1_value"), 83);
    assert.equal(game.fields.hp_temp, 24);
    assert.equal(game.attr("tylen-2024", "hp").get("current"), 0);
});

test("startup add events cannot sync before Roll20 has finished loading the sheets", async () => {
    const { mod, handlers, objects, attr } = tylen2024Game();
    mod.start();
    objects.get("wolf").set("name", "Wolf");
    handlers.get("add:character")(objects.get("wolf"));
    assert.equal(objects.get("wolf").get("name"), "Wolf");
    await handlers.get("ready")();
    assert.equal(objects.get("wolf").get("name"), "Tylen-Wolf");
    assert.equal(attr("wolf", "wisdom").get("current"), 18);
});
