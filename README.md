# NIGHT WATCH

**One kid. One tent. Fifteen raccoons. No backup.**

A first-person campsite defense game set under the loblolly pines of East Texas, summer 1998. The pop-up camper is full, so you're in the tent, and something just opened the cooler. Grab the paintball marker and hold out until sunrise.

## Play

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production build to dist/
npm test          # unit tests (progression, rewards, night structure)
```

Runs in any modern browser with WebGL, including iPhone Safari. It's a static site, so `dist/` can be deployed anywhere (Vercel config included).

### Controls

| | Desktop | Touch |
|---|---|---|
| Aim | Mouse (click to lock) | Drag on the right side (or drag the FIRE button) |
| Move | WASD | Left-side virtual stick |
| Fire | Left click (hold for semi-auto) | FIRE |
| Reload | R | RELOAD |
| Flashlight | F | LIGHT |
| Use / zip / strap / repair | E (hold to tape) | USE (hold to tape) |
| Switch ammo | Q | AMMO |
| Hot dog / pots | G / N | 🌭 / 🔔 |
| Pause | Esc | ❚❚ |

## The night

Six encounters from 10:25 PM to 6:00 AM:

1. **The Visitor**: one raccoon at the cooler. It teaches you to aim, shoot, and lead.
2. **Company**: three raccoons from three directions.
3. **They're Back**: five raccoons, and Bandits who drag the chips into the woods.
4. **Bad News**: a Distraction bangs a tin can on one side while a Bandit raids from the other. Sneaks claw through the tent mesh, an Acrobat lands on your roof, and a Tank shows up.
5. **The Raid**: eyes in every gap between the pines, then a coordinated pincer.
6. **Big Earl**: the boss walks into your flashlight beam and rallies the crew. Hold the cooler until sunrise.

You lose if the cooler is emptied, or if your **nerve** maxes out (raccoons in the tent with you, Tanks charging you) and you bolt for the camper.

## Systems

- **Ballistics**: paintballs are real projectiles with travel time, gravity drop, drag and spread. They're sub-stepped against raccoon hit spheres, tent fabric, props, tree trunks and the ground.
- **Raccoon AI**: a per-raccoon state machine (enter, lurk, peek, investigate, sneak, approach, distract, attack, charge, steal, retreat, stunned, frozen, climb, roof, inside, escape). Raccoons use cover, react to your flashlight and to near-miss splats, fear the kid (except Tanks and the boss), get lured by lanterns, decoys and hot dogs, carry loot that they drop when hit, and come back for more. Seven archetypes: Visitor, Scout, Bandit, Sneak, Tank, Acrobat, Distraction, plus Big Earl.
- **The tent**: four zippable openings (mesh or open). Raccoons scratch through the mesh, which ripples and bulges, and torn mesh can be duct-taped. The roof dents under a climbing raccoon, and you can shoot it off through the fabric.
- **The cooler**: food meter, a lid that animates and gets left open, and a bungee strap that slows raccoons down. The food inside disappears item by item.
- **Environment**: lanterns light raccoons up but also draw them in, and they get knocked out. The radio keeps raccoons off the tent but masks their sounds. There are spare flashlight batteries, tripwires, and dropped loot to recover.
- **Audio**: everything is synthesized at load time with WebAudio. Crickets go quiet when a raccoon is near, sounds are HRTF-spatialized, and you can hear Dad snoring in the camper.
- **Progression**: 16 upgrades across Marker / Defense / Utility, saved in localStorage. Later nights add more raccoons and new archetype mixes.

## Tech

Vite + TypeScript + Three.js. No external art or audio assets: geometry, textures and sound are all procedural. The forest is instanced (a few draw calls for ~380 pines and the understory), raccoons are merged vertex-coloured meshes, and shadows are only enabled on the High graphics tier.

`window.__nw` exposes the game instance for automated testing (`simulate(dt)` steps the world deterministically).
