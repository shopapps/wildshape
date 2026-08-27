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
        sendChat: (who, message) => chat.push({ who, message }),
        setTimeout: (callback) => {
            callback();
            return 1;
        }
    };

    add("player", "gm", { _displayname: "Paul", _lastpage: "page-1" });
    add("player", "player-1", { _displayname: "Tylen Player", _lastpage: "page-1" });

    return { add, campaign, chat, env, handlers, objects };
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
            }
        }
    );
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
    assert.equal(token.get("name"), "Wolf");
    assert.equal(token.get("bar1_value"), 7);

    token.set("bar1_value", 3);
    await mod.shift(msg, "tylen", "human", "tylen-2014");
    assert.equal(token.get("represents"), "tylen-2014");
    assert.equal(token.get("name"), "Tylen");
    assert.equal(token.get("bar1_value"), 12);

    await mod.shift(msg, "tylen", "wolf", "tylen-2014");
    assert.equal(token.get("bar1_value"), 3);
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
