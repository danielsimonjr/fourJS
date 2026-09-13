---
"@fourjs/assets": minor
---

Add runtime-capped PNG WebAssembly decoding and strict working-memory requirements
for image, texture, and glTF loaders. Refuse uncappable platform callbacks before
decoding when a finite working-memory budget is requested, and validate image
output sizes and cleanup on rejection.
