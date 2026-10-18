# Store listing text

Text for the Play Console (and, later, App Store Connect). Written for the Play limits: short description 80 characters, full description 4,000.

## Fields

| Field | Value |
| --- | --- |
| App name | Checkmate Prep |
| Category | Education (or Sports) |
| Tags | Chess, Board, Strategy games, Training |
| Email | `contact@checkmateprep.com` |
| Trader address (EU DSA, shown publicly) | Artware Solutions LLC, 150 Ludlow St, New York, NY 10002, USA (business address, as in the Play developer profile and on the privacy page) |
| Trader phone (shown publicly) | +1 727 753 8678 (the Play developer profile) |
| Trader email (shown publicly) | `info@artwaresolutions.org` (the Play developer profile; the listing contact above is separate) |
| Website | `https://checkmateprep.com` |
| Privacy policy | `https://checkmateprep.com/privacy` |
| Data deletion | `https://checkmateprep.com/delete-account` |

## Short description (79 characters)

```
Prep for your next chess.com opponent: openings, traps, drills and a game plan.
```

## Full description

```
Know your next opponent before the game.

Checkmate Prep helps you prepare for games against specific people on chess.com. Enter your username and the opponents you want to prepare for, and the app builds a file on each of them from their recent public games.

WHAT YOU GET

• Opponent file: ratings, your head-to-head record, how they play, and the openings where they score badly. Every number is counted from real games, and small samples say how many games they rest on.
• Trap finder: Stockfish runs on your device over the positions they reach most often, and flags moves they keep repeating that the engine refutes, with the punishing line.
• Game plan: for white and for black, which opening to play, what they usually answer, the trap to aim for, and advice on time control and the clock.
• Explore: tap through an opening and see what they, or you, played next and how it scored.
• Drills: punish their traps, play prepared lines from memory, and solve positions from your own games. The engine checks your answer, so an equally good move counts.
• You: an engine review of your own games, with blunders by phase, converting wins and the clock. Your worst moments become puzzles.
• AI game plans (optional): Claude writes a plan in plain language for each opponent. This sends both usernames and their statistics to Anthropic.

HOW IT WORKS

Games come from chess.com's public data, so you need no chess.com login and no account with us. The analysis runs on your phone, with Stockfish 19. An account is optional: it only keeps your opponents, names, drill progress and results in step across your devices, and you can delete it at any time from Settings.

The source code is public at github.com/Checkmate-Prep/chess-coach. Stockfish is GPLv3.

Checkmate Prep is an independent app. It isn't affiliated with or endorsed by Chess.com.
```

Keep the text in step with the privacy page (`app/privacy.html`): the AI line and the "no account" claims must match what the code does.

## Release notes

Play shows these to testers and users: 500 characters per language, wrapped in language tags. The release name is only for the Console (50 characters; the default is `<code> (<name>)`).

First build:

```
<en-US>
First Android build of Checkmate Prep: opening prep, traps and drills for your games against the people you play on chess.com.
</en-US>
```

Version 5, release name `5 - themed icon` (released to internal testing and open testing):

```
<en-US>
Adds a themed icon. On Android 13 and newer, with Themed icons turned on, the Checkmate Prep icon now takes your wallpaper colours.
</en-US>
```

This build changes only the icon: the app loads the website, so site updates need no release note.
