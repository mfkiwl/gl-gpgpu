/**
 * GPGPU update step.
 */

import { each } from '@epok.tech/fn-lists/each';
import { wrapGet } from '@epok.tech/fn-lists/wrap-index';

import { macroPass } from './macros';
import { getUniforms } from './inputs';
import { vertDef, positionsDef, preDef } from './const';

const scale = { vec2: 0.5 };

export const mergeProps = { copy: true };

/**
 * Convenience to get the currently active framebuffer.
 *
 * @see [getState]{@link ./state.js#getState}
 *
 * @param {object} state The GPGPU state.
 * @param {array<object>} state.passes Passes per step. See `getState`.
 * @param {number} [state.stepNow] The currently active state step, if any.
 * @param {number} [state.passNow] The currently active draw pass, if any.
 *
 * @returns {object} The active step's active pass object, if any.
 */
export const getPass = ({ passes: ps, stepNow: s, passNow: p }) =>
    wrapGet(s, ps)?.[p];

/**
 * Creates a GPGPU update step function, for use with a GPGPU state object.
 *
 * @todo Optional transform feedback instead of GPGPU textures, where available
 *     (needs vertex draw, instead of texture draw).
 * @todo Make this fully extensible in state.
 * @todo @example
 *
 * @see buffer
 * @see command
 * @see subimage
 * @see onCommand
 * @see onStep
 * @see onPass
 * @see [getState]{@link ./state.js#getState}
 * @see [mapGroups]{@link ./maps.js#mapGroups}
 * @see [macroPass]{@link ./macros.js#macroPass}
 * @see [getUniforms]{@link ./inputs.js#getUniforms}
 *
 * @param {object} api An API for GL resources.
 * @param {buffer} [api.buffer] Function to set up a GL buffer.
 * @param {command} [api.command=api] Function to create a GL render pass, given
 *     options, to be called later with options.
 * @param {object} state The GPGPU state to use. See `getState` and `mapGroups`.
 * @param {object} state.maps How values are grouped per-texture per-pass
 *     per-step. See `mapGroups`.
 * @param {array<array<number>>} state.passes How textures are grouped into
 *     passes. See `mapGroups`.
 * @param {object} [state.merge] Any merged state texture; uses separate state
 *     textures if not given.
 * @param {object} [state.merge.texture] The GL texture object in `state.merge`.
 * @param {subimage} [state.merge.texture.subimage] A function to update part of
 *     the merge GL texture object data. See `subimage`.
 * @param {function} [state.merge.update] Hook to update, if any; if not given,
 *     `state.merge.texture` is updated here with active states upon each pass.
 *     The default merged texture is laid out as `[texture, step]` on the
 *     `[x, y]` axes, respectively; if other layouts are needed, this merge
 *     update hook can be given here to be used as-is, and the setup and
 *     lookup logic in their respective hooks. See `getState` and `macroTaps`.
 * @param {string} [state.pre=preDef] The namespace prefix; `preDef` by default.
 * @param {object} [state.step=to] The properties for the step GL command.
 * @param {string} [state.step.vert=vertDef] The step vertex shader GLSL; a
 *     simple flat screen shader if not given.
 * @param {string} state.step.frag The step fragment shader GLSL.
 * @param {object} [state.step.uniforms=getUniforms(state)] The step uniforms;
 *     modifies any given. See `getUniforms`.
 * @param {array<number>|buffer} [state.step.positions=positionsDef()] The step
 *     position attributes; 3 points of a large flat triangle if not given.
 * @param {number} [state.step.count=state.step.positions.length*scale.vec2] The
 *     number of elements/attributes to draw.
 * @param {object} [state.step.passCommand] Any GL command properties to mix in
 *     over the default ones here, and passed to `api.command`.
 * @param {string} [state.step.vert=vertDef] Vertex shader GLSL to add code to.
 * @param {array} [state.step.verts] Preprocesses and caches vertex GLSL code
 *     per-pass if given, otherwise processes it just-in-time before each pass.
 * @param {string} [state.step.frag] Fragment shader GLSL to add code to.
 * @param {array} [state.step.frags] Preprocesses and caches fragment GLSL code
 *     per-pass, otherwise processes it just-in-time before each pass.
 * @param {onStep} [onStep] Callback upon each step.
 * @param {onPass} [onPass] Callback upon each pass.
 * @param {object} [to=(state.step ?? {})] The results object; `state.step` or
 *     a new object if not given.
 *
 * @returns {object} `to` The given `to` object; containing a GPGPU update
 *     step function and related properties, to be passed a GPGPU state.
 * @returns {string} `to.vert` The given/new `state.vert` vertex shader GLSL.
 * @returns {string} `to.frag` The given `state.frag` fragment shader GLSL.
 * @returns {array.string} `[to.verts]` Any cached pre-processed vertex shaders
 *     GLSL, if `state.step.verts` was given.
 * @returns {array.string} `[to.frags]` Any cached pre-processed fragment
 *     shaders GLSL, if `state.step.verts` was enabled.
 * @returns {object} `to.uniforms` The given `state.uniforms`.
 * @returns {number} `to.count` The given/new `state.count`.
 * @returns {buffer} `to.positions` The given/new `state.positions`; via
 *     `api.buffer`.
 * @returns {command} `to.pass` A GL command function to draw a given pass; via
 *     `api.command`.
 * @returns {function} `to.run` The main step function, which performs all the
 *     draw pass GL commands for a given state step.
 */
export function getStep(api, state, to = (state.step ?? {})) {
    const { buffer, command = api } = api;
    const { maps: { passes }, merge, pre: n = preDef, step = to } = state;
    let { positions = positionsDef() } = step;

    const {
            passCommand, vert = vertDef, verts, frag, frags, uniforms,
            count = positions.count ?? positions.length*scale.vec2
        } = step;

    to.vert = vert;
    to.frag = frag;
    to.uniforms = getUniforms(state, uniforms);
    to.count = count;
    positions = to.positions = buffer(positions);

    // Whether to pre-process and keep the shaders for all passes in advance.
    if(verts || frags) {
        // Keep the current pass.
        const { passNow } = state;

        (verts && (to.verts = verts));
        (frags && (to.frags = frags));

        each((pass, p) => {
                // Create macros for this pass in advance.
                state.passNow = p;
                // Specify the shader type, for per-shader macro hooks.
                (verts && (verts[p] ??= macroPass(state, 'vert')+vert));
                (frags && (frags[p] ??= macroPass(state, 'frag')+frag));
            },
            passes);

        // Set the pass back to what it was.
        state.passNow = passNow;
    }

    /** The render command describing a full GL state for a step. */
    to.pass = command(to.passCommand = {
        // Uses the full-screen vertex shader state by default.
        vert(_, props) {
            const { passNow: p, step } = props;
            const { vert: v = vert, verts: vs = verts } = step;

            // Specify the shader type, for per-shader macro hooks.
            return vs?.[p] ?? macroPass(props, 'vert')+v;
        },
        frag(_, props) {
            const { passNow: p, step } = props;
            const { frag: f = frag, frags: fs = frags } = step;

            // Specify the shader type, for per-shader macro hooks.
            return fs?.[p] ?? macroPass(props, 'frag')+f;
        },
        attributes: {
            [n+'position']: (_, { step: { positions: p = positions } }) => p
        },
        uniforms, count,
        depth: { enable: false },
        /** Note that this may draw to the screen if there's no active pass. */
        framebuffer: (_, props = state) => getPass(props)?.framebuffer,
        ...passCommand
    });

    /**
     * Any merged texture's update, called upon each pass. Copies the active
     * pass's state output from all its attachments, into the merged texture.
     *
     * @see https://stackoverflow.com/a/34160982/716898
     */
    (merge && (merge.update ??= (props = state) => {
        const { color, map: p } = getPass(props);
        const { merge, stepNow, size: { steps, shape: [w, h] } } = props;
        const { texture: to, copier } = merge;
        const f = copier?.framebuffer;
        const s = (stepNow%steps)*h;

        /** Reusable framebuffer to copy pixels over. */
        (to && f && color && each((color, i) =>
                f({ color }).use(() => to.subimage(mergeProps, p[i]*w, s)),
            color));

        // @todo Try this test.
        // f({ color: to }).use(() => console.warn(regl.read()));

        return to;
    }));

    /** Executes the next step and all its passes. */
    to.run = (props = state) => {
        const { steps, step, merge } = props;
        const stepNow = props.stepNow = (props.stepNow+1 || 0);
        const mergeUpdate = merge?.update;
        const { pass, onPass, onStep } = step;
        const stepProps = (onStep?.(props, wrapGet(stepNow, steps)) ?? props);

        each((p, i) => {
                stepProps.passNow = i;

                const passProps = onPass?.(stepProps, p) ?? stepProps;

                pass(passProps);
                // Update any merged texture upon each pass.
                mergeUpdate?.(passProps);
            },
            stepProps.maps.passes);

        return props;
    };

    return to;
}

/**
 * Function to set up a GL buffer; from a GL API.
 *
 * @see getStep
 *
 * @callback buffer
 *
 * @param {array<number>|buffer} data The buffer data, as `array` or `buffer`.
 *
 * @returns {*} `buffer` A GL buffer to use for vertex attributes, or an object
 *     serving that purpose.
 * @returns {number} `[buffer.count]` The buffer element/vertex count.
 * @returns {number} `[buffer.length]` The length of the buffer data array.
 */

/**
 * Function to create a GL render pass, given options, to be called later with
 * options; from a GL API.
 *
 * @see getStep
 * @see [getUniforms]{@link ./step.js#getUniforms}
 * @see [framebuffer]{@link ./state.js#framebuffer}
 *
 * @callback command
 *
 * @param {object} passCommand The properties from which to create the GL render
 *     function for a given pass.
 * @param {function} [passCommand.vert] Function hook returning the vertex
 *     shader GLSL string for the next render pass.
 * @param {function} [passCommand.frag] Function hook returning the fragment
 *     shader GLSL string for the next render pass.
 * @param {object<buffer>} [passCommand.attributes] The vertex attributes for
 *     the next render pass.
 * @param {object<function>} [passCommand.uniforms] The uniform hooks for the
 *     given `props`. See `getUniforms`.
 * @param {number} [passCommand.count] The number of elements to draw.
 * @param {object<boolean,*>} [passCommand.depth] An object describing the depth
 *     settings for the next render pass; e.g: `passCommand.depth.enable` flag.
 * @param {function} [passCommand.framebuffer] Function hook returning the
 *     `framebuffer` to draw to in the next render pass. See `framebuffer`.
 *
 * @returns {function} Function to execute a GL render pass, with options, for
 *     a given render pass.
 */

/**
 * Function of a GL `texture` to update part of it with new data; from a GL API.
 *
 * @see getStep
 * @see [texture]{@link ./state.js#texture}
 *
 * @callback subimage
 *
 * @param {texture} data The data to update into part of the calling `texture`.
 * @param {number} [x=0] Offset on the x-axis within the calling `texture`.
 * @param {number} [y=0] Offset on the y-axis within the calling `texture`.
 *
 * @returns {texture} The calling `texture`, with part updated part to `data`.
 */

/**
 * Function hook to update on each pass.
 *
 * @see getStep
 *
 * @callback onCommand
 *
 * @param {object} context General or global properties.
 * @param {object} props Local properties (e.g: the GPGPU `state`).
 *
 * @returns {number|array<number>|*} A GL object to be bound via a GL API.
 */

/**
 * Callback upon each step.
 *
 * @see getStep
 * @see [getState]{@link ./state.js#getState}
 * @see [framebuffer]{@link ./state.js#framebuffer}
 *
 * @callback onStep
 *
 * @param {object} [props] The `props` passed to `run`.
 * @param {array<framebuffer>} step The `framebuffer`s for `props.stepNow` from
 *     `props.steps`, where the next state step will be drawn. See `getState`.
 *
 * @returns {object} A `stepProps` to use for each of the step's next passes; or
 *     nullish to use the given `props`.
 */

/**
 * Callback upon each pass.
 *
 * @see getStep
 * @see [mapGroups]{@link ./maps.js#mapGroups}
 *
 * @callback onPass
 *
 * @param {object} [stepProps] The `props` passed to `run` via any `onStep`.
 * @param {array<number>} pass The maps for the next pass. See `mapGroups`.
 *
 * @returns {object} A `passProps` to use for the render `command` call; or
 *     nullish to use the given `stepProps`.
 */

export default getStep;
