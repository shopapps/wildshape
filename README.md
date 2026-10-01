# WildShape Next for Roll20

WildShape Next gives a character simple form buttons.

The animal characters in one Journal folder are the list of forms. Add a
character to the folder, then sync, and its button appears. Remove it, then
sync, and its button goes away.

The Mod changes the token and keeps each animal's player control in step with
the base character. It does not rewrite character stats. It works with the
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

After adding `src/wildshape.js` in Roll20's Mod Scripts page, run this once in
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
base character, and fixes the player-specific animal sheet names. If more than
one base character is set up, their player lists are joined.

Roll20 may keep an open character sheet showing its old button list. Close and
reopen the sheet after syncing to see newly added buttons. The Mod privately
sends this reminder to the GM and to each player who controls the character.

For a list of commands, run:

```text
!wildshape help
```

The command starts with `!wildshape`, not `!ws`, because the older WildShape
Mod already uses `!ws`.

## Safe behaviour

- Only the GM or a player who controls the token can change it.
- Each sync replaces animal control with the base character's current player
  list. Copy a new animal into the folder, run sync, then close and reopen the
  sheet.
- The old WildShape script can stay enabled while this is tested.
- The command is `!wildshape`, so it does not clash with the old `!ws` command.
- Health bars are remembered separately for Human and each animal form.
- Current and older Roll20 lighting fields are copied from each default token.

## Test

```bash
npm test
```
