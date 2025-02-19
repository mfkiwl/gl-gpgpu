/**
 * Default properties for `gpgpu` and `GL` capabilities and resources.
 *
 * @module
 */

import { positions } from '@epok.tech/gl-screen-triangle';
import _vertDef from './index.vert.glsl';

/** Default vertex shader `GLSL` code. */
export const vertDef = _vertDef;

// The required and optional `GL` extensions for a `gpgpu` state.

/** Default required extensions; none. */
export const extensions = () => [];

/** Default required extensions to draw to `float` buffers. */
export const extensionsFloat = () =>
  ['oes_texture_float', 'webgl_color_buffer_float'];

/** Default required extensions to draw to `half float` buffers. */
export const extensionsHalfFloat = () =>
  ['oes_texture_half_float', 'ext_color_buffer_half_float'];

/** Default optional extensions; update more data in one render pass. */
export const optionalExtensions = () => ['webgl_draw_buffers'];

/** Prefix namespace to avoid naming clashes; highly recommended. */
export const preDef = 'gpgpu_';

/**
 * Default minimum allowable channels for `framebuffer` attachments.
 * This avoids `RGB32F` `framebuffer` attachments, which errors on Firefox.
 *
 * @see [Firefox RGB32F bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1448632)
 */
export const channelsMinDef = 4;

/**
 * Default minimum allowable channels for `framebuffer` attachments.
 * This avoids `RGB32F` `framebuffer` attachments, which errors on Firefox.
 *
 * @see [Firefox `RGB32F` bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1448632)
 */
export const channelsMaxDef = 4;

/** Default maximum `texture`s bound per pass. */
export const buffersMaxDef = 1;

/**
 * Default how many steps are bound as outputs, unavailable as input; for
 * platforms forbidding read/write of same buffer.
 */
export const boundDef = 1;

/**
 * Default length of the data `texture`s sides to allocate; gives a square
 * power-of-two `texture` raising 2 to this power.
 */
export const scaleDef = 9;

/**
 * Default width of the data `texture`s sides to allocate; gives a square
 * power-of-two `texture` raising 2 to the default scale.
 */
export const widthDef = 2**scaleDef;

/**
 * Default height of the data textures sides to allocate; gives a square
 * power-of-two texture raising 2 to the default scale.
 */
export const heightDef = 2**scaleDef;

/** Default number steps of state to track. */
export const stepsDef = 2;

/** Default values to track. */
export const valuesDef = () => [channelsMaxDef];
/** Default vertex positions `attribute`; 3 points of a large flat triangle. */
export const positionsDef = () => [...positions];

// `GL` resource format defaults.

/** Default `texture` data type. */
export const typeDef = 'float';
/** Default `texture` minification filter. */
export const minDef = 'nearest';
/** Default `texture` magnification filter. */
export const magDef = 'nearest';
/** Default `texture` wrap mode, avoid `WebGL1` needing power-of-2 `texture`. */
export const wrapDef = 'clamp';
/** Default `framebuffer` depth attachment. */
export const depthDef = false;
/** Default `framebuffer` stencil attachment. */
export const stencilDef = false;
/** Whether states merge into one `texture`; one merged `texture` by default. */
export const mergeDef = true;
