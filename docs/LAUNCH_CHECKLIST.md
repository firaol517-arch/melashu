# Launch checklist — before enabling live automated replies

The app enforces items 1–5 server-side (`PATCH /api/settings`). Items 6–9 are on you.

1. [ ] Telegram status is **connected** and the worker shows **online** (Settings → Telegram connection).
2. [ ] Knowledge base has ≥ 3 accurate items (prices, hours, policies). The AI refuses to state numbers that are not in it.
3. [ ] You ran several **test replies** (AI Secretary → Test) in Amharic and English; answers are acceptable.
4. [ ] You confirmed the five acknowledgements on the AI Secretary page.
5. [ ] Automation scope reviewed: "any private chat" OFF, contacts OFF, groups OFF unless intended.
6. [ ] **Allow-list** the first customer chats one by one (Chats → open chat → *Allow AI auto-reply*).
7. [ ] Stay in **dry-run** for a day: drafts appear dashed/"not sent" in each chat. Review them.
8. [ ] Customers are informed where required that an automated assistant and an AI provider process messages
       (consult local rules; this is your responsibility).
9. [ ] You know where Pause (global / per chat), Manual takeover and Emergency stop are.

Then: AI Secretary → **Go live**. Watch Chats and the Activity log for the first hours.
