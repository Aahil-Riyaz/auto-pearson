# Auto-Pearson

Made by Aahil Riyaz · [Download v0.6.1](https://github.com/Aahil-Riyaz/auto-pearson/releases/tag/v0.6.1) · [Project page](https://aahil-riyaz.github.io/auto-pearson/)

Auto-Pearson is an experimental Chrome extension for Pearson MyLab homework automation. It reads the current question across supported frames, sends it to a selected AI chat, and fills recognized answer controls. You can review the answer before submission or enable automatic checking and progression.

## Install and run

1. Download and extract the release ZIP. Open Chrome’s Extensions page at `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the **extension** folder containing `manifest.json`. Disable older copies.
2. Open your Pearson MyLab homework and sign in to the AI chat you plan to use. Refresh both tabs after installation.
3. With the homework visible, open Auto-Pearson, select the assistant, and click **Test AI connection**. The popup offers Gemini, ChatGPT, and DeepSeek.
4. Leave **Pause before submitting** on to check the first answer yourself. Choose **Start**. To let the extension submit and move on, turn the pause off and enable **Advance after checking**. Use **Stop** to end the run.

## Single questions and multi-part homework

Version 0.6.1 recognizes positive feedback such as “Fantastic!” and “Well done!” and looks for **Next question** or **Continue** before requesting another answer. This matters when the completed question is still visible behind the feedback. Recognition depends on the player’s markup. Custom math inputs, drag-and-drop exercises, and updated chat interfaces can behave differently. The extension targets homework players. It is independent of Pearson and the AI providers.

## Permissions and privacy

Starting a run can send question text and, with screenshots enabled, the **entire visible homework tab** to the selected chat. That image may include your name, course, sidebar, and other content around the question. The selected provider handles the conversation under your account settings. Turn screenshots off to use text only. Use the extension where your course permits AI assistance.

Tab, scripting, and navigation permissions let the extension locate the homework, inspect permitted frames, and switch to the chat. Chrome sync stores preferences. The optional update check contacts GitHub’s public releases API.

## Verification

From the repository root run `node --test tests/*.test.js`. For browser fixtures, install Python Playwright with `python -m pip install playwright` and its browser with `python -m playwright install chromium`, then run `python tests/fantastic-navigation-smoke.py` and `python tests/navigation-smoke.py`. Set `CHROMIUM_PATH` to use a specific Chromium executable. The fixtures simulate feedback dialogs and repeated subparts. Live course and provider compatibility varies.

See [third-party attribution](NOTICE.md).
