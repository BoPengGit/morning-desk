import { createComponent, defineComponents, Types } from '@iwsdk/core';

/** Anything a hand ray, a poke or a head-gaze dwell can select. */
export const MdTarget = createComponent('MdTarget', {
  id: { type: Types.String, default: '' },
  dwell: { type: Types.Boolean, default: true },
});

/** A panel the user can pick up and set on another surface. */
export const MdPanel = createComponent('MdPanel', {
  key: { type: Types.String, default: '' },
});

export default defineComponents([MdTarget, MdPanel]);
