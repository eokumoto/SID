# SID UI spec (for Codex)

SID is a web app (Next.js) that helps dyslexic readers: upload a photo of text (menu, flyer, handout) and get it back rewritten in plain language, in a dyslexia-friendly layout. Build the UI exactly as described here. The two wireframe files next to this spec are the visual reference:

- `sid-desktop-wireframes.html` (desktop browser)
- `sid-mobile-wireframes.html` (phone)

Open them in a browser. Copy colors, spacing and layout from them. Do not copy their markup literally: they are static mockups.

## Global rules

- No unnecessary text. No taglines, no instructions, no help paragraphs. Icons plus one or two words.
- Never use #000000 or #FFFFFF.
- Never use color alone to carry meaning: every colored state also has an icon and a word.
- Sharp, flat style: border-radius 2 to 3px, no drop shadows on buttons, cards use a 1px outline.
- Login is optional. Everything works without an account.
- No paste-text feature. No confirm flags: the user never has to check or approve the result.

## Design tokens

```css
:root {
  --cream: #FBF4E4;   /* page background */
  --peach: #F3E3CC;   /* reader text panel, segmented-control track */
  --ink: #1F2A44;     /* all text (13.0:1 on cream) */
  --muted: #5B6275;   /* dates, labels (5.6:1 on cream) */
  --blue: #2F4B7C;    /* primary buttons, links, active states (cream text on it 7.9:1) */
  --amber: #F6D88A;   /* highlight of word being read aloud (add-on) */
  --focus: #8A5E00;   /* keyboard focus ring (5.2:1 on cream) */
  --brick: #A8402E;   /* Delete button and error icon only (cream text 5.6:1) */
  --line: #CFC5AE;    /* card outlines, dividers */
  --paper: #E8DFCB;   /* photo/thumbnail placeholder */
  --radius: 3px;
}
/* Dark background option (settings): bg #22232B, text #EDE3CF (12.3:1) */
```

## Typography

- Font: OpenDyslexic everywhere (`npm install open-dyslexic`, free license). Fallback: Lexend (Google Fonts), then system-ui.
- Reader text: 20px minimum, line-height 1.6, letter-spacing 0.05em, word-spacing 0.15em, max line length about 60 characters.
- Left aligned, never justified. No italics or underlines for emphasis: use bold.

## Navbar (every screen)

- Left: a document placeholder icon on a peach tile, with "SID" and "Simplified Information Display" underneath. Clicking the branding goes Home.
- Right, logged out: `[gear] Settings` and a blue `Log in` button.
- Right, logged in: `[clock] History`, `[gear] Settings`, and the account avatar.
- 1px ink line under the bar. The current page's item has a 2px blue underline.
- Every icon in the navbar has its word next to it. On very narrow phones, Settings may collapse to just the gear.

## Screens

1. **Home.** A large blue `[upload icon] Upload` button in the center, with the requested line underneath: "Upload a photo. We’ll show the words in a clear font with more space." It is a normal `<input type="file" accept="image/*">`.
   - Phone: tapping it opens the phone's own menu (Photo Library / Take Photo / Choose File). Do not build a camera screen.
   - Desktop: opens the file picker. Also support drag-and-drop anywhere on the page and pasting an image with Ctrl/Cmd+V.
2. **Home, dragging a file (desktop).** The whole window shows a dashed blue border with an upload icon and the word "Drop".
3. **Processing.** The uploaded photo with a soft blue scanning bar moving down it, and one word under it that changes: "Reading", then "Rewriting". No percentages. Respect `prefers-reduced-motion`.
4. **Reader, Text view (default).**
   - Top: a segmented toggle `Text | Photo`. Text is selected by default.
   - Desktop: two columns. Left (wider): rewritten text on a peach panel. Right: the original photo.
   - Phone: text fills the screen; small photo thumbnail bottom left (tap to open), read-aloud button bottom right.
   - Rewritten text is grouped into short labeled sections chosen by meaning (for a menu: dish names, prices, notes), not raw OCR order.
   - Read aloud button (speaker icon) in the corner of the text panel. Add-on.
5. **Reader, Photo view (add-on, build only if time allows).**
   - The rewritten text is drawn on top of the photo where the original text was, like Google Translate: cream boxes with ink OpenDyslexic text.
   - A `Rewritten | [eye] Original` toggle in the corner. Always opens on Rewritten. Original hides the overlay to show the plain photo.
   - Zoom and pan: phone = pinch to zoom, one-finger drag to move. Desktop = trackpad pinch, scroll wheel, or `−` / `+` buttons to zoom; click and drag to move.
   - The overlay is pinned to the photo: put photo and overlay boxes in one container, position boxes in % of the photo size, and transform the whole container. Library suggestion: `react-zoom-pan-pinch`.
   - Box positions come from Google Cloud Vision bounding boxes.
6. **Settings.** Opened by the gear. Desktop: small panel under the navbar on the right. Phone: bottom sheet.
   - Font: segmented `OpenDyslexic | Lexend | Arial`.
   - Size: slider (small A to large A). Applies to all site text, including navigation, buttons, dialogs, and extracted text; controls reflow at larger sizes.
   - Spacing: segmented `Tight | Normal | Wide`. Applies letter, word, and line spacing across the whole site.
   - Background: 4 swatches: cream #FBF4E4, peach #F3E3CC, yellow #F6E9A8, dark #22232B.
   - Changes apply live. Save to localStorage; if logged in, also save to the account.
7. **Log in / sign up.** Opened by `Log in`. Desktop: centered box over a dimmed page with an X. Phone: bottom sheet. No logo.
   - Title "Log in or sign up".
   - `[G] Continue with Google` (outlined button).
   - Divider line with "or".
   - Email field, then blue `Continue with email` button. Updated requirement: continue to a password step. After email entry, a rate-limited server-side lookup automatically selects Log in for an existing account or Create account for a new email. Signup asks for Name, password and confirmation. Never infer account existence from an invalid-password response; this requires the private server key and lookup migration. Signup may require email confirmation according to the project settings. Include Forgot password and handle valid reset links. Google login stays available.
   - After login, the current scan and all later scans save to History. Closing the box keeps the current reading on screen, unsaved.
8. **History (logged in only).** Centered list of outlined cards, newest first: thumbnail, first line of text (truncated), date in muted text.
   - Desktop: trash icon on hover. Phone: swipe left reveals a brick Delete area with a trash icon.
   - A failed item shows "Didn't work" in brick text and a labeled `[retry icon] Retry` button.
   - Empty state: faded icon and one `Upload` button that goes Home.
9. **Delete confirm.** Desktop: small centered box over the dimmed list. Phone: bottom sheet. Thumbnail, the word "Delete?", and two buttons: `Cancel` (outlined) and `[trash] Delete` (brick). Deletes photo and text together.
10. **Error.** Icon in a peach circle (blurry image or no signal, brick stroke), a two-word reason ("Too blurry" / "No connection"), a blue `Try again` button, and a small `New photo` link.

## Accessibility checklist

- All text at least 4.5:1 contrast (current palette is 5.2:1 or higher everywhere, also under simulated protanopia, deuteranopia and tritanopia).
- Tap targets at least 48px on phones.
- Visible focus ring (`--focus`) on every interactive element.
- Every icon-only control has an `aria-label` and a tooltip.
