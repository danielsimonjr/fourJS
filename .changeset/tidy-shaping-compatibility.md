---
"@fourjs/text": patch
---

Restore harfbuzzjs 0.4.13, the supported ABI for the optional shaping adapter.
The incompatible 1.x dependency update removed the explicit Wasm initialization
and resource disposal APIs used by fourJS, preventing the adapter from loading.
