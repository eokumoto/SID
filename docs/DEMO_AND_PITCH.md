# Demo and pitch

## Demo (90 seconds)

1. Open Scan without signing in and photograph the crowded club flyer.
2. It comes back in OpenDyslexic, in plain language.
3. Tap the flagged room code "Bldg 03-112" and confirm it against the photo.
4. *(Only if read aloud got built)* press Read aloud and watch each word light up.
5. Show "Save my history" and explain optional signup/login. Open guest recent scans and delete the scan; use a saved account example if showing cross-device History.

### The demo flyer

The team makes a flyer designed to exercise the flag workflow. A smudge does not guarantee a model will flag it; keep a clearly labeled saved example as backup. The room code is printed small and slightly smudged, to increase the chance of Gemini marking it unsure or Vision scoring it low. **Say plainly in the pitch that the team made this flyer to show how a flag works.**

- [ ] Run the full demo 5 times before Sunday; change the flyer if the flag ever fails to appear
- [ ] Seed a demo account with 2 or 3 finished scans
- [ ] Record a backup demo video
- [ ] Bring a hotspot
- [ ] Rehearse twice on the laptop used for judging

## Pitch outline

1. **Problem.** Hard-to-read text is everywhere: flyers, menus, handouts, long messages. For people with dyslexia it costs time and confidence.
2. **A real tester's quote.**
3. **Live demo.**
4. **Why it's not just ChatGPT.** The app checks for common changes to extracted values and candidate names, then gives the reader flags to check against the original. Checks can miss OCR errors, omitted names and changed meaning; they do not prove accuracy. Say "two separate OCR reads" **only for scans where Vision actually succeeded**, and mention read aloud **only if it got built**.
5. **Path to users.** Try immediately as a guest; create an account or log in to save history across devices. Campus disability resource centers, accessibility clubs, then schools.
6. **How uncertainty is handled.** Prompts ask the model to preserve facts and flag uncertainty; code adds checks with known limits. Show the "Simplified by AI" label and original comparison. Photos stay available until the user explicitly removes them; after removal the UI says the original is unavailable and disables new review. "Delete all scans and settings" keeps the account and usage counters.

## User testing

Real users are 25 of 100 points.

- **Recruit:** Cal Poly's Disability Resource Center, dyslexia and accessibility clubs.
- **Materials:** everyday public text (menus, flyers, handouts, web pages). Ask testers not to scan private documents.
- **Collect:** the in-app feedback prompt after each scan, logged events (scan done, flag confirmed, setting changed), quotes, and before-and-after reading time.
- **Targets:** 3 testers by Sat 8 PM, 8 to 10 by Sunday morning.
- **Fallback:** a Google Form after each test.
