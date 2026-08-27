# WildShape Next for Roll20

WildShape Next gives a character simple form buttons.

The animal characters in one Journal folder are the list of forms. Add a
character to the folder, then sync, and its button appears. Remove it, then
sync, and its button goes away.

The Mod changes the token only. It does not rewrite either character sheet.
This makes it safer to use with both the 2014 and 2024 D&D sheets.

## Tylen setup

The live game uses:

- Journal folder: `Tylen`
- Base characters: `Tylen` and `Tylen 2024`
- Animal copies: `Boar`, `Giant Constrictor Snake`, `Spider`, and `Wolf`

The source characters named `Tylen - Animal` stay outside the folder.

After adding `src/wildshape.js` in Roll20's Mod Scripts page, run this once in
chat as the GM:

```text
!wildshape setup --folder "Tylen" --base "Tylen" --base "Tylen 2024"
```

This adds these character Abilities:

- Human
- Boar
- Giant Constrictor Snake
- Spider
- Wolf

They also appear as token actions when the character's token is selected.

When the folder changes, the Mod tries to sync on its own. The GM can also run:

```text
!wildshape sync --group tylen
```

## Safe behaviour

- Only the GM or a player who controls the token can change it.
- The old WildShape script can stay enabled while this is tested.
- The command is `!wildshape`, so it does not clash with the old `!ws` command.
- Health bars are remembered separately for Human and each animal form.
- Current and older Roll20 lighting fields are copied from each default token.

## Test

```bash
npm test
```
