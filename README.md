# Auto-Pearson v0.3.0 — experimental Chrome extension

A Chrome Manifest V3 helper for supported **Pearson MyLab homework** screens, based on the workflow of Auto-McGraw. This is an independent prototype and not affiliated with Pearson.

> **Compatibility status:** Tested with mock pages and a rendered MathML fixture. It has **not** been tested in an authenticated, live Pearson MyLab account. Do not assume it will complete every assignment correctly. AI responses and third-party website layouts change; review answers before checking.

## Installation

1. Remove earlier Auto-Pearson extension versions from `chrome://extensions` (avoids conflicts between two unpacked versions).
2. Extract this ZIP. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the **extension** directory containing `manifest.json`.
3. Refresh the open Pearson homework tab **after** installation.
4. Open Gemini, ChatGPT, or DeepSeek in a separate tab and sign in there yourself (the extension does not ask for or retain your password).
5. Open the Auto-Pearson popup. Select the assistant, and choose **Scan frames**. The diagnostic area will show the frame, option count, and a short extract of the question.
6. Keep **Pause before submitting** enabled while validating a new question type. Click **Start** in the popup or the floating panel on Pearson. **Stop** ends the run.

## What changed from 0.2.0

- Recover from `Receiving end does not exist` by pinging and reinjecting the content script into the **specific permitted Pearson frame**, then retrying.
- Communicate a single tab-level run status and filled count from the question frame to the popup and floating toolbar, preventing divergent status displays.
- Preserve MathML, LaTeX annotations, and accessible SVG/image captions when extracting a question. Unreadable equations/images are flagged rather than silently removed.
- A deterministic check for common two-sided **z** critical values. E.g. \(\bar{x}\pm1.645\sigma/\sqrt n\) corresponds to **90%** confidence, not 165%. This is narrowly scoped and not a general math solver.
- Reject unstructured AI output and impossible probability/confidence answers over 100%.
- Wider popup with Start, Stop, Scan Frames, question excerpt, and diagnostics.
- Optional **Capture visible question**: from the popup while the Pearson tab is selected, capture the currently visible content, crop the account/header region, and preview the image. The crop is kept only in `chrome.storage.session`. It is sent to the chosen AI tab **only** when attachment mode is selected, and removed after one use. Screenshot uploads depend on the current AI site's file-upload controls and may fail cleanly.
- The extension intentionally does **not** request `cookies`, unrestricted `<all_urls>`, or `debugger` privileges. It needs permission to access the Pearson and selected AI domains, not passwords or unrestricted access to your browser.

## When a question is not supported

- If Scan frames says a frame is unreachable, verify **Site access** in `chrome://extensions` → Auto-Pearson → Details and refresh the homework page. A cross-origin frame that Chrome doesn't grant access to cannot be read by the content script.
- If the question contains unrecognizable images/formulas, use **Capture visible question** and inspect the crop. The helper will not blindly select an option from incomplete mathematical text.
- If the AI response is not structured JSON, the extension pauses rather than guessing.
- When Pearson re-creates or navigates the question iframe, Stop and Start again if necessary. Automatic resumption across every possible Pearson page transition has not been validated.
- The UI automations depend on Pearson and the AI provider DOM. Changes in their pages can require a new adapter.
- Matching, custom symbolic math editors, and drag-and-drop controls are not comprehensively supported. Double-credit and random-confidence from the McGraw project are not native Pearson features.

## Privacy and limits

The extension reads visible problem text and controls, never your password/cookies. The image feature crops the screenshot to the central problem pane to omit the usual account header, but *inspect the preview before enabling attachment* because other personal information may still appear in the question itself. The image is uploaded through your chosen signed-in AI tab; its privacy terms then apply. The screenshot is not saved in Chrome Sync or transmitted to any developer server.

Only activate this on assignments where using such assistance is permitted by the course's academic-integrity rules.

## Development / tests

Requires Node 22+ and Python with Playwright + a local Chromium binary.

```
node --test tests/*.test.js
python tests/math-browser-smoke.py
python tests/browser-smoke.py
python tests/toolbar-regression.py
python tests/popup-smoke.py
```

These validate the parser, the receiving-end recovery mock, the visible question scanner, a real MathML DOM fixture, the toolbar and popup. They **do not** constitute end-to-end validation on the real Pearson or AI websites.

Reference inspiration: https://github.com/GooglyBlox/auto-mcgraw (MIT licensed; implementation here is independently written).
