# Release Browser / OS / Profile Compatibility Matrix — 0.1.0-alpha.1 Canary

This is the per-release compatibility matrix for `opencontainer-0.1.0-alpha.1-canary`. It separates **what has retained evidence** from what is merely listed so users can see the current support boundary.

Only one row is evidence-backed today. The other rows are deliberately published as unverified rather than silently omitted or marketed as supported.

| Row | Browser | OS / arch | Device/profile | Status | Claim |
| --- | --- | --- | --- | --- | --- |
| chrome-linux-declared | Google Chrome 153.0.8010.52 | Ubuntu 24.04 x64 | desktop-chrome153-ubuntu2404-x64-ci | SUPPORTED-EVIDENCE-BACKED | Supported only for the named retained CI evidence profile. |
| chrome-windows | Google Chrome, version unfrozen | Windows x64 | desktop | UNVERIFIED-NOT-CLAIMED | No Windows support claim yet. |
| chrome-macos | Google Chrome, version unfrozen | macOS arm64 | desktop | UNVERIFIED-NOT-CLAIMED | No macOS Chrome support claim yet. |
| firefox-linux | Mozilla Firefox, version unfrozen | Ubuntu x64 | desktop | UNVERIFIED-NOT-CLAIMED | No Firefox support or minimum-version claim yet. |
| safari-macos | Safari, version unfrozen | macOS arm64 | desktop | UNVERIFIED-NOT-CLAIMED | No Safari support or minimum-version claim yet. |
| chrome-android | Google Chrome, version unfrozen | Android arm64 | mobile | UNVERIFIED-NOT-CLAIMED | No mobile support claim yet. |
| chrome-linux-weak-device | Google Chrome, version unfrozen | Ubuntu x64 | weak-device | UNVERIFIED-RESOURCE-FLOOR | No 4 GiB/8 GiB weak-device support or performance-floor claim yet. |

## Evidence boundary

The evidence-backed row is tied to Google Chrome **153.0.8010.52**, Ubuntu **24.04 x64**, GitHub-hosted standard x64 and profile `desktop-chrome153-ubuntu2404-x64-ci`. This matrix does not infer Windows, macOS, Firefox, Safari, mobile or weak-device support from that row.

Browser minimum versions are **not frozen**. P11-13 stays open until a real cross-browser matrix exists with retained receipts sufficient to freeze minimums. P14-13 remains open until regression campaigns exist for the frozen floor and newest stable. Weak-device gates remain open.

`production_closed=false`.
