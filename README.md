# Auto-Pearson v0.4.0 (Vision-first, experimental)

A Chrome Manifest V3 extension for **Pearson MyLab homework**. This version replaces the old manual screenshot gate with a **new cropped screenshot for each recognized question**, relayed to a selected already-open AI chat tab. It then parses the response and attempts to fill Pearson's fields. It is based on the workflow concept of [auto-mcgraw](https://github.com/GooglyBlox/auto-mcgraw), but uses a different frame and screenshot adapter for Pearson.

> **Experimental:** the extension and its Gemini/Pearson integration have NOT been tested end-to-end on a real authenticated Pearson and Gemini session. Tested against offline HTML simulations and unit tests only. Site UI changes may still break it. No guarantee of correct answers or full completion.

## Install / replace v0.3

1. **Remove** previous Auto-Pearson versions at `chrome://extensions` (otherwise two extensions can interfere).
2. Extract the ZIP archive.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the enclosed **`extension`** folder (containing `manifest.json`).
4. Open your Pearson **MyLab homework**, not an exam/quiz, and reload the tab once.
5. Open `https://gemini.google.com/app` in another tab and sign in yourself. **The extension never requests your login, password, token, or cookies.**
6. While the **Pearson** tab is active, click Auto-Pearson's icon in Chrome's Extensions menu. Choose Gemini. The popup is deliberately 600px wide.
7. Click **Preview question crop** and check that your actual question and every answer choice are visible; the question crop should be legible. The screenshot is cropped to skip the Pearson account header, sidebar, and lower controls. If part is outside the visible screen, scroll it into view.
8. Click **Test AI connection**, then **Scan frames**, then **Start**.
9. Initially leave **Pause before submitting** checked to verify that selected answers are correct. To enable automated **Check Answer / Next** attempts, uncheck Pause before submitting and keep Advance after checking enabled. If the player's Next controls cannot be safely identified, it will wait for you to advance manually.

**Note about Start:** `chrome.tabs.captureVisibleTab` requires `activeTab` permission, granted by opening the extension icon on the active Pearson tab. Starting only from the floating in-page panel, or from a separately opened settings window, may lack that temporary screenshot grant. If Chrome reports a capture-permission error, open the extension from the Chrome toolbar while on Pearson and start there. For security, the extension does **not** request unrestricted access to other websites.

## Design

For each supported problem, the flow is:

```text
Pearson current question (including embedded frame)
  -> extract question type, options and visible text
  -> screenshot the active Pearson tab automatically
  -> hide the floating toolbar and crop out account/header/sidebar
  -> switch to a signed-in Gemini tab
  -> paste/upload image + write JSON-only solving prompt
  -> wait for a NEW completed assistant response
  -> switch back to the originating Pearson frame
  -> parse structured JSON, validate selection
  -> fill radio/checkbox/input/dropdown where possible
  -> optionally click Check Answer and Next/Continue
  -> repeat for a new question, or stop with a visible reason
```

Supported targets: radio-based multiple choice, checkboxes/multi-select, basic text fields, standard dropdowns. Unsupported or unverified: Pearson equation editors, drag-and-drop/matching UIs, arbitrary graph drawing, questions requiring hidden data, remote examination interfaces. Some matching questions may work as dropdowns.

## Privacy and safety

- Extension content scripts only target Pearson homework/player hosts and the three explicitly selected AI chat hosts. Login/SSO Pearson hosts have no content-script access.
- No passwords, cookies, or session tokens are read, stored, or sent.
- A temporary full-tab screenshot is acquired via Chrome's tab capture API, cropped inside the Pearson page's content script, and only the crop is passed to the AI tab.
- Cropping uses visible viewport coordinates, not semantic identification of all sensitive elements. **Check the Preview first**. A screenshot may still contain personal or course information shown inside the question area.
- The screenshot and prompt are sent to the chosen third-party AI service and subject to its data policies. Turn off **Send screenshot with every question** to send extracted text alone (which is unreliable with image-based formulas).
- The content script never writes login credentials, navigates to financial/payment pages, or reads Chrome saved passwords. No background tracking or exfiltration endpoints.
- The extension refuses or pauses when question fields change mid-response, when it cannot match the AI's answer to an option, when the AI response is not structured JSON, and for some obvious math contradictions.
- AI answers can still be wrong. Review the result and check your school's academic-integrity requirements.

## Tests

Unit tests (requires Node.js):

```sh
node --test tests/answer-utils.test.js tests/math.test.js tests/frame-routing.test.js tests/vision-routing.test.js
```

Offline browser tests (requires `python` with `playwright` plus a local Chromium binary):

```sh
python tests/assistant-vision-smoke.py
python tests/browser-smoke.py
python tests/math-browser-smoke.py
python tests/popup-smoke.py
python tests/toolbar-regression.py
```

The offline tests exercise question extraction and choices, a screenshot→Gemini→Pearson message-routing simulation, simulated Gemini image-file upload and generated JSON reply, and popup controls. They **cannot certify** upload behavior on real Gemini or DOM layout on real Pearson, which can change.

## Troubleshooting

- **"Receiving end does not exist"**: refresh Pearson and Gemini tabs and try Scan frames. Old extensions must be removed.
- **"No screenshot permission"**: click the extension icon while the Pearson tab is active and start from that popup, not just from the floating in-page button.
- **"No image attachment preview"**: Gemini's upload UI changed or upload is disabled for your account/model. The extension stops instead of silently submitting text only. Try Test AI connection; updating the Gemini adapter may be needed.
- **Question crop misses a graph/equation**: scroll the page so the entire current question fits the visible viewport. The automatic crop uses the central question area; use Preview to inspect it.
- **"Answer filled" but no Check/Next**: Pearson has a different player widget or feedback state. Review and click manually, or send the precise status/error for a page-specific adapter.
- **Wrong choice**: Stop immediately and keep Pause before submitting enabled. AI suggestions are not guaranteed correct.

The reference auto-mcgraw extension is an independent MIT-licensed project; this build is not endorsed by Pearson or any AI provider.
