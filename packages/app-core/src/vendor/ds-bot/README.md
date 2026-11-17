# DS Bot view contract

`views.js` and `formula.js` are unmodified from [DeepSeek-Bot v0.2.1](https://github.com/Fei2411/DeepSeek-Bot/tree/v0.2.1/ds-bot/src/shared), Apache-2.0 (see LICENSE). Copyright 2026 Fei2411 and contributors.

The Android renderer uses the same bounded declarative schema and expression interpreter as the Host. No eval, model JavaScript or HTML is executed. HTML nodes display their summary with a Host-only notice. `views.d.ts` is our typed boundary; upstream JavaScript remains unchanged to simplify future version comparisons.
