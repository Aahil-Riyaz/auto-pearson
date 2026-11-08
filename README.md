# Auto-Pearson v0.5.0 — full-screen, verified-answer build (experimental)

Chrome Manifest V3 extension for Pearson MyLab **homework**. Uses the general workflow of [GooglyBlox/auto-mcgraw](https://github.com/GooglyBlox/auto-mcgraw), but a separate Pearson iframe/answer adapter. **This is not an official Pearson product.**

> **Live-site limitation:** The extension has NOT been verified end-to-end against a real authenticated Pearson and Gemini session. The environment running these tests blocks the mock site's Pearson URL. Unit and simulated browser tests passed; the real UI may still change, and no grade or completion guarantee is possible.

## What's fixed compared with v0.4.0

1. **Gemini `B. 90%` answer:** accepts the option letter and percent when the Pearson radio labels are generic, and refuses contradictory letter+value responses. The v0.4 error `Couldn't match "B. 90%" to a choice` now has a specific regression test.
2. **Full visible-tab screenshot:** uses Chrome's original-resolution `captureVisibleTab` output instead of cropping the center by fixed percentages. It includes anything *visible in the webpage* at that moment, including the user's displayed name, course header, sidebar, graphs and formulas. It **doesn't capture other Chrome tabs** or the system desktop. The floating extension toolbar is hidden for the capture.
3. **Actual click verification:** after a radio/checkbox click, the extension checks the control's `checked`/`aria-checked` state. If Pearson ignores the interaction, the run stops **without submitting**. It also tries a visible label/parent before reporting failure.
4. **Safer frame handling:** Pearson login/SSO frames are intentionally ignored; they are not necessary for choosing a homework answer. A missing login-frame permission is not the reason v0.4 failed.
5. **More robust option text extraction:** looks for nearby labels/choice blocks in addition to an input's immediate parent.

## Install

1. Remove older Auto-Pearson extensions at `chrome://extensions` (two copies conflict).
2. Extract the ZIP and choose **Load unpacked** on the included `extension` folder containing `manifest.json`.
3. Open and refresh your Pearson **homework** page. Open Gemini in another tab and sign in manually.
4. With the Pearson tab active, click the Auto-Pearson **Chrome toolbar icon**. Choose Gemini and click **Preview full screenshot** to confirm you can see the entire problem, including any formula or chart.
5. Click **Scan frames**, then **Test AI connection**, then **Start**. Keep **Pause before submitting** checked for your initial test. The AI must answer in structured JSON; the extension matches the option, selects it and verifies the click before proceeding.
6. For automatic Check Answer/Next attempts, turn off Pause before submitting and keep Advance after checking on. If button/feedback detection is ambiguous, the extension stops or waits rather than randomly clicking.

**Screenshot permission:** Starting from the toolbar extension popup grants the Chrome `activeTab` permission for visible-tab screenshots. The in-page floating Start button might not have that screenshot permission if you've never clicked the toolbar icon for that tab.

## Expected workflow

```text
Pearson homework tab
 -> detect current question in an embedded Pearson frame
 -> capture whole visible Pearson tab at original resolution (not scrolled full page)
 -> switch to signed-in Gemini tab
 -> attach image and send extracted question/options in a structured prompt
 -> wait for NEW completed Gemini response
 -> switch back to the original Pearson frame
 -> match the answer by option letter/value, rejecting conflicts
 -> click the field and VERIFY it registered
 -> review, or attempt Check Answer / Next depending on settings
 -> repeat on an actual new question or stop with a specific error
```

Supported targets: radio multiple choice, checkboxes, standard text fields, and some native dropdowns. Complex drag-and-drop, graph drawing, interactive math editors and novel Pearson widgets are **not** claimed as supported.

## Privacy and scope

- The extension never requests, reads or stores login details, password fields, cookies, session tokens or Chrome saved passwords. It deliberately does not inject into `login.pearson.com` or SSO frames.
- In **vision** mode, an image of your **entire visible Pearson tab** is sent to your selected AI provider. It can include your name/course and anything else visible in the page, so **review the Preview full screenshot** before Start. This is a deliberate change from the earlier cropped version, made at the user's request.
- Images and prompts are passed through your open AI tab, and subject to that service's privacy policies. The preview is kept in Chrome session storage, not uploaded elsewhere by Auto-Pearson.
- The extension does not request unrestricted `debugger` access, remote desktop access, access to other browser tabs' page content, or access to your desktop. Chrome's debugger permission is extremely broad and cannot be requested optionally; it isn't needed to fix the v0.4 failure, which happened during **answer matching before any click attempt**.
- It targets homework, not quizzes/exams. Check academic integrity rules for your course.

## Tests (offline)

Run in the project directory:

```bash
node --test tests/*.test.js
python tests/browser-smoke.py
python tests/math-browser-smoke.py
python tests/click-verification-smoke.py
python tests/assistant-vision-smoke.py
python tests/popup-smoke.py
python tests/screenshot-full-smoke.py
```

Python browser tests require Playwright and a local Chromium installation. They use simulated pages, not a real Pearson account.

## Troubleshooting

- **Can't match `B. 90%`:** update to v0.5, remove earlier copies and refresh both tabs; if still blocked, the error now reports extracted labels.
- **Can't click:** the extension now reports `Pearson did not register the click` if the chosen control stays unselected. That is a *different* issue from unmatched text and requires a page-specific input adapter.
- **Screenshot misses content:** the extension sends the whole *visible viewport*, not an entire scrollable webpage. Scroll the problem fully into view before Start or zoom out.
- **Gemini doesn't attach image:** run Test AI connection; UI changes in the Gemini upload component may still require an adapter change.
- **Login/SSO frames skipped:** expected; no need to add permissions for `login.pearson.com`.
- **No activeTab screenshot grant:** start from Chrome's Auto-Pearson extension popup while the Pearson tab is active.
