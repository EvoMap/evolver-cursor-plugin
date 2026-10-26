---
description: "Search the EvoMap network for reusable assets."
---

The Evolver plugin answers `/evolver-search <task description or error text>` itself, from its beforeSubmitPrompt hook, before this prompt reaches you.

If you are reading this, that hook did not run. Do not run any tool for it: tell the user that the Evolver plugin's hooks are not active in this Cursor window (Settings → Hooks shows them) and that reloading the window or reinstalling the plugin brings them back.
