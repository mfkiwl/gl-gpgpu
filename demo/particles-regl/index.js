/**
 * Demo implementation of 3D particle Verlet/Euler integration simulation.
 */

import getRegl from 'regl';
import clamp from 'clamp';
import timer from '@epok.tech/fn-time';
import reduce from '@epok.tech/fn-lists/reduce';
import map from '@epok.tech/fn-lists/map';
import each from '@epok.tech/fn-lists/each';
import range from '@epok.tech/fn-lists/range';

import { gpgpu, extensionsFloat, extensionsHalfFloat, optionalExtensions }
    from '../../index';

import { macroPass } from '../../macros';
import { getMaps } from '../../maps';
import { getUniforms } from '../../inputs';
import { getDrawIndexes } from '../../size';
import indexPairs from '../../index-pairs';

import stepFrag from './step.frag.glsl';
import drawVert from './draw.vert.glsl';
import drawFrag from './draw.frag.glsl';

self.gpgpu = gpgpu;
self.macroPass = macroPass;
self.getMaps = getMaps;
self.getUniforms = getUniforms;
self.getDrawIndexes = getDrawIndexes;
self.indexPairs = indexPairs;

const extend = {
    halfFloat: extensionsHalfFloat?.(),
    float: extensionsFloat?.(),
    other: optionalExtensions?.()
};

const regl = self.regl = getRegl({
    pixelRatio: Math.max(Math.floor(devicePixelRatio), 1.5),
    extensions: extend.required = extend.halfFloat,
    optionalExtensions: extend.optional = [...extend.float, ...extend.other]
});

console.group('Extensions');

console.log('required', (extend.required &&
    reduce((o, e) => o+(o && '; ')+e+': '+regl.hasExtension(e),
        extend.required, '')));

console.log('optional', (extend.optional &&
    reduce((o, e) => o+(o && '; ')+e+': '+regl.hasExtension(e),
        extend.optional, '')));

console.groupEnd();

const canvas = document.querySelector('canvas');

canvas.classList.add('view');

// How many frame-buffers are bound at a given time.
const bound = 1;

// How many values/channels each property independently tracks.
// The order here corresponds to the order in the shaders and generated macros,
// though these may be `packed` across channels/textures/passes differently.

const valuesMap = (new Map())
    .set('position', 3).set('motion', 3).set('life', 1);

const values = [];
const valuesIndex = {};

valuesMap.forEach((v, k) => valuesIndex[k] = values.push(v)-1);

// Limits of this device and these `values`.
const { maxTextureUnits, maxTextureSize, lineWidthDims, pointSizeDims } =
    regl.limits;

const limits = {
    steps: [
        1+bound,
        Math.floor(maxTextureUnits/(reduce((s, v) => s+v, values, 0)/4))
    ],
    // Better stay farther under maximum texture size, or errors/crashes.
    scale: [1, Math.log2(maxTextureSize)]
};

const niceScale = clamp(8, ...limits.scale);

console.log('limits', limits, regl.limits);

// Handle query parameters.

const getQuery = (search = location.search) => new URLSearchParams(search);

function setQuery(entries, query = getQuery()) {
    each(([k, v = null]) => ((v === null)? query.delete(k) : query.set(k, v)),
        entries);

    return query;
}

let query = getQuery();

// 1 active state, as many others as can be bound; at least 2 past states needed
// for Verlet integration, 1 for Euler integration.
const steps = Math.floor(clamp((parseInt(query.get('steps'), 10) || 1+bound),
    ...limits.steps));

const stepsPast = steps-bound;

const scale = Math.floor(clamp((parseInt(query.get('scale'), 10) || niceScale),
    ...limits.scale));

// Trails of points if given; if not given, uses trails of lines.
const usePoints = query.has('points');

// Constant-step (add time-step), if given; if not given, uses real-time
// (variable delta-time).
const hasTimestep = query.has('timestep');
const timestepDef = 1e3/60;

const timestep = (hasTimestep &&
    (parseFloat(query.get('timestep'), 10) || timestepDef));

console.log(location.search+':\n', ...([...query.entries()].flat()), '\n',
    'steps:', steps, 'scale:', scale, 'timestep:', timestep);

// Set up the links.

document.querySelector('#default').href =
    `?${setQuery([['steps'], ['scale']])}#default`;

document.querySelector('#verlet').href = `?${setQuery([
        ['steps', 2+bound], ['scale', niceScale]
    ])}#verlet`;

document.querySelector('#long').href = `?${setQuery([
        ['steps', limits.steps[1]],
        ['scale', clamp(limits.scale[0]+6, ...limits.scale)]
    ])}#long`;

document.querySelector('#max').href = `?${setQuery([
        ['steps', Math.max(limits.steps[0], limits.steps[1]-3)],
        ['scale', Math.max(niceScale, limits.scale[1]-5)]
    ])}#max`;

document.querySelector('#trails').href =
    `?${setQuery([['points', ((usePoints)? null : '')]])}#trails`;

document.querySelector('#timestep').href =
    `?${setQuery([['timestep', ((timestep)? null : timestepDef)]])}#timestep`;

// How values/channels map to their derivations.

const derives = [];

derives[valuesIndex.position] = [
    // Position, 2 steps past.
    [clamp(1, 0, stepsPast-1), valuesIndex.position],
    // Position, 1 step past.
    valuesIndex.position,
    valuesIndex.motion,
    valuesIndex.life
];

derives[valuesIndex.motion] = [
    valuesIndex.motion,
    valuesIndex.life
];

derives[valuesIndex.life] = [
    // Life, last step past.
    [Math.max(stepsPast-1, 0), valuesIndex.life],
    // Life, 1 step past.
    valuesIndex.life
];

// Whether to allow Verlet integration.
const canVerlet = (stepsPast >= 2);

// The main GPGPU state.
const state = gpgpu(regl, {
    props: {
        // Set up the timer.
        timer: timer((timestep)?
                // Constant-step (add time-step).
                { step: timestep, dts: range(2, 0) }
                // Real-time (variable delta-time).
            :   { step: '-', now: () => regl.now()*1e3, dts: range(2, 0) }),
        // Speed up or slow down the passage of time.
        rate: 1,
        // Loop time over this period to avoid instability of parts of the demo.
        loop: 3e3,
        // Range of how long a particle lives before respawning.
        lifetime: [5e2, 3e3],
        // Whether to use Verlet (midpoint) or Euler (forward) integration.
        useVerlet: canVerlet,
        // Acceleration due to gravity.
        g: [0, -9.80665, 0],
        // The position particles respawn from.
        source: [0, 0, 0.5],
        // For numeric accuracy, encoded as exponent `[b, p] => b*(10**p)`.
        scale: [1, -7],

        // One option in these arrays chosen by Euler/Verlet, respectively.

        // The motion particles respawn with.
        spout: [3e3, 2e2],
        // Drag coefficient.
        // drag: [range(3, 1e-3), range(3, 1e-1)]
    },
    bound, steps, scale, maps: { values, derives },
    // Ensure th draw shader can variably access past steps.
    merge: canVerlet,
    // Data type according to support.
    type: ((extend.float.every(regl.hasExtension))? 'float' : 'half float'),
    // Per-shader macro hooks, no macros needed for the `vert` shader.
    macros: { vert: false },
    step: {
        // Per-pass macros will prepend to `frag` shader and cache in `frags`.
        frag: stepFrag, frags: [],
        uniforms: {
            dt: (_, { props: { timer: { dt }, rate: r } }) => dt*r,
            dt0: (_, { props: { timer: { dts: { 0: dt } }, rate: r } }) => dt*r,
            dt1: (_, { props: { timer: { dts: { 1: dt } }, rate: r } }) => dt*r,
            time: (_, { props: { timer: { time: t }, rate: r } }) => t*r,

            loop: (_, { props: { timer: { time: t }, loop: l } }) =>
                Math.sin(t/l*Math.PI)*l,

            lifetime: regl.prop('props.lifetime'),
            useVerlet: (_, { props: { useVerlet: u } }) => +u,
            g: regl.prop('props.g'),
            source: regl.prop('props.source'),
            // For numeric accuracy, encoded as exponent `[b, e] => b*(10**e)`.
            scale: regl.prop('props.scale'),

            // One option in these arrays chosen by Euler/Verlet, respectively.
            spout: (_, { props: { spout: ss, useVerlet: u } }) => ss[+u],
            // drag: (_, { props: { drag: ds, useVerlet: u } }) => ds[+u]
        }
    }
});

console.log(self.state = state);

console.group('How `values` are `packed` to fit texture channels efficiently');
console.log(state.maps.values, '`values` (referred to by index)');
console.log(state.maps.packed, '`packed` (`values` indexes)');
console.log(...state.maps.textures, '`textures` (`values` indexes)');
console.log(state.maps.valueToTexture, '`valueToTexture` (`textures` indexes)');
console.groupEnd();

// Set up rendering.

// Draw count; note `state.size.count` here equals `countDrawIndexes`.
const drawCount = state.size.count*((usePoints)? steps : indexPairs(steps));
const drawIndexes = getDrawIndexes(drawCount);

const drawState = {
    ...state,
    drawProps: {
        // Speed-to-colour scaling, as `[multiply, power]`.
        // One option in these arrays chosen by Euler/Verlet, respectively.
        pace: [[1e-3, 0.6], [3e2, 0.6]]
    },
    // @todo Draw all states with none bound as outputs - currently errors.
    // bound: 0,
    // Drawing, don't need to output any data; also don't need `frag` macros.
    macros: { 'output': 0, 'frag': 0 },
    // Everything mapped the same way.
    maps: getMaps({
        ...state.maps,
        // This one pass can bind textures for input; not output across passes.
        texturesMax: maxTextureUnits,
        /**
         * One set of reads of all values in one pass.
         * Passing `true` adds all values at that level of nesting:
         * `pass|[values|[value|[step, value]]]`
         * Thus, this example means that the _first_ value derives from:
         * - All values 1 step past (`true`).
         * - The position value 2 steps past.
         * Makes `reads_0_i` macros for each `i => [step, value]` of
         * `[[0, 0], [0, 1], [0, 2], [1, 0]]`
         */
        derives: [[true, [clamp(1, 0, stepsPast-1), valuesIndex.position]]]
    })
};

const drawWidth = 2**3;

const drawCommand = {
    // Use GPGPU macro mappings by prepending macros from a single pass.
    vert: macroPass(drawState)+drawVert,
    frag: drawFrag,
    attributes: { index: drawIndexes },
    // Hook up GPGPU uniforms by adding them here.
    uniforms: getUniforms(drawState, {
        ...drawState.step.uniforms,
        scale: regl.prop('props.scale'),
        pace: (_, { drawProps: { pace }, props: { useVerlet: u } }) => pace[+u],
        pointSize: clamp(drawWidth, ...pointSizeDims)
    }),
    lineWidth: clamp(drawWidth, ...lineWidthDims),
    count: drawCount,
    depth: { enable: true },
    blend: { enable: true, func: { src: 'one', dst: 'one minus src alpha' } },
    primitive: ((usePoints || steps-drawState.bound < 2)? 'points' : 'lines')
};

console.log((self.drawState = drawState), (self.drawCommand = drawCommand));

const draw = regl(drawCommand);

function stepTime(state) {
    const { dts } = state;

    dts[0] = dts[1];
    dts[1] = timer(state).dt;

    return state;
}

const clearView = { color: [0, 0, 0, 0], depth: 1 };

regl.frame(() => {
    stepTime(state.props.timer);
    state.step.run();
    drawState.stepNow = state.stepNow;
    regl.clear(clearView);
    draw(drawState);
});

// Toggle Verlet integration, if there are enough past steps.
canvas.addEventListener('click', () =>
    console.log('useVerlet',
        (state.props.useVerlet = (canVerlet && !state.props.useVerlet))));

canvas.addEventListener('touchmove', (e) => {
    e.stopPropagation();
    e.preventDefault();
});

canvas.addEventListener((('onpointermove' in self)? 'pointermove'
        :   (('ontouchmove' in self)? 'touchmove' : 'mousemove')),
    (e) => {
        const { clientX: x, clientY: y } = e;
        const { source } = state.props;
        const size = Math.min(innerWidth, innerHeight);

        source[0] = ((((x-((innerWidth-size)*0.5))/size)*2)-1);
        source[1] = -((((y-((innerHeight-size)*0.5))/size)*2)-1);

        e.stopPropagation();
        e.preventDefault();
    });

module?.hot?.accept?.(() => location.reload());
