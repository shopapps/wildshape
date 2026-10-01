# WildShape Next for Roll20

WildShape Next gives a character simple form buttons.

The animal characters in one Journal folder are the list of forms. Add a
character to the folder, then sync, and its button appears. Remove it, then
sync, and its button goes away.

The Mod changes the token and keeps each animal's player control in step with
the base character. For a 2024 Druid, it also carries the retained stats and
shares health with the main sheet. It works with the
Roll20 D&D 2024 sheet and its **Advanced Tools > Character Macros** list.

When AI Co-GM Telemetry is installed, each successful form change is also sent
to the campaign dashboard's **Latest** activity list.

## Tylen setup

The live game currently uses:

- Journal folder: `Tylen`
- Base character: `Tylen` (the D&D 2024 sheet)
- Animal copies: `Tylen-Boar`, `Tylen-Giant Constrictor Snake`,
  `Tylen-Spider`, and `Tylen-Wolf`

The source characters named `Tylen - Animal` stay outside the folder.

Use Roll20 Mod sandbox **v1.5** (or later with `getComputed` and `setComputed`).
The main PC uses the **D&D 2024** sheet. The animal copies currently need the
**D&D 2014 monster** sheet, as used by Tylen's existing animals. Roll20 does not
yet let this Mod write the 2024 monster sheet's skills and saves.

To update, replace the contents of the existing **WildShapeNext.js** Mod with
`src/wildshape.js`, then **Save Mod Script**. Do not add a second copy. Existing
groups are kept and refreshed when the Mod starts.

After first adding `src/wildshape.js` in Roll20's Mod Scripts page, run this once in
chat as the GM:

```text
!wildshape setup --folder "Tylen" --base "Tylen"
```

This adds these Character Macros:

- Human
- Boar
- Giant Constrictor Snake
- Spider
- Wolf

They appear under **Advanced Tools > Character Macros**. They also appear as
token actions when the character's token is selected.

Sync gives each animal sheet a player-specific name. The `Tylen` folder name
is used as the prefix, so `Wolf` and `Tylen - Wolf` both become `Tylen-Wolf`.
The button still says `Wolf`.

When the folder changes, the Mod tries to sync on its own. The GM can also run:

```text
!wildshape refresh Tylen
```

The older command still works too:

```text
!wildshape sync --group tylen
```

This scans the `Tylen` folder again. It adds new form buttons and removes form
buttons whose characters are no longer in the folder. It also gives every
animal in the folder the same **Can Be Edited & Controlled By** players as the
base character, and fixes the player-specific animal sheet names. A 2024 group
must have just **one** main PC. Different PCs must have their own animal copies.
The older, token-only 2014 setup can still join several base characters.

Roll20 may keep an open character sheet showing its old button list. Close and
reopen the sheet after syncing to see newly added buttons. The Mod privately
sends this reminder to the GM and to each player who controls the character.

For a list of commands, run:

```text
!wildshape help
```

The command starts with `!wildshape`, not `!ws`, because the older WildShape
Mod already uses `!ws`.

## D&D 2024 stats and health

On sync and when entering an animal form, the Mod uses the main Druid's:

- Intelligence, Wisdom and Charisma.
- Skill and saving throw proficiencies, and proficiency bonus. It keeps a
  higher bonus from the animal's original stat block. Expertise and the sheet's
  flat skill bonuses are included.
- Languages and creature type (Humanoid if the sheet leaves its type blank).
  Check this type for non-Humanoid PCs.
- Current, maximum and temporary HP. Forms do not have separate pools of HP.

The animal keeps its Strength, Dexterity, Constitution, size, speed, senses,
attacks and other traits. The Mod saves its original stats once, so repeated
syncs do not stack bonuses. For animals from Angelo's old WildShape Mod, it
first checks that Mod's original stat cache. It matches the character ID or
one exact name, ignoring spaces around the hyphen. The old cache and source
characters outside the folder are not changed. Use a fresh animal copy if you
want to replace an animal's saved base stats.
Use a clean beast stat block when making new copies: if the old template or
its old cache already contains another PC's skill bonuses, those can look like
beast proficiencies. The Mod cannot safely guess which custom bonuses to remove.

For **Circle of the Moon**, AC is the higher of animal AC and `13 + Wisdom`.
At Druid level 6+, Constitution saves also include Wisdom. A note on the animal
sheet lists retained features, Circle spells, the Radiant damage choice and
Primal Strike where present. These notes do not automate spellcasting, damage
choices, feats, item effects, advantage or other special rules. Check those
on the main sheet when making the roll.

Each **new** animal shift grants temporary HP equal to Druid level, or three
times Druid level for Circle of the Moon. A higher existing amount is kept.
Clicking the current form does not refill it. Sync and Human do not grant it.
Returning to Human keeps remaining temporary HP and does not heal the PC.

The bars are **1: HP, 2: AC, 3: temporary HP**. Ordinary edits to the animal's
linked HP or temporary HP also update the main sheet and the other forms.
Edits to the main sheet update the forms. The main sheet owns maximum HP.

To apply damage through temporary HP first, select the token and run:

```text
!wildshape damage Tylen 10
!wildshape heal Tylen 10
```

Use the final damage amount after resistance or vulnerability. Healing is
capped at maximum HP and does not restore temporary HP. These commands do not
make concentration checks or handle death saves. Direct bar edits simply set
the number; subtracting from bar 1 does **not** spend temporary HP first.

Other Mods may change health without sending a change event. For this setup,
use these commands or normal sheet/bar edits, not another damage Mod while
shifted. There is no tested link to ApplyDamage or other third-party damage
scripts.

### Keep these on the main sheet

- **Wild Shape uses:** spend one by hand for each new animal shift, including
  animal-to-animal changes. The chat reply reminds you. The Mod does not check
  or spend uses. Returning to Human costs no use.
- Spell slots, Hit Dice, class/feat uses, conditions, concentration and death
  saves remain on the main sheet. Cast allowed spells from there.
- Do not also click the 2024 sheet's built-in Enter/Leave Wild Shape controls.
  Do not add temporary HP a second time.
- Enforce the known-form list, CR/swim/fly limits, duration and any forced end
  of Wild Shape by hand. Press Human when the form ends.

The current Roll20 sheet's resource writer changed a resource's counter setup
during a test. Resource writes are deliberately disabled. Only the supported
current-HP and temporary-HP writers are used; class data is read, never written.
2024 fields are read and written through the explicit Beacon functions, so
stale legacy attributes with the same names cannot take their place.
If Roll20 changes its class-data layout or a required stat is missing, the Mod
reports the problem instead of guessing a Druid level or moving the token.

The token points to the named animal sheet, such as **Tylen-Wolf**. It does not
replace an already open sheet window. Alt-double-click the token to open that
animal's sheet. Human and animal buttons also appear on each animal copy.

## Safe behaviour

- Only the GM or a player who controls the token can change it.
- Each sync replaces animal control with the base character's current player
  list. Copy a new animal into the folder, run sync, then close and reopen the
  sheet.
- The old WildShape script can stay installed, but do not use its form buttons
  for a PC managed by this Mod: its 2014 health rules differ.
- The command is `!wildshape`, so it does not clash with the old `!ws` command.
- Health bars remain separate only for a legacy 2014 base character. A 2024
  Druid shares the main sheet's health across all forms.
- Current and older Roll20 lighting fields are copied from each default token.

## Test

```bash
npm test
```

Tests cover the old token-only setup, 2024 stats, old stat-cache recovery,
shared HP, Moon bonuses, temporary HP, manual resources, folder changes,
player control and failed sheet reads/writes. They run against a small Roll20
test stand-in; also check the saved Mod's output and one animal sheet in-game.

Rules: [2024 Druid](https://www.dndbeyond.com/sources/dnd/br-2024/character-classes#Level2WildShape),
[Circle of the Moon](https://roll20.net/compendium/dnd5e/Subclasses%3ACircle%20of%20the%20Moon?expansion=32231).
API: [Roll20's 2024 Mod guide](https://help.roll20.net/hc/en-us/articles/30377793782423-How-to-Update-Mod-Scripts-for-D-D-2024-Beacon).
