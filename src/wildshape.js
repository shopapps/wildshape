/*
 * WildShape Next
 *
 * The Journal folder is the list of animal forms.
 * The Mod adds matching buttons to each base character.
 * It changes tokens only. It does not rewrite either character sheet.
 */
(function () {
    "use strict";

    const SCRIPT_NAME = "WildShape Next";
    const VERSION = "0.4.0";
    const STATE_KEY = "WildShapeNext";
    const ABILITY_MARKER = "Managed by WildShape Next";

    const FORM_PROPERTIES = [
        "imgsrc",
        "name",
        "represents",
        "width",
        "height",
        "bar1_value",
        "bar1_max",
        "bar1_link",
        "bar2_value",
        "bar2_max",
        "bar2_link",
        "bar3_value",
        "bar3_max",
        "bar3_link",
        "aura1_radius",
        "aura1_color",
        "aura1_square",
        "showplayers_aura1",
        "aura2_radius",
        "aura2_color",
        "aura2_square",
        "showplayers_aura2",
        "showname",
        "showplayers_name",
        "showplayers_bar1",
        "showplayers_bar2",
        "showplayers_bar3",
        "playersedit_name",
        "playersedit_bar1",
        "playersedit_bar2",
        "playersedit_bar3",
        "playersedit_aura1",
        "playersedit_aura2",
        "has_night_vision",
        "night_vision_distance",
        "night_vision_tint",
        "night_vision_effect",
        "emits_bright_light",
        "bright_light_distance",
        "emits_low_light",
        "low_light_distance",
        "light_sensitivity_multiplier",
        "light_radius",
        "light_dimradius",
        "light_otherplayers",
        "light_hassight",
        "light_angle",
        "light_losangle",
        "light_multiplier"
    ];

    function createWildShapeMod(env) {
        const api = {
            Campaign: env.Campaign,
            createObj: env.createObj,
            findObjs: env.findObjs,
            getObj: env.getObj,
            log: env.log || function () {},
            on: env.on,
            playerIsGM: env.playerIsGM,
            reportFormChange: env.reportFormChange || function () {},
            sendChat: env.sendChat,
            setTimeout: env.setTimeout || setTimeout,
            state: env.state
        };

        function stateRoot() {
            if (!api.state[STATE_KEY]) {
                api.state[STATE_KEY] = {
                    version: VERSION,
                    groups: {},
                    tokens: {}
                };
            }

            const root = api.state[STATE_KEY];
            root.version = VERSION;
            root.groups = root.groups || {};
            root.tokens = root.tokens || {};
            return root;
        }

        function html(value) {
            return String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
        }

        function playerName(playerId) {
            const player = api.getObj("player", playerId);
            return player ? player.get("_displayname") : "GM";
        }

        function whisper(playerId, message) {
            api.sendChat(SCRIPT_NAME, `/w "${playerName(playerId).replace(/"/g, "")}" ${message}`);
        }

        function tokenize(content) {
            const tokens = [];
            const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
            let match;

            while ((match = pattern.exec(content))) {
                tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\([\\"'])/g, "$1"));
            }

            return tokens;
        }

        function parseCommand(content) {
            const tokens = tokenize(content);
            tokens.shift();
            const command = (tokens.shift() || "help").toLowerCase();
            const options = {};
            const args = [];

            while (tokens.length) {
                const key = tokens.shift();
                if (!key.startsWith("--")) {
                    args.push(key);
                    continue;
                }

                const name = key.slice(2).toLowerCase();
                const value = tokens.length && !tokens[0].startsWith("--") ? tokens.shift() : true;
                options[name] = options[name] === undefined
                    ? value
                    : [].concat(options[name], value);
            }

            return { command, options, args };
        }

        function slug(value) {
            return String(value)
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "");
        }

        function journalData() {
            const raw = api.Campaign().get("journalfolder") || "[]";
            return typeof raw === "string" ? JSON.parse(raw) : raw;
        }

        function folderMatches(items, wantedName, matches) {
            items.forEach((item) => {
                if (!item || typeof item !== "object" || !Array.isArray(item.i)) {
                    return;
                }

                if (String(item.n).toLowerCase() === wantedName.toLowerCase()) {
                    matches.push(item);
                }
                folderMatches(item.i, wantedName, matches);
            });
        }

        function findFolder(path) {
            const parts = String(path).split("/").map((part) => part.trim()).filter(Boolean);
            let items = journalData();
            let folder = null;

            if (parts.length > 1) {
                for (const part of parts) {
                    folder = items.find((item) => item && typeof item === "object"
                        && Array.isArray(item.i)
                        && String(item.n).toLowerCase() === part.toLowerCase());
                    if (!folder) {
                        return null;
                    }
                    items = folder.i;
                }
                return folder;
            }

            const matches = [];
            folderMatches(items, parts[0] || "", matches);
            return matches.length === 1 ? matches[0] : null;
        }

        function exactCharacter(name) {
            const matches = api.findObjs({ _type: "character", name: String(name) });
            return matches.length === 1 ? matches[0] : null;
        }

        function characterForms(folderName) {
            const folder = findFolder(folderName);
            if (!folder) {
                throw new Error(`Cannot find one Journal folder named ${folderName}.`);
            }

            return folder.i
                .filter((item) => typeof item === "string")
                .map((id) => api.getObj("character", id))
                .filter(Boolean)
                .sort((left, right) => left.get("name").localeCompare(right.get("name")));
        }

        function marker(groupId) {
            return `${ABILITY_MARKER}: ${groupId}`;
        }

        function managedAbilities(characterId, groupId) {
            return api.findObjs({ _type: "ability", _characterid: characterId })
                .filter((ability) => ability.get("description") === marker(groupId));
        }

        function removeManagedAbilities(characterIds, groupId) {
            characterIds.forEach((characterId) => {
                managedAbilities(characterId, groupId).forEach((ability) => ability.remove());
            });
        }

        function desiredAbilities(group, baseCharacterId, forms) {
            const rows = [{
                name: "Human",
                action: `!wildshape shift --group ${group.id} --form human --base ${baseCharacterId}`
            }];

            forms.forEach((form) => {
                rows.push({
                    name: form.get("name"),
                    action: `!wildshape shift --group ${group.id} --form ${form.id} --base ${baseCharacterId}`
                });
            });

            return rows;
        }

        function syncAbilities(group, baseCharacterId, forms) {
            const desired = desiredAbilities(group, baseCharacterId, forms);
            const current = managedAbilities(baseCharacterId, group.id);
            const byName = new Map();

            current.forEach((ability) => {
                if (!byName.has(ability.get("name"))) {
                    byName.set(ability.get("name"), ability);
                } else {
                    ability.remove();
                }
            });

            desired.forEach((row) => {
                let ability = byName.get(row.name);
                if (!ability) {
                    ability = api.createObj("ability", {
                        _characterid: baseCharacterId,
                        name: row.name,
                        action: row.action,
                        description: marker(group.id),
                        istokenaction: true
                    });
                } else {
                    ability.set({
                        action: row.action,
                        description: marker(group.id),
                        istokenaction: true
                    });
                    byName.delete(row.name);
                }
            });

            byName.forEach((ability) => ability.remove());
        }

        function syncGroup(groupId) {
            const group = stateRoot().groups[groupId];
            if (!group) {
                throw new Error(`Unknown group ${groupId}.`);
            }

            const forms = characterForms(group.folder);
            group.formCharacterIds = forms.map((form) => form.id);
            group.baseCharacterIds = group.baseCharacterIds.filter((id) => api.getObj("character", id));
            group.baseCharacterIds.forEach((baseCharacterId) => syncAbilities(group, baseCharacterId, forms));
            return forms;
        }

        function syncAll() {
            Object.keys(stateRoot().groups).forEach((groupId) => {
                try {
                    syncGroup(groupId);
                } catch (error) {
                    api.log(`${SCRIPT_NAME}: ${error.message}`);
                }
            });
        }

        function setupGroup(folderName, baseNames, groupName) {
            const baseCharacters = baseNames.map((name) => {
                const character = exactCharacter(name);
                if (!character) {
                    throw new Error(`Cannot find one character named ${name}.`);
                }
                return character;
            });
            characterForms(folderName);

            const id = slug(groupName || folderName);
            if (!id) {
                throw new Error("The group name is empty.");
            }

            const root = stateRoot();
            const previous = root.groups[id];
            const nextBaseIds = baseCharacters.map((character) => character.id);
            if (previous) {
                removeManagedAbilities(
                    previous.baseCharacterIds.filter((characterId) => !nextBaseIds.includes(characterId)),
                    id
                );
            }

            root.groups[id] = {
                id,
                folder: folderName,
                baseCharacterIds: nextBaseIds,
                formCharacterIds: []
            };
            const forms = syncGroup(id);
            return { group: root.groups[id], forms };
        }

        function controls(value, playerId) {
            const ids = String(value || "").split(",").map((id) => id.trim());
            return ids.includes("all") || ids.includes(playerId);
        }

        function controlledPlayerIds(character) {
            const ids = String(character.get("controlledby") || "")
                .split(",")
                .map((id) => id.trim())
                .filter(Boolean);

            if (ids.includes("all")) {
                return api.findObjs({ _type: "player" }).map((player) => player.id);
            }

            return ids.filter((id) => api.getObj("player", id));
        }

        function notifyCharacterControllers(group, commandPlayerId) {
            const sheetsByPlayer = new Map();

            group.baseCharacterIds.forEach((characterId) => {
                const character = api.getObj("character", characterId);
                if (!character) {
                    return;
                }

                controlledPlayerIds(character).forEach((playerId) => {
                    if (playerId === commandPlayerId) {
                        return;
                    }
                    if (!sheetsByPlayer.has(playerId)) {
                        sheetsByPlayer.set(playerId, []);
                    }
                    sheetsByPlayer.get(playerId).push(character.get("name"));
                });
            });

            sheetsByPlayer.forEach((sheetNames, playerId) => {
                whisper(playerId,
                    `WildShape buttons were updated on <b>${sheetNames.map(html).join(", ")}</b>. `
                    + "Close and reopen the character sheet to see newly added buttons."
                );
            });

            return sheetsByPlayer.size;
        }

        function syncFeedback(playerId, group, forms, requestedGroup) {
            const notified = notifyCharacterControllers(group, playerId);
            whisper(playerId,
                `The ${html(requestedGroup)} buttons now match ${forms.length} animal form(s). `
                + "Close and reopen the character sheet to see newly added buttons."
                + (notified ? ` I also told ${notified} character controller(s).` : "")
            );
        }

        function playerControlsToken(token, playerId) {
            if (api.playerIsGM(playerId) || controls(token.get("controlledby"), playerId)) {
                return true;
            }
            const character = api.getObj("character", token.get("represents"));
            return Boolean(character && controls(character.get("controlledby"), playerId));
        }

        function groupCharacterIds(group) {
            return group.baseCharacterIds.concat(group.formCharacterIds || []);
        }

        function isGroupToken(token, group) {
            const saved = stateRoot().tokens[token.id];
            return (saved && saved.groupId === group.id)
                || groupCharacterIds(group).includes(token.get("represents"));
        }

        function currentPageId(playerId) {
            const player = api.getObj("player", playerId);
            return (player && player.get("_lastpage")) || api.Campaign().get("playerpageid");
        }

        function findTargetToken(msg, group) {
            const selectedIds = (msg.selected || [])
                .filter((item) => item._type === "graphic")
                .map((item) => item._id);
            let candidates;

            if (selectedIds.length) {
                candidates = selectedIds.map((id) => api.getObj("graphic", id)).filter(Boolean);
            } else {
                candidates = api.findObjs({
                    _type: "graphic",
                    _subtype: "token",
                    _pageid: currentPageId(msg.playerid)
                }).filter((token) => isGroupToken(token, group) && playerControlsToken(token, msg.playerid));
            }

            candidates = candidates.filter((token) => isGroupToken(token, group));
            if (candidates.length !== 1) {
                throw new Error(candidates.length
                    ? "Please select one token."
                    : "Please select the token you want to change.");
            }
            if (!playerControlsToken(candidates[0], msg.playerid)) {
                throw new Error("You do not control that token.");
            }
            return candidates[0];
        }

        function captureToken(token) {
            const result = {};
            FORM_PROPERTIES.forEach((property) => {
                const value = token.get(property);
                if (value !== undefined) {
                    result[property] = value;
                }
            });
            return result;
        }

        function parseDefaultToken(raw) {
            if (!raw) {
                return null;
            }
            if (typeof raw === "string") {
                try {
                    return JSON.parse(raw);
                } catch (_error) {
                    return null;
                }
            }
            return raw;
        }

        function readDefaultToken(character) {
            return new Promise((resolve) => {
                let settled = false;
                const done = (raw) => {
                    if (!settled && raw) {
                        settled = true;
                        resolve(parseDefaultToken(raw));
                    }
                };

                try {
                    const immediate = character.get("defaulttoken", done);
                    if (immediate) {
                        done(immediate);
                    }
                } catch (_error) {
                    // Older games may expose the underscored name instead.
                }

                try {
                    const older = character.get("_defaulttoken", done);
                    if (older) {
                        done(older);
                    }
                } catch (_error) {
                    // The timeout below supplies the avatar fallback.
                }

                api.setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        resolve(null);
                    }
                }, 1500);
            });
        }

        async function defaultSnapshot(character) {
            const token = await readDefaultToken(character);
            const snapshot = {};
            if (token) {
                FORM_PROPERTIES.forEach((property) => {
                    if (token[property] !== undefined) {
                        snapshot[property] = token[property];
                    }
                });
            }

            if (!snapshot.imgsrc) {
                snapshot.imgsrc = character.get("avatar");
            }
            snapshot.name = character.get("name");
            snapshot.represents = character.id;
            return snapshot;
        }

        function validImage(snapshot) {
            return snapshot.imgsrc && /^(https?:|data:)/.test(snapshot.imgsrc);
        }

        async function shift(msg, groupId, formId, baseCharacterId) {
            const group = stateRoot().groups[groupId];
            if (!group) {
                throw new Error(`Unknown group ${groupId}.`);
            }
            if (!group.baseCharacterIds.includes(baseCharacterId)) {
                throw new Error("That base character is not in this group.");
            }

            const forms = syncGroup(groupId);
            const isHuman = formId === "human";
            const targetCharacter = isHuman
                ? api.getObj("character", baseCharacterId)
                : forms.find((form) => form.id === formId);
            if (!targetCharacter) {
                throw new Error("That form is no longer in the Journal folder. Run sync and try again.");
            }

            const token = findTargetToken(msg, group);
            const root = stateRoot();
            let saved = root.tokens[token.id];
            if (!saved || saved.groupId !== groupId) {
                const representedId = token.get("represents");
                const representedForm = (group.formCharacterIds || []).includes(representedId);
                saved = {
                    groupId,
                    baseCharacterId,
                    currentForm: representedForm ? representedId : `human:${baseCharacterId}`,
                    forms: {}
                };
                saved.forms[saved.currentForm] = captureToken(token);
                root.tokens[token.id] = saved;
            }

            saved.forms[saved.currentForm] = captureToken(token);
            saved.baseCharacterId = baseCharacterId;
            const previousKey = saved.currentForm;
            const previousForm = saved.currentForm.startsWith("human:")
                ? "Human"
                : api.getObj("character", saved.currentForm)?.get("name") || "Unknown";
            const targetKey = isHuman ? `human:${baseCharacterId}` : targetCharacter.id;
            const snapshot = saved.forms[targetKey] || await defaultSnapshot(targetCharacter);
            if (!validImage(snapshot)) {
                throw new Error(`${targetCharacter.get("name")} needs a normal image or default token.`);
            }

            token.set(snapshot);
            saved.currentForm = targetKey;
            saved.forms[targetKey] = captureToken(token);
            if (previousKey !== targetKey) {
                try {
                    api.reportFormChange({
                        playerId: msg.playerid,
                        pageId: token.get("_pageid"),
                        characterId: baseCharacterId,
                        characterName: api.getObj("character", baseCharacterId)?.get("name") || "Character",
                        tokenId: token.id,
                        tokenName: token.get("name"),
                        fromForm: previousForm,
                        toForm: isHuman ? "Human" : targetCharacter.get("name")
                    });
                } catch (error) {
                    api.log(`${SCRIPT_NAME}: Could not report form change: ${error.message}`);
                }
            }
            whisper(msg.playerid, `${html(token.get("name"))} is now ${html(targetCharacter.get("name"))}.`);
            return token;
        }

        function help(playerId) {
            whisper(playerId,
                "<b>WildShape Next help</b><br>"
                + "Show this help: <code>!wildshape help</code><br>"
                + "GM setup: <code>!wildshape setup --folder \"Tylen\" --base \"Tylen\"</code><br>"
                + "GM sync: <code>!wildshape sync --group tylen</code><br>"
                + "GM refresh (same as sync): <code>!wildshape refresh Tylen</code><br>"
                + "Use the Human and animal buttons on the character sheet to change form.<br>"
                + "After setup or sync, close and reopen the character sheet to see newly added buttons."
            );
        }

        async function handleChat(msg) {
            if (msg.type !== "api" || !msg.content.startsWith("!wildshape")) {
                return;
            }

            const { command, options, args } = parseCommand(msg.content);
            try {
                if (command === "help") {
                    help(msg.playerid);
                    return;
                }
                if (command === "setup") {
                    if (!api.playerIsGM(msg.playerid)) {
                        throw new Error("Only the GM can change setup.");
                    }
                    const folder = options.folder;
                    const bases = [].concat(options.base || []).filter(Boolean);
                    if (!folder || !bases.length) {
                        throw new Error("Setup needs --folder and at least one --base.");
                    }
                    const result = setupGroup(folder, bases, options.group);
                    syncFeedback(msg.playerid, result.group, result.forms, result.group.folder);
                    return;
                }
                if (command === "sync" || command === "refresh") {
                    if (!api.playerIsGM(msg.playerid)) {
                        throw new Error("Only the GM can refresh setup.");
                    }
                    const requestedGroup = options.group || args[0];
                    if (!requestedGroup) {
                        throw new Error("Refresh needs a folder or group name.");
                    }
                    const groupId = slug(requestedGroup);
                    const forms = syncGroup(groupId);
                    syncFeedback(msg.playerid, stateRoot().groups[groupId], forms, requestedGroup);
                    return;
                }
                if (command === "shift") {
                    if (!options.group || !options.form || !options.base) {
                        throw new Error("This form button is incomplete. Ask the GM to run sync.");
                    }
                    await shift(msg, options.group, options.form, options.base);
                    return;
                }
                help(msg.playerid);
            } catch (error) {
                whisper(msg.playerid, `<b>WildShape:</b> ${html(error.message)}`);
            }
        }

        let syncTimer;
        function scheduleSync() {
            if (syncTimer) {
                return;
            }
            syncTimer = api.setTimeout(() => {
                syncTimer = null;
                syncAll();
            }, 250);
        }

        function start() {
            stateRoot();
            api.on("ready", () => {
                syncAll();
                api.log(`${SCRIPT_NAME} v${VERSION} ready`);
            });
            api.on("chat:message", handleChat);
            api.on("change:campaign:journalfolder", scheduleSync);
            api.on("add:character", scheduleSync);
            api.on("destroy:character", scheduleSync);
            api.on("change:character:name", scheduleSync);
            api.on("destroy:graphic", (token) => {
                delete stateRoot().tokens[token.id];
            });
        }

        return {
            characterForms,
            findFolder,
            handleChat,
            parseCommand,
            setupGroup,
            shift,
            start,
            stateRoot,
            syncGroup
        };
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { createWildShapeMod };
    } else {
        createWildShapeMod({
            Campaign,
            createObj,
            findObjs,
            getObj,
            log,
            on,
            playerIsGM,
            reportFormChange: function (change) {
                if (typeof AICoGMTelemetry !== "undefined"
                    && AICoGMTelemetry
                    && typeof AICoGMTelemetry.formChanged === "function") {
                    AICoGMTelemetry.formChanged(change);
                }
            },
            sendChat,
            setTimeout,
            state
        }).start();
    }
}());
