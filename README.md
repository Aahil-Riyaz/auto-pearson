# Auto-Pearson v0.6.0 — Next Question and multi-part fix

Experimental Chrome Manifest V3 extension for Pearson MyLab **homework**. This is an independent project, not affiliated with Pearson or Google. It follows the broad screenshot → Gemini → answer → Pearson workflow from the user's reference extension, Auto-McGraw.

## What changed from v0.5.0

- **Clicks “Next question” after correct submissions.** Pearson's “Well done!” dialog can overlay an older **Check Answer** button, which v0.5 incorrectly treated as a reason not to advance. The new code recognizes visible success feedback and prioritizes its Next question/Continue button.
- **Handles multiple subparts.** After navigation, it waits for a truly fresh question or answer controls. It supports identical question text and choices across consecutive parts, rather than treating the next part as the previous answer again.
- **Prevents Gemini requests for feedback screens.** The content script checks for success/incorrect/completed dialogs before requesting AI help. The screenshot controller *also* refuses to capture or send visible feedback dialogs as a fallback guard.
- **Works across permitted Pearson frames.** Success feedback, navigation and answer fields may be in different frames. The background controller aggregates feedback across those frames, and caches known frame IDs instead of rescanning them on every poll.
- **Doesn't blindly click Next.** Automatic progression requires confirmed success feedback. It stops on incorrect or ambiguous results. Quiz/exam players remain outside the extension's intended scope.
- **Keeps v0.5's full-resolution screenshot, Gemini integration and verified answer selection.** No new login, cookie or debugger permissions are requested.

## Installation

1. At `chrome://extensions`, **remove the previous Auto-Pearson** version to prevent two extensions from acting on the same page.
2. Unzip the archive. Choose **Load unpacked** and select `auto-pearson-v0.6.0/extension` (the folder that contains `manifest.json`).
3. Refresh the Pearson homework tab and your signed-in Gemini tab.
4. Open the Auto-Pearson Chrome toolbar popup **while Pearson is active**. Select Gemini.
5. For the requested automatic flow, turn **Pause before submitting OFF** and **Advance after checking ON**. Keep **Send screenshot with every question ON**.
6. Click **Start** from the extension popup. For an initial test, monitor the first correct-answer dialog to confirm it advances to the next question or part.

The sequence is: capture the full visible Pearson tab → send it to Gemini → match, select, and verify the answer → Check Answer → detect confirmed feedback → click Next question or Continue → wait for a fresh question/subpart → repeat. If the homework is complete, it should stop; if a new question cannot be recognized, it stops rather than making a blind guess.

## Tests

```bash
node --test tests/*.test.js
python tests/navigation-smoke.py
python tests/browser-smoke.py
python tests/math-browser-smoke.py
python tests/click-verification-smoke.py
python tests/assistant-vision-smoke.py
python tests/popup-smoke.py
python tests/screenshot-full-smoke.py
python tests/toolbar-regression.py
```

The new navigation mock reproduces the Pearson **Well done! → Next question** modal while a Check Answer button remains behind it, then progresses through **ten identically worded subparts**, and verifies no AI request occurs on a feedback screen. A separate background-worker test verifies navigation when the success dialog is in a different frame; a screenshot test verifies feedback is never transmitted to Gemini. All these are simulated tests, not a claim of authenticated live-site verification.

## Compatibility and privacy

The actual user screenshots showed that v0.5 could correctly fill option B, submit and receive a “Well done!” result. The **v0.6 advancement path has not been verified against the user's authenticated Pearson/Gemini session**, so UI changes and unusual question widgets could still require adjustments. No guarantee of a perfect grade or unrestricted access is offered.

The extension does not inspect login/SSO frames or read passwords, Chrome cookies, or saved login credentials. Vision mode sends the **entire visible Pearson tab** to your selected AI service, which can include your displayed name, course, sidebar, formulas and options. It does not capture the desktop or other tabs. Follow your institution's academic-integrity policies.
