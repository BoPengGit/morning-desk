# Third-party licenses

Morning Desk ships only the libraries below. Versions are the ones pinned in package-lock.json at the tag.

| Component | Version | License | Use |
|---|---|---|---|
| @iwsdk/core (Immersive Web SDK) | 1.0.1 | MIT | WebXR runtime, input, grab, scene understanding, anchors |
| three (super-three) | 0.181.0 | MIT | rendering |
| elics | 3.4.2 | MIT | entity component system inside IWSDK |
| @preact/signals-core | 1.14.4 | MIT | state signals inside IWSDK |
| @pmndrs/uikit | 1.0.75 | MIT | bundled by IWSDK |
| three-mesh-bvh | 0.9.15 | MIT | raycasting inside IWSDK |
| iwer, @iwer/devui (Immersive Web Emulation Runtime) | 2.5.0 | MIT | Quest 3 emulator injected on desktop browsers only; skipped on Meta Quest Browser |
| iwsdk-v0-template (meta-quest) | 2026 | Apache-2.0 | project scaffold (vite.config.ts, tsconfig.json, iwsdk.config.json, scripts/) |

Build and test tools, not shipped: vite 7.3.7 (MIT), typescript 5.9.3 (Apache-2.0), @iwsdk/cli and @iwsdk/vite-plugin-dev 1.0.1 (MIT), playwright 1.62.1 (Apache-2.0).

## Data

U.S. Department of the Treasury, Bureau of the Fiscal Service, Daily Treasury Statement, from the Fiscal Data API (api.fiscaldata.treasury.gov). Works of the U.S. Government are in the public domain in the United States. public/data/snapshot.json is a saved copy of that API used when the live API cannot be reached.

## Sounds, fonts, icons

None are bundled. Sound cues are synthesized at runtime with the Web Audio API; text uses the device's system sans-serif font; every panel is drawn at runtime.
