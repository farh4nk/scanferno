# Live test scripts

Two people, one microphone. Open the app, switch the header to **Live test**, press **Start live call**.
The dispatcher speaks first (the first voice heard is labeled Dispatch). Normal pace, one at a time, pause about a second between lines.
The transcript refreshes every few seconds, so give each answer a moment to land.

Building for these scripts: Vibe Hobby, 8866 Gulf Freeway (the default). To test another building, pick it under "Where is the fire?" on the Live test blank slate and change the address and the room numbers in the script to match its plan.

## Script A: back of the building, trapped coworker (about 1 minute)

Same call as the demo `vibe-1-clean`, so you can compare a live run with the recorded one.

| Who | Say | The briefing should show |
|---|---|---|
| Dispatcher | "Nine one one, what's the address of your emergency?" | |
| Caller | "Eighty eight sixty six Gulf Freeway, the Vibe office building by the feeder road. There's a fire on the third floor!" | Address, Fire cell: Floor 3 |
| Dispatcher | "Okay. Where on the third floor?" | |
| Caller | "The back of the building, in the truck driving school suite. Black smoke is pouring out of the windows." | Fire side C, black smoke, fire rooms hatched |
| Dispatcher | "Is anyone still inside?" | |
| Caller | "My coworker went back for her laptop. She's in the break room, the little kitchen at the end of the hall." | Trapped: Kitchen 106, Way out about 8 m |
| Dispatcher | "Do you know of any hazards? Gas, chemicals?" | |
| Caller | "The driving school keeps oxygen tanks for their first aid class, in the back." | Watch: O2 cylinders |
| Dispatcher | "Where are you right now?" | |
| Caller | "I'm outside, in the front parking lot." | Caller location |

## Script B: law office fire, right side, two trapped, gas (about 1 minute)

Different floor, side and hazards. The fire is in the room where someone is trapped.

| Who | Say | The briefing should show |
|---|---|---|
| Dispatcher | "Nine one one, what's the address of your emergency?" | |
| Caller | "Eighty eight sixty six Gulf Freeway, the Vibe building. The law office is on fire, on the right side of the building!" | Address, side D, fire in the law office |
| Dispatcher | "Which floor?" | |
| Caller | "The first floor. Suite one-ten. There's thick gray smoke coming out of the windows." | Floor 1, fire area Office 110, thick gray smoke |
| Dispatcher | "Is anyone still inside?" | |
| Caller | "Two people. Mr. Rodriguez is in his office, suite one-ten, and his assistant is in the hallway by the front entrance." | Trapped: Office 110 (inside the fire room) and Hallway B; rescue route to each |
| Dispatcher | "Any hazards? Gas, chemicals?" | |
| Caller | "I smell gas near the back door, and there's a propane tank by the loading dock." | Watch: Gas, both hazards on the sheet |
| Dispatcher | "Where are you now?" | |
| Caller | "Across the street, in the gas station parking lot." | Caller location |

Checked through the live session API: address 8866 Gulf Fwy, floor 1, side D, fire room Office 110, trapped Mr. Rodriguez (Office 110) and the assistant (Hallway B), hazards "gas odor near back door" and "propane tank by loading dock".

## Script C: the caller changes their mind (30 seconds)

Tests corrections. Press End call and Start live call again first.

| Who | Say | The briefing should show |
|---|---|---|
| Dispatcher | "Nine one one, what's the address of your emergency?" | |
| Caller | "It's the office building on Gulf Freeway, I don't know the number, there's smoke everywhere!" | Address with low confidence |
| Dispatcher | "Sir, is it eighty eight sixty six Gulf Freeway?" | |
| Caller | "Yes, that one. The fire's on the second floor. No, wait, sorry, it's the third floor." | Floor flips 2 to 3, the old value struck out on the Dispatch facts page |

## After the call

- **Hear the call** (steps bar) plays your recording; tap any transcript line in the Call sheet tab to jump to it.
- **Play call briefing** reads the briefing built from this call: the fire floor and side, every trapped person and room, every hazard the caller named. It shows "Building…" while the last audio is still being processed.

## If the screen goes blank

- **Page reloaded:** the tab picks its call back up by itself.
- **Different tab or a cleared tab:** the Live test blank slate lists recent calls; click one to restore it.
- **Backend restarted** (any change to backend code restarts it under `--reload`): calls are gone. Do not edit code during a test run, and press **Save call** on the Call page to keep a call you care about.

## If something looks wrong

- Lines labeled the wrong way round: the caller spoke first. End the call and start again with the dispatcher.
- No words after about 10 seconds: check that the mic meter bars move.
- ElevenLabs out of credits: the banner offers "Use browser speech instead"; then use the Caller / Dispatcher toggle in the top bar to say who is talking.
