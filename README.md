# Auto-Pearson (experimental)

**A Chrome Manifest V3 extension for Pearson MyLab homework, modeled after the workflow of [Auto-McGraw](https://github.com/GooglyBlox/auto-mcgraw).** This is a new implementation, **not an official Pearson product**, and has **not been validated on a live Pearson assignment**.

## What works by design

- Chrome popup to choose an existing, signed-in ChatGPT, Gemini, or DeepSeek tab. No API key required.
- A floating Start / Stop / Settings toolbar appears on Pearson homework pages even if no answer fields are recognized, showing a diagnostic message instead of silently hiding.
- Detects typical HTML radio buttons, checkboxes, text fields, and dropdowns.
- Sends the current question with visible options to the selected AI tab and parses a structured reply.
- Fills a matching answer when possible. Otherwise pauses with a manual-answer explanation.
- Optionally clicks Check Answer / Final Check (default **off**) and Continue / Next (default **off**).
- Handles subsequent questions/parts when the visible question changes, without deliberately retrying a graded incorrect response.
- Remembers settings using `chrome.storage.sync`, checks whether a model tab is open, and offers an optional GitHub release checker once you publish a repo.
- Prevents the run from starting on pages detected as quizzes/exams.

## Not implemented or not guaranteed

Pearson has several distinct MyLab and Mastering assignment players, including iframe-based and custom math editors. The extension has **not been tested against their live HTML** and can fail to detect the problem, apply a response, or navigate correctly. Native math palettes, equation editors, draggable matching, diagrams, and inaccessible cross-origin iframes may require a dedicated adapter. No automated correctness guarantee is possible. ChatGPT/Gemini/DeepSeek UI changes can break their bridges.

Auto-McGraw's random SmartBook confidence and duplicate-tab double-credit features do not map cleanly to Pearson's grading interface; their settings are shown as unavailable rather than pretending to work. This tool does not manipulate grades or exploit scoring. It also does not bypass authentication, proctoring, or usage restrictions.

## Installation

1. Unzip the project and open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder **inside** this project.
4. Click the Auto-Pearson toolbar extension icon. Choose an AI provider and open a signed-in tab for it.
5. Open a **homework** assignment in Pearson MyLab. The Auto-Pearson Start panel should appear at the lower right on a top-level Pearson homework URL, even if question detection fails. A question in an embedded Pearson frame may also display its own panel.
6. Start with **Pause before submitting ON**. Click **Start**, review the filled answer, then click Pearson's Check Answer manually.
7. Only after testing your exact course player, turn off pause-before-submitting if allowed by your academic integrity rules. The extension may still need manual intervention.

## Data and privacy

The extension reads the visible question container on a Pearson page and sends its question text and options to the AI tab you selected. Nothing runs automatically on page load. It does not store Pearson credentials or use a remote backend. Do not use the extension in pages displaying private information outside the problem statement. Keep Chrome permissions scoped to the stated education and AI domains.

## Development

- `extension/pearson.js`: Pearson form discovery, answer applying, UI, and the run loop.
- `extension/assistant.js`: assistant-tab bridge. Site UI selectors can change without notice.
- `extension/background.js`: service worker for routing requests and replies by originating tab/frame.
- `extension/answer-utils.js`: answer parsing and choice selection, with dependency-free tests.
- `extension/popup.*`: options and provider status.
- `tests/answer-utils.test.js`: run with `node --test tests/answer-utils.test.js`.

To add support for a specific player, capture a **sanitized DOM snippet** of a question and its input controls (never passwords, tokens, cookies, or student details), then update the container/control selectors and test against that markup.

## Credits

Workflow inspired by [GooglyBlox/auto-mcgraw](https://github.com/GooglyBlox/auto-mcgraw), MIT licensed. This implementation is written separately and does not include the original project's code or assets. Pearson and its product names are trademarks of their respective owners.

## v0.1.1 toolbar fix

If the Start button was previously missing on `mylab.pearson.com/Student/PlayerHomework.aspx`, this version displays the floating control in the lower right without requiring successful question detection. Replacing the extension and **refreshing the Pearson homework tab** is required. If Start reports that answer controls were not detected, the current Pearson player still needs an adapter; the fix does not falsely claim it can answer unsupported widgets.
