/*
 * WildShape Next
 *
 * The Journal folder is the list of animal forms.
 * The Mod adds matching buttons to each base character.
 * It changes tokens and keeps animal sheet control in step with the base sheet.
 * D&D 2024 druids share their main sheet's health with their animal sheets.
 */
(function () {
    "use strict";

    const SCRIPT_NAME = "WildShape Next";
    const VERSION = "0.7.0";
    const STATE_KEY = "WildShapeNext";
    const ABILITY_MARKER = "Managed by WildShape Next";
    const SCORES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
    const SKILLS = {
        athletics: "strength", acrobatics: "dexterity", sleight_of_hand: "dexterity",
        stealth: "dexterity", arcana: "intelligence", history: "intelligence",
        investigation: "intelligence", nature: "intelligence", religion: "intelligence",
        animal_handling: "wisdom", insight: "wisdom", medicine: "wisdom",
        perception: "wisdom", survival: "wisdom", deception: "charisma",
        intimidation: "charisma", performance: "charisma", persuasion: "charisma"
    };

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
            getComputed: env.getComputed,
            setComputed: env.setComputed,
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
            root.beasts = root.beasts || {};
            root.formOwners = root.formOwners || {};
            return root;
        }

        const queues = new Map();
        function queued(baseId, work) {
            const next = (queues.get(baseId) || Promise.resolve()).catch(() => {}).then(work);
            queues.set(baseId, next);
            return next.finally(() => {
                if (queues.get(baseId) === next) queues.delete(baseId);
            });
        }

        function is2024(characterId) {
            return api.getObj("character", characterId)?.get("charactersheetname") === "dnd2024byroll20";
        }

        function attribute(characterId, name) {
            return api.findObjs({ _type: "attribute", _characterid: characterId, name })[0];
        }

        function setAttribute(characterId, name, current, max) {
            const values = { current };
            if (max !== undefined) values.max = max;
            const existing = attribute(characterId, name);
            if (existing) {
                if (Object.keys(values).some((key) => String(existing.get(key)) !== String(values[key]))) {
                    existing.set(values);
                }
                return existing.id;
            }
            return api.createObj("attribute", { _characterid: characterId, name, ...values }).id;
        }

        function number(value, label) {
            const scalar = value && typeof value === "object" ? value.current : value;
            if (scalar === null || scalar === undefined || scalar === "" || !Number.isFinite(Number(scalar))) {
                throw new Error(`Cannot read ${label}. No form change was made.`);
            }
            return Number(scalar);
        }

        function modifier(score) {
            return Math.floor((score - 10) / 2);
        }

        async function sheetNumber(characterId, name, kind = "current") {
            if (!api.getComputed || !api.setComputed) {
                throw new Error("D&D 2024 needs Roll20 Mod sandbox v1.5 and its sheet functions.");
            }
            // Use the Beacon field explicitly: getSheetItem can pick a stale
            // legacy attribute with the same name in a mixed-sheet campaign.
            const value = await api.getComputed({ characterId, property: name });
            return number(value && typeof value === "object" ? value[kind] : value, name);
        }

        // Read metadata only. Never write Beacon's store: resource setters in the
        // current sheet can rewrite relationships and lose a resource's bonuses.
        function druidMetadata(baseId) {
            let data = attribute(baseId, "store")?.get("current");
            if (typeof data === "string") data = JSON.parse(data);
            if (!data?.integrants?.integrants) {
                throw new Error("Open the main 2024 sheet, then try again. Its class data is not available.");
            }
            const entries = Object.values(data.integrants.integrants).filter((entry) => entry._enabled !== false);
            const levels = entries.filter((entry) => entry.type === "Class Level" && entry.name === "Druid");
            const level = Math.max(0, ...levels.map((entry) => Number(entry.level)));
            if (!Number.isInteger(level) || level < 2 || level > 20) {
                throw new Error("Cannot find a valid Druid level on the main sheet.");
            }
            return {
                level,
                moon: entries.some((entry) => entry.type === "Subclass" && entry.name === "Circle of the Moon"),
                primalStrike: entries.some((entry) => entry.type === "Effect" && entry.name === "Primal Strike"),
                languages: entries.filter((entry) => entry.type === "Language").map((entry) => entry.name).join(", "),
                creatureType: data.character?.creatureType || "Humanoid",
                features: entries.filter((entry) => entry.type === "Features" && entry.source !== "Species")
                    .map((entry) => entry.name)
            };
        }

        async function druidProfile(baseId) {
            const profile = { ...druidMetadata(baseId), scores: {}, saves: {}, skills: {} };
            profile.pb = await sheetNumber(baseId, "pb");
            await Promise.all(SCORES.map(async (score) => {
                profile.scores[score] = await sheetNumber(baseId, score);
                profile.saves[score] = await sheetNumber(baseId, `${score}_save_prof`);
            }));
            await Promise.all(Object.keys(SKILLS).map(async (skill) => {
                const [trained, type, flat] = await Promise.all([
                    sheetNumber(baseId, `${skill}_prof`), sheetNumber(baseId, `${skill}_type`),
                    sheetNumber(baseId, `${skill}_flat`)
                ]);
                profile.skills[skill] = { trained, type, flat };
            }));
            return profile;
        }

        function legacyBeastStats(formId) {
            // Old WildShape may already have replaced the animal's mental stats
            // and skills. Read its original cache, never the old PC's bonuses.
            const name = String(api.getObj("character", formId).get("name")).replace(/\s*-\s*/g, "-").toLowerCase();
            const shapes = Object.values(api.state.WILDSHAPE?.shifters || {})
                .flatMap((shifter) => Object.values(shifter.shapes || {}));
            const exact = shapes.filter((shape) => shape.ID === formId);
            const matches = exact.length ? exact : shapes.filter((shape) =>
                String(shape.character || "").replace(/\s*-\s*/g, "-").toLowerCase() === name);
            if (matches.length > 1) throw new Error(`More than one old animal cache matches ${name}. Ask the GM to check it.`);
            return matches[0]?.stats_cache;
        }

        function beastStats(formId) {
            if (is2024(formId) || String(attribute(formId, "npc")?.get("current")) !== "1") {
                throw new Error("Animal forms must use the D&D 2014 monster sheet. The main PC can use 2024. "
                    + "Roll20 does not expose writable 2024 monster skills and saves.");
            }
            const cache = stateRoot().beasts;
            if (!cache[formId]) {
                const read = (name) => attribute(formId, name)?.get("current");
                const legacy = legacyBeastStats(formId);
                const scores = Object.fromEntries(SCORES.map((score) => [score, number(legacy ? legacy.stats?.[score] : read(score), score)]));
                const skills = Object.fromEntries(Object.keys(SKILLS).map((skill) => [skill, legacy ? legacy.skills?.[skill] : read(`npc_${skill}`)]));
                const saves = Object.fromEntries(SCORES.map((score) => [score, legacy ? legacy.saves?.[score] : read(`npc_${score.slice(0, 3)}_save`)]));
                const challenge = String(read("npc_challenge") || "0");
                const cr = challenge.includes("/") ? 0 : number(challenge, "animal challenge rating");
                cache[formId] = {
                    scores, skills, saves, ac: number(read("npc_ac"), "animal AC"),
                    pb: Math.max(2, 2 + Math.floor((cr - 1) / 4)),
                    type: String(read("npc_type") || ""), senses: String(read("npc_senses") || "")
                };
                if (legacy) api.log(`${SCRIPT_NAME}: Recovered original animal stats for ${api.getObj("character", formId).get("name")} from old WildShape.`);
            }
            return cache[formId];
        }

        function formRoll(beastTotal, beastScore, formScore, trained, multiplier, flat, profile, beast) {
            const original = beastTotal === "" || beastTotal === undefined ? modifier(beastScore) : Number(beastTotal);
            if (!Number.isFinite(original)) throw new Error("The animal has a non-numeric skill or save bonus.");
            const beastTraining = Math.max(0, original - modifier(beastScore));
            const beastMultiplier = beastTraining >= 2 * beast.pb ? 2 : beastTraining > 0 ? 1 : 0;
            const training = Math.max(trained ? multiplier : 0, beastMultiplier) * profile.pb;
            return Math.max(original, modifier(formScore) + training + flat);
        }

        function applyFormStats(group, baseId, form, profile) {
            const owner = stateRoot().formOwners[form.id];
            if (owner && owner !== baseId) {
                throw new Error("Each 2024 PC needs their own animal copies. This animal already belongs to another PC.");
            }
            const beast = beastStats(form.id);
            const scores = { ...beast.scores };
            ["intelligence", "wisdom", "charisma"].forEach((score) => { scores[score] = profile.scores[score]; });
            const wisdom = modifier(profile.scores.wisdom);
            SCORES.forEach((score) => {
                setAttribute(form.id, score, scores[score]);
                setAttribute(form.id, `${score}_base`, scores[score]);
                setAttribute(form.id, `${score}_mod`, modifier(scores[score]));
                let total = formRoll(beast.saves[score], beast.scores[score], scores[score],
                    profile.saves[score], 1, 0, profile, beast);
                if (score === "constitution" && profile.moon && profile.level >= 6) total += wisdom;
                const key = `npc_${score.slice(0, 3)}_save`;
                setAttribute(form.id, key, total);
                setAttribute(form.id, `${key}_base`, String(total));
                setAttribute(form.id, `${key}_flag`, 1);
            });
            Object.entries(SKILLS).forEach(([skill, score]) => {
                const own = profile.skills[skill];
                const total = formRoll(beast.skills[skill], beast.scores[score], scores[score],
                    own.trained, own.type, own.flat, profile, beast);
                setAttribute(form.id, `npc_${skill}`, total);
                setAttribute(form.id, `npc_${skill}_base`, String(total));
                setAttribute(form.id, `npc_${skill}_flag`, 1);
            });
            setAttribute(form.id, "npc_saving_flag", 1);
            setAttribute(form.id, "npc_skills_flag", 1);
            setAttribute(form.id, "npc_name", form.get("name"));
            setAttribute(form.id, "npc_ac", profile.moon ? Math.max(beast.ac, 13 + wisdom) : beast.ac);
            setAttribute(form.id, "npc_languages", profile.languages);
            setAttribute(form.id, "npc_type", beast.type.replace(/\bbeast\b/i, profile.creatureType));
            const passive = 10 + Number(attribute(form.id, "npc_perception").get("current"));
            setAttribute(form.id, "npc_senses", /passive perception\s+\d+/i.test(beast.senses)
                ? beast.senses.replace(/passive perception\s+\d+/i, `passive Perception ${passive}`)
                : `${beast.senses}${beast.senses ? ", " : ""}passive Perception ${passive}`);
            const base = api.getObj("character", baseId);
            const notes = [
                `This is ${base.get("name")}'s 2024 Wild Shape. HP and temporary HP are shared with the main sheet.`,
                "Track Wild Shape uses, spell slots, Hit Dice, conditions and concentration on the main sheet. "
                    + "Do not press Enter or Leave Wild Shape there as well as a form button; do not grant temporary HP twice.",
                `Retained features and feats: ${Array.from(new Set(profile.features)).join(", ")}. `
                    + "Use their rules on the main sheet; this note does not automate their effects."
            ];
            if (profile.moon) notes.push("Circle of the Moon spells can be cast from the main sheet while shifted.");
            if (profile.moon && profile.level >= 6) notes.push(`Attacks may deal Radiant damage. Constitution saves already include Wisdom (${wisdom >= 0 ? "+" : ""}${wisdom}).`);
            if (profile.primalStrike) notes.push(`Primal Strike: once on each of your turns, add ${profile.level >= 15 ? "2d8" : "1d8"} Cold, Fire, Lightning or Thunder damage to a hit. Apply it manually.`);
            setAttribute(form.id, "repeating_npctrait_wildshapenext_name", "Wild Shape — retained features");
            setAttribute(form.id, "repeating_npctrait_wildshapenext_description", notes.join("\n\n"));
            stateRoot().formOwners[form.id] = baseId;
            syncAbilities(group, form.id, group.formCharacterIds.map((id) => api.getObj("character", id)), baseId);
        }

        async function readHealth(baseId) {
            const [hp, max, temp] = await Promise.all([
                sheetNumber(baseId, "hp", "current"), sheetNumber(baseId, "hp", "max"), sheetNumber(baseId, "hp_temp")
            ]);
            return { hp: Math.max(0, hp), max, temp: Math.max(0, temp) };
        }

        function healthBars(characterId, health) {
            if (is2024(characterId)) {
                return { bar1_link: "hp", bar1_value: health.hp, bar1_max: health.max,
                    bar2_link: "ac", bar2_value: health.ac, bar2_max: "",
                    bar3_link: "hp_temp", bar3_value: health.temp, bar3_max: "" };
            }
            return {
                bar1_link: setAttribute(characterId, "hp", health.hp, health.max),
                bar1_value: health.hp, bar1_max: health.max,
                bar2_link: attribute(characterId, "npc_ac")?.id || "",
                bar2_value: attribute(characterId, "npc_ac")?.get("current") || "", bar2_max: "",
                bar3_link: setAttribute(characterId, "hp_temp", health.temp), bar3_value: health.temp, bar3_max: ""
            };
        }

        async function shareHealth(baseId, changes = {}) {
            const health = { ...await readHealth(baseId), ...changes };
            health.ac = await sheetNumber(baseId, "ac");
            if (changes.hp !== undefined) await api.setComputed({ characterId: baseId, property: "hp_current", args: [Math.max(0, health.hp)] });
            if (changes.temp !== undefined) await api.setComputed({ characterId: baseId, property: "hp_temp", args: [Math.max(0, health.temp)] });
            health.hp = Math.max(0, health.hp);
            health.temp = Math.max(0, health.temp);
            const forms = Object.entries(stateRoot().formOwners).filter(([, owner]) => owner === baseId)
                .map(([id]) => id).filter((id) => api.getObj("character", id));
            forms.forEach((id) => healthBars(id, health));
            api.findObjs({ _type: "graphic", _subtype: "token" }).forEach((token) => {
                const id = token.get("represents");
                if (id === baseId || forms.includes(id)) token.set(healthBars(id, health));
            });
            return health;
        }

        async function syncStats2024(groupId) {
            const group = stateRoot().groups[groupId];
            const bases = group.baseCharacterIds.filter(is2024);
            if (!bases.length) return;
            if (group.baseCharacterIds.length !== 1) {
                throw new Error("A 2024 group needs one main character so health is not shared between different PCs.");
            }
            const baseId = bases[0];
            return queued(baseId, async () => {
                const forms = group.formCharacterIds.map((id) => api.getObj("character", id));
                forms.forEach((form) => {
                    if (stateRoot().formOwners[form.id] && stateRoot().formOwners[form.id] !== baseId) {
                        throw new Error("Each 2024 PC needs their own animal copies. This animal already belongs to another PC.");
                    }
                    beastStats(form.id);
                });
                const profile = await druidProfile(baseId);
                forms.forEach((form) => applyFormStats(group, baseId, form, profile));
                await shareHealth(baseId);
                return profile;
            });
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

        function groupCharacterName(group) {
            const folder = findFolder(group.folder);
            return String(folder ? folder.n : group.folder.split("/").pop()).trim();
        }

        function formName(group, form) {
            const characterName = String(form.get("name") || "").trim();
            const ownerName = groupCharacterName(group);
            const hyphen = characterName.indexOf("-");
            const prefixed = hyphen !== -1
                && characterName.slice(0, hyphen).trim().toLowerCase() === ownerName.toLowerCase();
            return prefixed ? characterName.slice(hyphen + 1).trim() : characterName;
        }

        function syncFormNames(group, forms) {
            const ownerName = groupCharacterName(group);

            forms.forEach((form) => {
                const wantedName = `${ownerName}-${formName(group, form)}`;
                if (form.get("name") !== wantedName) {
                    form.set("name", wantedName);
                }
            });
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
                    name: formName(group, form),
                    action: `!wildshape shift --group ${group.id} --form ${form.id} --base ${baseCharacterId}`
                });
            });

            return rows;
        }

        function syncAbilities(group, baseCharacterId, forms, ownerId = baseCharacterId) {
            const desired = desiredAbilities(group, ownerId, forms);
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

        function baseControllers(group) {
            const playerIds = new Set();

            group.baseCharacterIds.forEach((characterId) => {
                const character = api.getObj("character", characterId);
                String(character.get("controlledby") || "")
                    .split(",")
                    .map((playerId) => playerId.trim())
                    .filter(Boolean)
                    .forEach((playerId) => playerIds.add(playerId));
            });

            return playerIds.has("all") ? "all" : Array.from(playerIds).join(",");
        }

        function syncFormControllers(group, forms) {
            if (!group.baseCharacterIds.length) {
                return;
            }

            const controlledby = baseControllers(group);
            forms.forEach((form) => {
                if (String(form.get("controlledby") || "") !== controlledby) {
                    form.set("controlledby", controlledby);
                }
            });
        }

        function syncGroup(groupId) {
            const group = stateRoot().groups[groupId];
            if (!group) {
                throw new Error(`Unknown group ${groupId}.`);
            }

            const forms = characterForms(group.folder).filter((form) => !group.baseCharacterIds.includes(form.id));
            const removed = (group.formCharacterIds || []).filter((id) => !forms.some((form) => form.id === id));
            removeManagedAbilities(removed, groupId);
            removed.forEach((id) => { delete stateRoot().formOwners[id]; });
            syncFormNames(group, forms);
            group.formCharacterIds = forms.map((form) => form.id);
            group.baseCharacterIds = group.baseCharacterIds.filter((id) => api.getObj("character", id));
            syncFormControllers(group, forms);
            group.baseCharacterIds.forEach((baseCharacterId) => syncAbilities(group, baseCharacterId, forms));
            return forms;
        }

        async function syncAll() {
            for (const groupId of Object.keys(stateRoot().groups)) {
                try {
                    syncGroup(groupId);
                    await syncStats2024(groupId);
                } catch (error) {
                    api.log(`${SCRIPT_NAME}: ${error.message}`);
                }
            }
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
            if (nextBaseIds.some(is2024) && nextBaseIds.length !== 1) {
                throw new Error("A 2024 group needs one main character so health is not shared between different PCs.");
            }
            if (previous) {
                removeManagedAbilities(
                    previous.baseCharacterIds.filter((characterId) => !nextBaseIds.includes(characterId)),
                    id
                );
                if (previous.baseCharacterIds.join(",") !== nextBaseIds.join(",")) {
                    previous.formCharacterIds.forEach((formId) => { delete root.formOwners[formId]; });
                }
            }

            root.groups[id] = {
                id,
                folder: folderName,
                baseCharacterIds: nextBaseIds,
                formCharacterIds: previous?.formCharacterIds || []
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
                    `WildShape buttons and animal access were updated for <b>${sheetNames.map(html).join(", ")}</b>. `
                    + "Close and reopen the character sheet to see newly added buttons."
                );
            });

            return sheetsByPlayer.size;
        }

        function syncFeedback(playerId, group, forms, requestedGroup) {
            const notified = notifyCharacterControllers(group, playerId);
            whisper(playerId,
                `The ${html(requestedGroup)} buttons and player access now match ${forms.length} animal form(s). `
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

        function shift(msg, groupId, formId, baseCharacterId) {
            return queued(baseCharacterId, () => shiftNow(msg, groupId, formId, baseCharacterId));
        }

        async function shiftNow(msg, groupId, formId, baseCharacterId) {
            const group = stateRoot().groups[groupId];
            if (!group) {
                throw new Error(`Unknown group ${groupId}.`);
            }
            if (!group.baseCharacterIds.includes(baseCharacterId)) {
                throw new Error("That base character is not in this group.");
            }
            const rules2024 = is2024(baseCharacterId);
            if (rules2024 && group.baseCharacterIds.length !== 1) {
                throw new Error("A 2024 group needs one main character so health is not shared between different PCs.");
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
            const previousCharacter = api.getObj("character", saved.currentForm);
            const previousForm = saved.currentForm.startsWith("human:")
                ? "Human"
                : previousCharacter ? formName(group, previousCharacter) : "Unknown";
            const targetKey = isHuman ? `human:${baseCharacterId}` : targetCharacter.id;
            const snapshot = { ...saved.forms[targetKey] || await defaultSnapshot(targetCharacter) };
            snapshot.name = targetCharacter.get("name");
            snapshot.represents = targetCharacter.id;
            if (!validImage(snapshot)) {
                throw new Error(`${targetCharacter.get("name")} needs a normal image or default token.`);
            }

            let previousTemp;
            if (rules2024) {
                const profile = await druidProfile(baseCharacterId);
                if (!isHuman) applyFormStats(group, baseCharacterId, targetCharacter, profile);
                const health = await readHealth(baseCharacterId);
                const temp = !isHuman && previousKey !== targetKey
                    ? Math.max(health.temp, profile.level * (profile.moon ? 3 : 1)) : health.temp;
                previousTemp = health.temp;
                const shared = await shareHealth(baseCharacterId, temp !== health.temp ? { temp } : {});
                Object.assign(snapshot, healthBars(targetCharacter.id, shared));
            }
            try {
                token.set(snapshot);
            } catch (error) {
                if (rules2024) await shareHealth(baseCharacterId, { temp: previousTemp });
                throw error;
            }
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
                        toForm: isHuman ? "Human" : formName(group, targetCharacter)
                    });
                } catch (error) {
                    api.log(`${SCRIPT_NAME}: Could not report form change: ${error.message}`);
                }
            }
            whisper(msg.playerid, `${html(token.get("name"))} is now ${html(targetCharacter.get("name"))}.`
                + (rules2024 && !isHuman && previousKey !== targetKey
                    ? " Spend one Wild Shape use by hand on your main sheet. Temporary HP is already set; do not add it again."
                    : ""));
            return token;
        }

        async function changeHealth(msg, groupId, amount, damage) {
            const group = stateRoot().groups[groupId];
            if (!group || group.baseCharacterIds.length !== 1 || !is2024(group.baseCharacterIds[0])) {
                throw new Error("Damage and heal need a group with one 2024 main character.");
            }
            findTargetToken(msg, group);
            const value = number(amount, "damage or healing amount");
            if (!Number.isInteger(value) || value < 0) throw new Error("Use a whole number of 0 or more.");
            const baseId = group.baseCharacterIds[0];
            await queued(baseId, async () => {
                const health = await readHealth(baseId);
                const updated = await shareHealth(baseId, damage
                    ? { temp: Math.max(0, health.temp - value), hp: Math.max(0, health.hp - Math.max(0, value - health.temp)) }
                    : { hp: Math.min(health.max, health.hp + value) });
                whisper(msg.playerid, `HP: ${updated.hp}/${updated.max}. Temporary HP: ${updated.temp}. `
                    + "Handle concentration checks and other effects on the main sheet.");
            });
        }

        function healthAttributeChanged(attr, previous) {
            const characterId = attr.get("_characterid");
            const name = attr.get("name");
            const owner = stateRoot().formOwners[characterId];
            const main = Object.values(stateRoot().groups).some((group) => group.baseCharacterIds.includes(characterId))
                && is2024(characterId);
            if (!(owner && ["hp", "hp_temp"].includes(name))
                && !(main && ["store", "updateId"].includes(name))) return;
            const changed = String(attr.get("current")) !== String(previous.current);
            const current = attr.get("current");
            return queued(owner || characterId, () => shareHealth(owner || characterId,
                owner && changed ? { [name === "hp" ? "hp" : "temp"]: number(current, name) } : {}))
                .catch((error) => api.log(`${SCRIPT_NAME}: Health sync failed: ${error.message}`));
        }

        function help(playerId) {
            whisper(playerId,
                "<b>WildShape Next help</b><br>"
                + "Show this help: <code>!wildshape help</code><br>"
                + "GM setup: <code>!wildshape setup --folder \"Tylen\" --base \"Tylen\"</code><br>"
                + "GM sync: <code>!wildshape sync --group tylen</code><br>"
                + "GM refresh (same as sync): <code>!wildshape refresh Tylen</code><br>"
                + "2024 damage (uses temporary HP first): <code>!wildshape damage Tylen 10</code><br>"
                + "2024 heal: <code>!wildshape heal Tylen 10</code><br>"
                + "Sync also gives each animal the same controllers as the base character.<br>"
                + "Use the Human and animal buttons on the character sheet to change form.<br>"
                + "2024 bars: 1 = shared HP, 2 = AC, 3 = temporary HP. Direct bar edits set the number; they do not apply damage rules.<br>"
                + "Track Wild Shape uses, spell slots, Hit Dice, conditions and concentration on the main sheet. "
                + "Each new animal shift needs one use spent by hand. Do not also use the main sheet's Enter/Leave Wild Shape buttons.<br>"
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
                    await syncStats2024(result.group.id);
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
                    await syncStats2024(groupId);
                    syncFeedback(msg.playerid, stateRoot().groups[groupId], forms, requestedGroup);
                    return;
                }
                if (command === "shift") {
                    if (!options.group || !options.form || !options.base) {
                        throw new Error("This form button is incomplete. Ask the GM to run sync.");
                    }
                    await shift(msg, slug(options.group), options.form, options.base);
                    return;
                }
                if (command === "damage" || command === "heal") {
                    if (args.length !== 2) throw new Error(`Use !wildshape ${command} Tylen 10.`);
                    await changeHealth(msg, slug(args[0]), args[1], command === "damage");
                    return;
                }
                help(msg.playerid);
            } catch (error) {
                whisper(msg.playerid, `<b>WildShape:</b> ${html(error.message)}`);
            }
        }

        let syncTimer;
        let ready = false;
        function scheduleSync() {
            if (!ready || syncTimer) {
                return;
            }
            syncTimer = api.setTimeout(() => {
                syncTimer = null;
                syncAll();
            }, 250);
        }

        function start() {
            stateRoot();
            api.on("ready", async () => {
                ready = true;
                await syncAll();
                api.log(`${SCRIPT_NAME} v${VERSION} ready`);
            });
            api.on("chat:message", handleChat);
            api.on("change:campaign:journalfolder", scheduleSync);
            api.on("add:character", scheduleSync);
            api.on("destroy:character", scheduleSync);
            api.on("change:character:name", scheduleSync);
            api.on("change:attribute", healthAttributeChanged);
            api.on("add:graphic", (token) => {
                if (!ready) return;
                const id = token.get("represents");
                const owner = stateRoot().formOwners[id];
                const main = Object.values(stateRoot().groups).some((group) => group.baseCharacterIds.includes(id)) && is2024(id);
                if (owner || main) {
                    return queued(owner || id, () => shareHealth(owner || id))
                        .catch((error) => api.log(`${SCRIPT_NAME}: Health sync failed: ${error.message}`));
                }
            });
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
            syncGroup,
            syncStats2024
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
            getComputed: typeof getComputed === "function" ? getComputed : undefined,
            setComputed: typeof setComputed === "function" ? setComputed : undefined,
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
