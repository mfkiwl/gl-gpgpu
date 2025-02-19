/**
 * The `gpgpu` `GLSL` preprocessor macros for working with the state and maps.
 *
 * Use these with care, as each set of different macros will result in new
 * shaders and compilations; so, as few unique macros as possible should be
 * created for a given set of inputs, for efficiency.
 *
 * @module
 *
 * @todo Ensure the `output_N` in `macroOutput` can work with `WebGL2`; look at
 *   using `layout(location=attach_N) out data_N`, not `gl_FragData[attach_N]`.
 *   - https://stackoverflow.com/questions/51793336/multiple-output-textures-from-the-same-program
 *   - https://stackoverflow.com/questions/46740817/gl-fragdata-must-be-constant-zero
 *   - https://stackoverflow.com/questions/50258822/how-are-layout-qualifiers-better-than-getattriblocation-in-webgl2
 * @todo Redo examples, especially `macroTaps` and `macroPass`.
 * @todo Allow passes into or across textures; separate data and texture shapes.
 * @todo Make everything function-like macro taking variable names? Makes
 *   variable names explicit (e.g: `useSamples(samples)`, `useReads_0(reads)`,
 *   `tapStateBy(data, st, stepPast, 0)`, `tapState(data, st)`), but makes
 *   interconnections harder (e.g: `macroValues`, `macroOutput`, `macroTaps`);
 *   probably impossible without concatenation macro anyway, namespace is OK.
 */

import reduce from '@epok.tech/fn-lists/reduce';
import map from '@epok.tech/fn-lists/map';
import { type } from '@epok.tech/is-type/type';

import { preDef, boundDef } from './const';

/** Escaped carriage-return for easier reading. */
export const cr = ' \\\n';
/** The channels denoted for texture input/output. */
export const rgba = 'rgba';
/** Simple cache for temporary or reusable objects. */
export const cache = {};

/** Gives cache keys from plain objects. */
const id = JSON.stringify;

/** Keys for each part of the macro handling process available to hooks. */
export const hooks = {
  /** The full set of macros. */
  macroPass: '',
  /** Each part of the set of macros. */
  macroValues: 'values', macroOutput: 'output',
  macroSamples: 'samples', macroTaps: 'taps'
};

/**
 * Whether macros should be handled here; or the result of handling them by a
 * given named hook.
 * Allows macros of the given key to be handled by external named hooks, to
 * replace any part of the functionality here.
 *
 * @example ```
 *   // Macros to be handled here, the default.
 *   [hasMacros(), hasMacros({}), hasMacros({ macros: true })]]
 *     .every((m) => m === null);
 *
 *   // Macros to be handled here, with prefix `'pre_'` instead of `'preDef'`.
 *   hasMacros({ pre: 'pre_' }) === null;
 *
 *   // Macros not created.
 *   [hasMacros({ macros: false }), hasMacros({ macros: 0 })]
 *     .every((m) => m === '');
 *
 *   // Macros for 'a' handled by external static hook, not here.
 *   hasMacros({ macros: { a: '//A\n', b: () => '//B\n' } }, 'a') === '//A\n';
 *   // Macros for 'b' handled by external function hook, not here.
 *   hasMacros({ macros: { a: '//A\n', b: () => '//B\n' } }, 'b') === '//B\n';
 *   // Macros specified `on` a 'frag' not created.
 *   hasMacros({ macros: { frag: 0 } }, '', 'frag') === '';
 *   // Macros specified `on` a 'vert' handled here.
 *   hasMacros({ macros: { frag: 0, a_vert: 0 } }, '', 'vert') === null;
 *   // Macros for hook `'a'` specified `on` a 'vert' not created.
 *   hasMacros({ macros: { frag: 0, a_vert: 0 } }, 'a', 'vert') === '';
 * ```
 *
 * @param {object} [props] The properties handling macros.
 * @param {string} [key] The name for which macros should be handled.
 * @param {string} [on=''] Any further macro `hooks` specifier; if given, both
 *   the hook key and this specifier are checked (e.g: `key` and `key_on`).
 *
 * @param {string|function|object|false} [macros=props.macros] Whether and how
 *   `GLSL` preprocessor macros should be handled:
 *   - If it's false-y and non-nullish, no macros are handled here.
 *   - If it's a string, no macros are handled here as it's used instead.
 *   - If it's a function, it's passed the given `props`, `key`, `macros`, and
 *     the returned result is used.
 *   - If it's an object, any value at the given `key` is entered recursively,
 *     with the given `props`, `key`, and `macros[key]`.
 *   - Otherwise, returns `null` to indicate macros should be handled here.
 *
 * @returns {string|null} Either the result of the macros handled elsewhere,
 *   or `null` if macros should be handled here.
 */
export function hasMacros(props, key, on = '', macros = props?.macros) {
  if((macros ?? true) === true) { return null; }
  else if(!macros) { return ''; }

  const t = type(macros);

  return ((t === 'Function')? macros(props, key, on, macros)
    : ((t === 'String')? macros
    : (((macros instanceof Object) && (key in macros))?
      hasMacros(props, key, on, macros[key])
    : ((on)? hasMacros(props, ((key)? key+'_' : '')+on, '', macros)
    : null))));
}

/**
 * Generates an array-like declaration, as a `GLSL` syntax string compatible
 * with all versions.
 *
 * Workaround for lack of `const` arrays in `GLSL` < 3. Used as the base for the
 * other `GLSL` version list types, ensuring a standard basis while offering
 * further language features where available.
 *
 * @example ```
 *   getGLSLListBase('float', 'list', [0, 1, 2], 'const'); // =>
 *   'const int list_l = 3;'+cr+
 *   'const int list_0 = float(0);'+cr+
 *   'const int list_1 = float(1);'+cr+
 *   'const int list_2 = float(2);';
 * ```
 *
 * @param {string} type The `GLSL` list data-type.
 * @param {string} name The name of the `GLSL` list variable.
 * @param {array<number,array<number>>} a The list of `GLSL` values.
 * @param {string} [qualify=''] A `GLSL` qualifier, if needed.
 * @param {string} [init=type] A data-type initialiser, `type` by default.
 *
 * @returns {string} The `GLSL1` array-like declaration string.
 */
export const getGLSLListBase = (type, name, a, qualify = '', init = type) =>
  `const int ${name}_l = ${a.length};`+
  reduce((s, v, i) =>
      s+cr+(qualify && qualify+' ')+type+
        ` ${name}_${i} = ${init}(${v.join?.(', ') ?? v});`,
    a, '');

/**
 * Generates an array-like declaration, as a `GLSL1` syntax string.
 *
 * Workaround for lack of `const` arrays in `GLSL` < 3. Adds a lookup macro
 * function; slow here, but standard.
 *
 * @see {@link getGLSLListBase}
 *
 * @example ```
 *   getGLSL1ListLike('float', 'list', [0, 1, 2], 'const'); // =>
 *   'const int list_l = 3;'+cr+
 *   'const int list_0 = float(0);'+cr+
 *   'const int list_1 = float(1);'+cr+
 *   'const int list_2 = float(2);\n'+
 *   '// Index macro `list_i` (e.g: `list_i(0)`) may be slow, `+
 *     'use name (e.g: `list_0`) if possible.\n'+
 *   '#define list_i(i) ((i == 2)? list_2 : ((i == 1)? list_1 : list_0))\n';
 * ```
 *
 * @param {string} type The `GLSL` list data-type.
 * @param {string} name The name of the `GLSL` list variable.
 * @param {array<number,array<number>>} a The list of `GLSL` values.
 * @param {string} [qualify=''] A `GLSL` qualifier, if needed.
 * @param {string} [init=type] A data-type initialiser, `type` by default.
 *
 * @returns {string} The `GLSL1` array-like declaration string.
 */
export const getGLSL1ListLike = (type, name, a, qualify = '', init = type) =>
  getGLSLListBase(type, name, a, qualify, init)+'\n'+
  // @todo Would ideally use the concatenation macro, but can't in GLSL 1.
  // `#define ${name}_i(i) ${name}_##i`;
  `// Index macro \`${name}_i\` (e.g: \`${name}_i(0)\`) may be slow, `+
    `use name (e.g: \`${name}_0\`) if possible.\n`+
  `#define ${name}_i(i) ${reduce((s, v, i) =>
      ((i)? `((i == ${i})? ${name}_${i} : ${s})` : `${name}_${i}`),
    a, '')}\n`;

/**
 * Generates an array declaration, as a `GLSL1` syntax string.
 *
 * Lookup and meta macros are added for consistency with other versions.
 *
 * @see {@link getGLSLListBase}
 *
 * @example ```
 *   getGLSL1ListArray('vec3', 'list', [[1, 0, 0], [0, 2, 0], [0, 0, 3]]);
 *   // =>
 *   'const int list_l = 3;'+cr+
 *   'vec3 list_0 = vec3(1, 0, 0);'+cr+
 *   'vec3 list_1 = vec3(0, 2, 0);'+cr+
 *   'vec3 list_2 = vec3(0, 0, 3);'+cr+
 *   'vec3 list[list_l];'+cr+
 *   'list[0] = list_0;'+cr+
 *   'list[1] = list_1;'+cr+
 *   'list[2] = list_2;\n'+
 *   '#define list_i(i) list[i]\n';
 * ```
 *
 * @param {string} type The `GLSL` list data-type.
 * @param {string} name The name of the `GLSL` list variable.
 * @param {array<number,array<number>>} a The list of `GLSL` values.
 * @param {string} [qualify=''] A `GLSL` qualifier, if needed.
 * @param {string} [init=type] A data-type initialiser, `type` by default.
 *
 * @returns {string} The `GLSL1` array declaration string.
 */
export const getGLSL1ListArray = (type, name, a, qualify = '', init = type) =>
  getGLSLListBase(type, name, a, qualify, init)+cr+
  (qualify && qualify+' ')+type+` ${name}[${name}_l];`+
  reduce((s, _, i) => s+cr+name+`[${i}] = ${name}_${i};`, a, '')+'\n'+
  `#define ${name}_i(i) ${name}[i]\n`;

/**
 * Generates an array declaration, as a `GLSL3` syntax string.
 *
 * Lookup and meta macros are added for consistency with other versions.
 *
 * @see {@link getGLSLListBase}
 *
 * @example ```
 *   getGLSL3List('int', 'list', [0, 1, 2], 'const'); // =>
 *   'const int list_l = 3;'+cr+
 *   'const int list_0 = int(0);'+cr+
 *   'const int list_1 = int(1);'+cr+
 *   'const int list_2 = int(2);'+cr+
 *   'const int list[list_l] = int[list_l](list_0, list_1, list_2);\n'+
 *   '#define list_i(i) list[i]\n';
 * ```
 *
 * @param {string} type The `GLSL` list data-type.
 * @param {string} name The name of the `GLSL` list variable.
 * @param {array<number,array<number>>} a The list of `GLSL` values.
 * @param {string} [qualify=''] A `GLSL` qualifier, if needed.
 * @param {string} [init=type] A data-type initialiser, `type` by default.
 *
 * @returns {string} The `GLSL3` array declaration string.
 */
export const getGLSL3List = (type, name, a, qualify = '', init = type) =>
  getGLSLListBase(type, name, a, qualify, init)+cr+
  (qualify && qualify+' ')+type+` ${name}[${name}_l] = ${init}[${name}_l](${
    reduce((s, _, i) => (s && s+', ')+name+'_'+i, a, '')});\n`+
  `#define ${name}_i(i) ${name}[i]\n`;

/**
 * Creates a `GLSL` definition of an array, and initialises it with the given
 * values, type, and variable name.
 *
 * The initialisation is valid `GLSL1` or greater syntax; but is written with
 * escaped new-lines so it may be used in a single-line (e.g: for preprocessor
 * macros).
 *
 * For a `qualify` of `const` on any `GLSL` < 3, falls back to using non-array
 * variables with the index appended to `name`, since `const` arrays aren't
 * supported before `GLSL3`.
 *
 * @see {@link getGLSL3List}
 * @see {@link getGLSL1ListLike}
 * @see {@link getGLSL1ListArray}
 *
 * @example ```
 *   getGLSLList('int', 'test', [0, 1]); // =>
 *   'const int test_l = 2;'+cr+
 *   'int test_0 = int(0);'+cr+
 *   'int test_1 = int(1);'+cr+
 *   'int test[test_l];'+cr+
 *   'test[0] = test_0;'+cr+
 *   'test[1] = test_1;\n'+
 *   '#define test_i(i) test[i]\n';
 *
 *   getGLSLList('ivec2', 'vecs', [[1, 0], [0, 1]], 'const', 3); // =>
 *   'const int vecs_l = 2;'+cr+
 *   'ivec2 vecs_0 = ivec2(1, 0);'+cr+
 *   'ivec2 vecs_1 = ivec2(0, 1);'+cr+
 *   'const ivec2 vecs[vecs_l] = ivec2[vecs_l](vecs_0, vecs_1);\n'+
 *   '#define vecs_i(i) vecs[i]\n';
 *
 *   getGLSLList('int', 'listLike', [0, 1], 'const', 1); // =>
 *   'const int listLike_l = 2;'+cr+
 *   'const int listLike_0 = int(0);'+cr+
 *   'const int listLike_1 = int(1);\n'+
 *   '// Index macro `listLike_i` (e.g: `listLike_i(0)`) may be slow, `+
 *     'use name (e.g: `listLike_0`) if possible.\n'+
 *   '#define listLike_i(i) ((i == 1)? listLike_1 : listLike_0)\n';
 * ```
 *
 * @param {string} type The `GLSL` list data-type.
 * @param {string} name The name of the `GLSL` list variable.
 * @param {array<number,array<number>>} a The list of `GLSL` values.
 * @param {string} [qualify=''] A `GLSL` qualifier, if needed (e.g: `const`).
 * @param {number} [glsl=1] The `GLSL` version to target, if specified.
 * @param {string} [init] A data-type initialiser.
 *
 * @returns {string} The `GLSL` (1 or 3) array or array-like declaration string.
 */
export const getGLSLList = (type, name, a, qualify = '', glsl = 1, init) =>
  ((glsl >= 3)? getGLSL3List
  : ((qualify.trim() === 'const')? getGLSL1ListLike : getGLSL1ListArray))
    (type, name, a, qualify, init);

/**
 * Defines the values within textures per-step, as `GLSL` preprocessor macros.
 *
 * These macros define mappings from values to their textures and channels.
 * Caches the result if `macros` generation is enabled, to help reuse shaders.
 *
 * @see {@link hasMacros}
 * @see {@link maps.mapGroups}
 * @see {@link state.getState}
 *
 * @example ```
 *   const maps = { values: [2, 4, 1], channelsMax: 4 };
 *
 *   // No optimisations - values not packed, single texture output per pass.
 *   const state = {
 *     pre: '', steps: 2, maps: mapGroups({ ...maps, buffersMax: 1, packed: 0 })
 *   };
 *
 *   macroValues(state); // =>
 *   '#define texture_0 0\n'+
 *   '#define channels_0 rg\n'+
 *   '\n'+
 *   '#define texture_1 1\n'+
 *   '#define channels_1 rgba\n'+
 *   '\n'+
 *   '#define texture_2 2\n'+
 *   '#define channels_2 r\n'+
 *   '\n'+
 *   '#define textures 3\n'+
 *   '#define passes 3\n'+
 *   '#define stepsPast 1\n'+
 *   '#define steps 2\n'+
 *   '\n';
 *
 *   // Automatically packed values - values across fewer textures/passes.
 *   state.maps = mapGroups({ ...maps, buffersMax: 1 });
 *   state.size = { count: 2**5 };
 *   macroValues(state); // =>
 *   '#define texture_1 0\n'+
 *   '#define channels_1 rgba\n'+
 *   '\n'+
 *   '#define texture_0 1\n'+
 *   '#define channels_0 rg\n'+
 *   '\n'+
 *   '#define texture_2 1\n'+
 *   '#define channels_2 b\n'+
 *   '\n'+
 *   '#define count 32\n'+
 *   '#define textures 2\n'+
 *   '#define passes 2\n'+
 *   '#define stepsPast 1\n'+
 *   '#define steps 2\n'+
 *   '\n';
 *
 *   // Can bind more texture outputs per pass - values across fewer passes.
 *   state.maps = mapGroups({ ...maps, buffersMax: 4 });
 *   macroValues(state); // =>
 *   '#define texture_1 0\n'+
 *   '#define channels_1 rgba\n'+
 *   '\n'+
 *   '#define texture_0 1\n'+
 *   '#define channels_0 rg\n'+
 *   '\n'+
 *   '#define texture_2 1\n'+
 *   '#define channels_2 b\n'+
 *   '\n'+
 *   '#define count 32\n'+
 *   '#define textures 2\n'+
 *   '#define passes 1\n'+
 *   '#define stepsPast 1\n'+
 *   '#define steps 2\n'+
 *   '\n';
 * ```
 *
 * @param {object} state Properties used to generate the macros. See `getState`.
 * @param {string} [on] Any further macro `hooks` specifier; if given, both
 *   the hook key and this specifier are checked (e.g: `key` and `key_on`).
 * @param {string|function|object|false} [state.macros] How macros are handled
 *   or prefixed. See `hasMacros`.
 * @param {string} [state.pre=preDef] Macros prefix; `preDef` if not given.
 * @param {object} state.maps How values are grouped per-texture per-pass
 *   per-step.
 * @param {array<number>} state.maps.values How values of each data item are
 *   grouped into textures. See `mapGroups`.
 * @param {array<array<number>>} state.maps.textures The groupings of values
 *   into textures. See `mapGroups`.
 * @param {array} state.maps.passes Passes drawn per-step. See `mapGroups`.
 * @param {array|number} state.steps States drawn across frames. See `getState`.
 * @param {number} [state.bound=boundDef] How many steps are bound as outputs,
 *   unavailable as inputs.
 * @param {object} [state.size] Any size information about the GL resources.
 * @param {number} [state.size.count] The number of data entries per texture
 *   (the texture's area), if given. See `getState`.
 *
 * @returns {string} The `GLSL` preprocessor macros defining the mappings from
 *   values to textures/channels.
 */
export function macroValues(state, on) {
  const key = hooks.macroValues;
  const hook = hasMacros(state, key, on);

  if(hook !== null) { return hook; }

  const { maps, steps, bound = boundDef, size, pre: n = preDef } = state;
  const { values, textures, passes: { length: passesL } } = maps;
  const stepsL = steps.length ?? steps;
  const count = size?.count;

  const c = `${key}:${n},${bound},${id(values)},${id(textures)},${stepsL},${
    passesL},${count}`;

  return (cache[c] ??=
    reduce((s, texture, t, _, i = 0) => reduce((s, v) =>
          s+`#define ${n}texture_${v} ${t}\n`+
          `#define ${n}channels_${v} ${rgba.slice(i, (i += values[v]))}\n\n`,
        texture, s),
      textures, '')+
    ((count)? `#define count ${count}\n` : '')+
    `#define ${n}textures ${textures.length}\n`+
    `#define ${n}passes ${passesL}\n`+
    `#define ${n}stepsPast ${stepsL-bound}\n`+
    `#define ${n}steps ${stepsL}\n`+
    `#define ${n}bound ${bound}\n\n`);
}

/**
 * Defines the outputs being drawn to per-pass, as `GLSL` preprocessor macros.
 *
 * These macros define mappings from values to their outputs, if bound.
 * Caches the result if `macros` generation is enabled, to help reuse shaders.
 *
 * @see {@link hasMacros}
 * @see {@link maps.mapGroups}
 * @see {@link state.getState}
 *
 * @example ```
 *   const maps = { values: [2, 4, 1], channelsMax: 4 };
 *
 *   // No optimisations - values not packed, single texture output per pass.
 *   const state = {
 *     pre: '', passNow: 0,
 *     maps: mapGroups({ ...maps, buffersMax: 1, packed: 0 })
 *   };
 *
 *   macroOutput(state); // =>
 *   '#define passNow 0\n'+
 *   '\n'+
 *   '#define bound_0 0\n'+
 *   '#define attach_0 0\n'+
 *   '#define output_0 gl_FragData[attach_0].rg\n'+
 *   '\n';
 *
 *   // Automatically packed values - values across fewer textures/passes.
 *   state.maps = mapGroups({ ...maps, buffersMax: 1 });
 *   macroOutput(state); // =>
 *   '#define passNow 0\n'+
 *   '\n'+
 *   '#define bound_1 0\n'+
 *   '#define attach_1 0\n'+
 *   '#define output_1 gl_FragData[attach_1].rgba\n'+
 *   '\n';
 *
 *   // Next pass in this step.
 *   ++state.passNow;
 *   macroOutput(state); // =>
 *   '#define passNow 1\n'+
 *   '\n'+
 *   '#define bound_0 1\n'+
 *   '#define attach_0 0\n'+
 *   '#define output_0 gl_FragData[attach_0].rg\n'+
 *   '\n'+
 *   '#define bound_2 1\n'+
 *   '#define attach_2 0\n'+
 *   '#define output_2 gl_FragData[attach_2].b\n'+
 *   '\n';
 *
 *   // Can bind more texture outputs per pass - values across fewer passes.
 *   state.maps = mapGroups({ ...maps, buffersMax: 4 });
 *   state.passNow = 0;
 *   macroOutput(state); // =>
 *   '#define passNow 0\n'+
 *   '\n'+
 *   '#define bound_1 0\n'+
 *   '#define attach_1 0\n'+
 *   '#define output_1 gl_FragData[attach_1].rgba\n'+
 *   '\n'+
 *   '#define bound_0 1\n'+
 *   '#define attach_0 1\n'+
 *   '#define output_0 gl_FragData[attach_0].rg\n'+
 *   '\n'+
 *   '#define bound_2 1\n'+
 *   '#define attach_2 1\n'+
 *   '#define output_2 gl_FragData[attach_2].b\n'+
 *   '\n';
 * ```
 *
 * @param {object} state Properties for generating the macros. See `getState`:
 * @param {string} [on] Any further macro `hooks` specifier; if given, both
 *   the hook key and this specifier are checked (e.g: `key` and `key_on`).
 * @param {string|function|object|false} [state.macros] How macros are handled.
 *   See `hasMacros`.
 * @param {string} [state.pre=preDef] Macros prefix; `pre` if not given.
 * @param {number} state.passNow The index of the currently active pass.
 * @param {object} state.maps How values are grouped per-texture per-pass
 *   per-step. See `mapGroups`.
 * @param {array<number>} state.maps.values How values of each data item may be
 *   grouped into textures across passes. See `mapGroups`.
 * @param {array<array<number>>} state.maps.textures The groupings of values
 *   into textures. See `mapGroups`.
 * @param {array<array<number>>} state.maps.passes The groupings of textures
 *   into passes. See `mapGroups`.
 *
 * @returns {string} The `GLSL` preprocessor macros for the pass's bound outputs.
 */
export function macroOutput(state, on) {
  const key = hooks.macroOutput;
  const hook = hasMacros(state, key, on);

  if(hook !== null) { return hook; }

  const { passNow: p, maps, pre: n = preDef } = state;
  const { values, textures, passes } = maps;
  const pass = passes[p];
  const c = `${key}:${n},${p},${id(values)},${id(textures)},${id(passes)}`;

  return (cache[c] ??=
    `#define ${n}passNow ${p}\n`+
    reduce((s, texture, bound, _, i = 0) => reduce((s, v) =>
          s+'\n'+
          `#define ${n}bound_${v} ${texture}\n`+
          `#define ${n}attach_${v} ${bound}\n`+
          `#define ${n}output_${v} gl_FragData[${n}attach_${v}].${
            rgba.slice(i, i += values[v])}\n`,
        textures[texture], s),
      pass, '')+'\n');
}

/**
 * Defines the texture samples/reads per-pass, as `GLSL` preprocessor macros.
 *
 * The macros define the mapping between the values and those they derive from,
 * as step/texture locations in a `samples` list, and indexes to read values
 * from sampled data in a `reads` list (once sampled into a `data` list, as in
 * `macroTaps` or similar).
 *
 * They're set up as function-like macros that may be called from the shader to
 * initialise the mappings arrays with a given name.
 * Caches the result if `macros` generation is enabled, to help reuse shaders.
 *
 * @see {@link macroTaps}
 * @see {@link hasMacros}
 * @see {@link getGLSLList}
 * @see {@link maps.mapFlow}
 * @see {@link state.getState}
 *
 * @example ```
 *   const values = [2, 4, 1];
 *   const derives = [2, , [[1, 0], true]];
 *   const maps = { values, derives, channelsMax: 4 };
 *
 *   // No optimisations - values not packed, single texture output per pass.
 *   const state =
 *     { pre: '', maps: mapFlow({ ...maps, buffersMax: 1, packed: 0 }) };
 *
 *   // Uses the first pass by default.
 *   macroSamples(state); // =>
 *   '#define useSamples'+cr+
 *     'const int samples_l = 1;'+cr+
 *     'const ivec2 samples_0 = ivec2(0, 2);\n'+
 *   '// Index macro `samples_i` (e.g: `samples_i(0)`) may be slow, '+
 *     'use name (e.g: `samples_0`) if possible.\n'+
 *   '#define samples_i(i) samples_0\n'+
 *   '\n'+
 *   '#define useReads_0'+cr+
 *     'const int reads_0_l = 1;'+cr+
 *     'const int reads_0_0 = int(0);\n'+
 *   '// Index macro `reads_0_i` (e.g: `reads_0_i(0)`) may be slow, '+
 *     'use name (e.g: `reads_0_0`) if possible.\n'+
 *   '#define reads_0_i(i) reads_0_0\n'+
 *   '\n';
 *
 *   // Next pass in this step - no derives, no samples nor reads.
 *   state.passNow = 1;
 *   macroSamples(state); // =>
 *   '';
 *
 *   // Next pass in this step.
 *   ++state.passNow;
 *   macroSamples(state); // =>
 *   '#define useSamples'+cr+
 *     'const int samples_l = 4;'+cr+
 *     'const ivec2 samples_0 = ivec2(1, 0);'+cr+
 *     'const ivec2 samples_1 = ivec2(0, 0);'+cr+
 *     'const ivec2 samples_2 = ivec2(0, 1);'+cr+
 *     'const ivec2 samples_3 = ivec2(0, 2);\n'+
 *   '// Index macro `samples_i` (e.g: `samples_i(0)`) may be slow, '+
 *     'use name (e.g: `samples_0`) if possible.\n'+
 *   '#define samples_i(i) ((i == 3)? samples_3 : ((i == 2)? samples_2 '+
 *     ': ((i == 1)? samples_1 : samples_0)))\n'+
 *   '\n'+
 *   '#define useReads_2'+cr+
 *     'const int reads_2_l = 4;'+cr+
 *     'const int reads_2_0 = int(0);'+cr+
 *     'const int reads_2_1 = int(1);'+cr+
 *     'const int reads_2_2 = int(2);'+cr+
 *     'const int reads_2_3 = int(3);\n'+
 *   '// Index macro `reads_2_i` (e.g: `reads_2_i(0)`) may be slow, '+
 *     'use name (e.g: `reads_2_0`) if possible.\n'+
 *   '#define reads_2_i(i) ((i == 3)? reads_2_3 : ((i == 2)? reads_2_2 '+
 *     ': ((i == 1)? reads_2_1 : reads_2_0)))\n'+
 *   '\n';
 *
 *   // Automatically packed values - values across fewer textures/passes.
 *   // Can bind more texture outputs per pass - values across fewer passes.
 *   // Also fewer samples where values share derives or textures.
 *   state.maps = mapGroups({ ...maps, buffersMax: 4 });
 *   state.passNow = 0;
 *   macroSamples(state); // =>
 *   '#define useSamples'+cr+
 *     'const int samples_l = 3;'+cr+
 *     'const ivec2 samples_0 = ivec2(0, 1);'+cr+
 *     'const ivec2 samples_1 = ivec2(1, 1);'+cr+
 *     'const ivec2 samples_2 = ivec2(0, 0);\n'+
 *   '// Index macro `samples_i` (e.g: `samples_i(0)`) may be slow, '+
 *     'use name (e.g: `samples_0`) if possible.\n'+
 *   '#define samples_i(i) '+
 *     '((i == 2)? samples_2 : ((i == 1)? samples_1 : samples_0))\n'+
 *   '\n'+
 *   '#define useReads_0'+cr+
 *     'const int reads_0_l = 1;'+cr+
 *     'const int reads_0_0 = int(0);\n'+
 *   '// Index macro `reads_0_i` (e.g: `reads_0_i(0)`) may be slow, '+
 *     'use name (e.g: `reads_0_0`) if possible.\n'+
 *   '#define reads_0_i(i) reads_0_0\n'+
 *   '\n'+
 *   '#define useReads_2'+cr+
 *     'const int reads_2_l = 4;'+cr+
 *     'const int reads_2_0 = int(1);'+cr+
 *     'const int reads_2_1 = int(0);'+cr+
 *     'const int reads_2_2 = int(2);'+cr+
 *     'const int reads_2_3 = int(0);\n'+
 *   '// Index macro `reads_2_i` (e.g: `reads_2_i(0)`) may be slow, '+
 *     'use name (e.g: `reads_2_0`) if possible.\n'+
 *   '#define reads_2_i(i) ((i == 3)? reads_2_3 : ((i == 2)? reads_2_2 '+
 *     ': ((i == 1)? reads_2_1 : reads_2_0)))\n'+
 *   '\n';
 * ```
 *
 * @param {object} state Properties used to generate the macros. See `getState`.
 * @param {string} [on] Any further macro `hooks` specifier; if given, both the
 *   hook key and this specifier are checked (e.g: `key` and `key_on`).
 * @param {string|function|object|false} [state.macros] How macros are handled.
 *   See `hasMacros`.
 * @param {string} [state.pre=preDef] Macros prefix; `preDef` if not given.
 * @param {number} [state.passNow=0] The index of the currently active pass;
 *   uses the first pass if not given.
 * @param {object} state.maps  How `values` are grouped per-texture per-pass
 *   per-step. See `mapGroups`.
 * @param {array<array<array<number>>>} [state.maps.samples] The minimal set of
 *   texture samples to use. See `mapSamples`.
 * @param {array<array<array<number>>>} [state.maps.reads] The mappings from
 *   values to the corresponding `state.samples`. See `mapSamples`.
 * @param {number} [state.glsl=1] The `GLSL` language version.
 *   See `getGLSLList`.
 *
 * @returns {string} The `GLSL` preprocessor macros defining the mappings for
 *   samples and reads, for each value.
 */
export function macroSamples(state, on) {
  const key = hooks.macroSamples;
  const hook = hasMacros(state, key, on);

  if(hook !== null) { return hook; }

  const { passNow: p = 0, maps, glsl, pre: n = preDef } = state;
  const { samples, reads } = maps;
  const passSamples = samples?.[p];
  const passReads = reads?.[p];
  const c = `${key}:${n},${p},${id(passSamples)},${id(passReads)},${glsl}`;

  return (cache[c] ??=
    ((!passSamples)? ''
    : `#define ${n}useSamples${cr+
        getGLSLList('ivec2', n+'samples', passSamples, 'const', glsl)}\n`)+
    ((!passReads)? ''
    : reduce((s, reads, v) =>
          `${s}#define ${n}useReads_${v}${cr+
            getGLSLList('int', n+'reads_'+v, reads, 'const', glsl)}\n`,
        passReads, '')));
}

/**
 * Defines the samples of textures per-pass, as `GLSL` preprocessor macros.
 *
 * The macros define the minimal sampling of textures for the data the active
 * pass's values derive from; creates a `data` list containing the samples; the
 * `samples` list variable names are required as created by `macroSamples`.
 *
 * Handles sampling states in a flat array of textures, or merged in one texture
 * (in both `sampler2D`, and `sampler3D`/`sampler2DArray` where supported).
 * Merging allows shaders to access past steps by non-constant lookups; e.g:
 * attributes cause `sampler array index must be a literal expression` on
 * `GLSL3` spec and other platforms (e.g: `D3D`); note these need texture repeat
 * wrapping.
 *
 * They're set up as function-like macros that may be called from the shader to
 * initialise the mappings arrays with a given name.
 * Caches the result if `macros` generation is enabled, to help reuse shaders.
 *
 * @see [`sampler array index must be a literal expression`](https://stackoverflow.com/a/60110986/716898)
 * @see [`sampler2DArray`](https://github.com/WebGLSamples/WebGL2Samples/blob/master/samples/texture_2d_array.html)
 * @see [`sampler3D`](https://github.com/WebGLSamples/WebGL2Samples/blob/master/samples/texture_3d.html)
 *
 * @see {@link macroSamples}
 * @see {@link hasMacros}
 * @see {@link getGLSLList}
 * @see {@link maps.mapFlow}
 * @see {@link state.getState}
 * @see {@link inputs.getUniforms}
 *
 * @example ```
 *   const values = [2, 4, 1];
 *   const derives = [2, , [[1, 0], true]];
 *   const maps = { values, derives, channelsMax: 4 };
 *
 *   // No optimisations - values not packed, single texture output per pass.
 *   const state =
 *     { pre: '', maps: mapFlow({ ...maps, buffersMax: 1, packed: 0 }) };
 *
 *   // Uses the first pass by default.
 *   macroTaps(state); // =>
 *   '@todo';
 *
 *   // Next pass in this step - no derives, no samples nor reads.
 *   state.passNow = 1;
 *   macroTaps(state); // =>
 *   '';
 *
 *   // Next pass in this step.
 *   ++state.passNow;
 *   macroTaps(state); // =>
 *   '@todo';
 *
 *   // Automatically packed values - values across fewer textures/passes.
 *   // Can bind more texture outputs per pass - values across fewer passes.
 *   // Also fewer samples where values share derives or textures.
 *   state.maps = mapGroups({ ...maps, buffersMax: 4 });
 *   state.passNow = 0;
 *   macroTaps(state); // =>
 *   '@todo';
 * ```
 *
 * @param {object} state Properties used to generate the macros. See `getState`.
 * @param {string} [on] Any further macro `hooks` specifier; if given, both
 *   the hook key and this specifier are checked (e.g: `key` and `key_on`).
 * @param {string|function|object|false} [state.macros] How macros are handled.
 *   See `hasMacros`.
 * @param {string} [state.pre=preDef] Macros prefix; `preDef` if not given.
 * @param {number} [state.passNow=0] The index of the currently active pass;
 *   uses the first pass if not given.
 * @param {object} state.maps  How `values` are grouped per-texture per-pass
 *   per-step. See `mapGroups`.
 * @param {array<array<array<number>>>} [state.maps.samples] The minimal set of
 *   texture samples to use. See `mapSamples`.
 * @param {object} [state.merge] Any merged state texture; uses separate state
 *   textures if not given. See `getState`.
 * @param {number} [state.glsl=1] The `GLSL` language version.
 *   See `getGLSLList`.
 *
 * @returns {string} The `GLSL` preprocessor macros defining the minimal
 *   sampling of textures, to suit how states are stored (array of textures, or
 *   all merged into one texture) and supported `GLSL` language features.
 */
export function macroTaps(state, on) {
  const key = hooks.macroTaps;
  const hook = hasMacros(state, key, on);

  if(hook !== null) { return hook; }

  const { passNow: p = 0, maps, merge, glsl, pre: n = preDef } = state;
  const passSamples = maps.samples?.[p];
  const index = !merge;
  const c = `${key}:${n},${p},${id(passSamples)},${index},${glsl}`;
  const cached = cache[c];

  if(cached != undefined) { return cached; }

  const glsl3 = (glsl >= 3);
  /** Which texture sampling function is available. */
  const texture = 'texture'+((glsl3)? '' : '2D');
  /** Short and common names for functions and parameters. */
  const f = n+'tapState';
  const tap = '#define '+f;

  /**
   * Common parameters; the full ordered parameters can be up to:
   * (uv, states, stepNow, steps, textures, stepBy, textureBy)
   */
  const by = `stepBy, textureBy`;

  /** Aliases default names for brevity, main functions offer more control. */
  const aka = `#define ${f}(uv)${cr+f}`;
  const akaBy = `#define ${f}By(uv, ${by})${cr+f}`;
  /** The current `sample`, as `[step, texture]`. */
  const st = n+'samples_';
  /** Prefix for private temporary variables. */
  const t = '_'+n;
  /** A temporary array to pass to `getGLSLList`. */
  const tapsSamples = cache[key+'Samples'] ??= [];
  const tapsL = tapsSamples.length = passSamples?.length ?? 0;

  /** The texture-sampling logic. */
  return (cache[c] = ((index)? '' : `#define ${n}mergedStates\n\n`)+
    ((!tapsL)? ''
    : ((index)?
      /** Separate un-merged textures accessed by constant index. */
      '// States in a `sampler2D[]`; looks up 1D index and 2D `uv`; '+cr+
        'past steps go later in the list.\n'+
      `// Pass constant array index values; \`textures\`.\n`+
      `// Use \`${n}data\` list; ignore temporary \`${t}\` names.\n`+
      tap+`s(uv, states, textures)`+cr+
        // Compute before the loop for lighter work.
        `const int ${t}tlI = int(textures);`+cr+
        `vec2 ${t}uvI = vec2(uv);`+cr+
        // Sample into the `data` output list.
        getGLSLList('vec4', n+'data',
          map((_, i) => texture+
              // Offset step, texture.
              `(states[(int(${st+i}.s)*${t}tlI)+int(${st+i}.t)], ${t}uvI)`,
            passSamples, tapsSamples),
          '', glsl)+'\n'+
      '// States may also be sampled by shifted step/texture.\n'+
      `// Pass constant array index values; \`textures, ${by}\`.\n`+
      `// Use \`${n}data\` list; ignore temporary \`${t}\` names.\n`+
      tap+`sBy(uv, states, textures, ${by})`+cr+
        // Compute before the loop for lighter work.
        `const int ${t}tlIB = int(textures);`+cr+
        `ivec2 ${t}byIB = ivec2(${by});`+cr+
        `vec2 ${t}uvIB = vec2(uv);`+cr+
        // Sample into the `data` output list.
        getGLSLList('vec4', n+'data',
          map((_, i) =>
              texture+'(states['+
                  // Offset step.
                  `((int(${st+i}.s)+${t}byIB.s)*${t}tlIB)+`+
                  // Offset texture.
                  `int(${st+i}.t)+${t}byIB.t`+
                `], ${t}uvIB)`,
            passSamples, tapsSamples),
          '', glsl)+'\n'+
      '// Preferred aliases: index suits states array constant access.\n'+
      aka+`s(uv, ${n}states, ${n}textures)\n`+
      akaBy+`sBy(uv, ${n}states, ${n}textures, ${by})\n`
    : /** Merged 2D texture. */
      '// States merged to a `sampler2D`, scales 2D `uv` over '+
        '`[textures, steps]`.\n'+
      '// Step from now into the past going upwards in the texture.\n'+
      `// Use \`${n}data\` list; ignore temporary \`${t}\` names.\n`+
      tap+`2(uv, states, stepNow, steps, textures)`+cr+
        // Compute before the loop for lighter work.
        `vec2 ${t}l2 = vec2(textures, steps);`+cr+
        `vec2 ${t}uv2 = vec2(uv)/${t}l2;`+cr+
        // Steps advance in reverse, top-to-bottom.
        `vec2 ${t}s2 = vec2(1, -1)/${t}l2;`+cr+
        // Offset texture, step.
        // Each step stored in texture top downward at `-stepNow`.
        // Most recent step to look up is at `-stepNow+1`.
        `vec2 ${t}i2 = vec2(0, 1)-vec2(0, stepNow);`+cr+
        // Sample into the `data` output list.
        getGLSLList('vec4', n+'data',
          // Would repeat wrap; but `WebGL1` needs power-of-2.
          map((_, i) =>
              texture+`(states, `+
                // Offset texture, step.
                `fract(${t}uv2+fract((vec2(${st+i}).ts+${t}i2)*${t}s2)))`,
            passSamples, tapsSamples),
          '', glsl)+'\n'+
      '// States may also be sampled by shifted step/texture.\n'+
      `// Use \`${n}data\` list; ignore temporary \`${t}\` names.\n`+
      tap+`2By(uv, states, stepNow, steps, textures, ${by})`+cr+
        // Compute before the loop for lighter work.
        `vec2 ${t}l2B = vec2(textures, steps);`+cr+
        `vec2 ${t}uv2B = vec2(uv)/${t}l2B;`+cr+
        // Steps advance in reverse, top-to-bottom.
        `vec2 ${t}s2B = vec2(1, -1)/${t}l2B;`+cr+
        // Offset texture, step.
        // Each step stored in texture top downward at `-stepNow`.
        // Most recent step to look up is at `-stepNow+1`.
        `vec2 ${t}i2B = vec2(${by}).ts+vec2(0, 1)-vec2(0, stepNow);`+cr+
        // Sample into the `data` output list.
        getGLSLList('vec4', n+'data',
          // Would repeat wrap; but `WebGL1` needs power-of-2.
          map((_, i) =>
              texture+`(states, `+
                // Offset texture, step.
                `fract(${t}uv2B+fract((vec2(${st+i}).ts+${t}i2B)*${t}s2B)))`,
            passSamples, tapsSamples),
          '', glsl)+'\n'+
      ((!glsl3)?
        '// Preferred aliases: 2D suits merged texture in GLSL < 1.\n'+
        aka+`2(uv, ${n}states, ${n}stepNow, ${n}steps, ${n}textures)\n`+
        akaBy+
          `2By(uv, ${n}states, ${n}stepNow, ${n}steps, ${n}textures, ${by})\n`
      : /**
         * Merged 3D texture types, supported from `GLSL3`.
         * @todo Check and finish this.
         */
        '// States merged to `sampler3D` or `sampler2DArray`; 2D `uv` '+
          'to 3D; scales `x` over `textures`, `z` over `steps` as:\n'+
        '// - `sampler3D`: the number of steps; depth, `[0, 1]`.\n'+
        '// - `sampler2DArray`: `1` or less; layer, `[0, steps-1]`.\n'+
        `// Use \`${n}data\` list; ignore temporary \`${t}\` names.\n`+
        tap+`3(uv, states, stepNow, steps, textures)`+cr+
          /** @see `...2()` above. */
          // Compute before the loop for lighter work.
          `vec2 ${t}l3 = vec2(textures, steps);`+cr+
          `vec2 ${t}uv3 = vec2(uv)/${t}l3;`+cr+
          // Offset texture.
          `float ${t}sx3 = 1.0/${t}l3.x;`+cr+
          // Offset step.
          `float ${t}s3 = -float(stepNow);`+cr+
          `float ${t}sz3 = -1.0/${t}l3;`+cr+
          // Sample into the `data` output list.
          getGLSLList('vec4', n+'data',
            // Would repeat wrap; but `sampler2DArray` layer can't.
            map((_, i) =>
                texture+'(states, fract(vec3('+
                  // Offset texture.
                  `${t}uv3.x+(float(${st+i}.t)*${t}sx3), ${t}uv3.y, `+
                  // Offset step: `sampler3D` depth, `[0, 1]`;
                  // `sampler2DArray` layer, `[0, steps-1]`.
                  `(float(${st+i}.s)+${t}s3)*${t}sz3)))`,
              passSamples, tapsSamples),
            '', glsl)+'\n'+
        '// States may also be sampled by shifted step/texture.\n'+
        `// Use \`${n}data\` list; ignore temporary \`${t}\` names.\n`+
        tap+`3By(uv, states, stepNow, steps, textures, ${by})`+cr+
          /** @see `...2By()` above. */
          // Compute before the loop for lighter work.
          `vec2 ${t}l3B = vec2(textures, steps);`+cr+
          `vec2 ${t}uv3B = (vec2(uv)+vec2(textureBy, 0))/${t}l3B;`+cr+
          // Offset texture.
          `float ${t}sx3B = 1.0/${t}l3B.x;`+cr+
          // Offset step.
          `float ${t}s3B = float(stepBy)-float(stepNow);`+cr+
          `float ${t}sz3B = -1.0/${t}l3B;`+cr+
          // Sample into the `data` output list.
          getGLSLList('vec4', n+'data',
            // Would repeat wrap; but `sampler2DArray` layer can't.
            map((_, i) =>
                texture+'(states, fract(vec3('+
                  // Offset texture.
                  `${t}uv3B.x+(float(${st+i}.t)*${t}sx3B), ${t}uv3B.y, `+
                  // Offset step: `sampler3D` depth, `[0, 1]`;
                  // `sampler2DArray` layer, `[0, steps-1]`.
                  `(float(${st+i}.s)+${t}s3B)*${t}sz3B)))`,
              passSamples, tapsSamples),
            '', glsl)+'\n'+
        '// Preferred aliases: 3D suits merged texture in `GLSL` 3+.\n'+
        aka+`3(uv, ${n}states, ${n}stepNow, ${n}steps, ${n}textures)\n`+
        akaBy+
          `3By(uv, ${n}states, ${n}stepNow, ${n}steps, ${n}textures, ${by})\n`
      ))+'\n'));
}

/**
 * Defines all `GLSL` preprocessor macro values, texture samples, and outputs
 * for the active pass.
 *
 * The macros define the mapping between the active values, their textures and
 * channels, bound outputs, and other macros useful for a draw pass.
 * Caches the result if `macros` generation is enabled, to help reuse shaders.
 *
 * @see {@link hasMacros}
 * @see {@link macroValues}
 * @see {@link macroOutput}
 * @see {@link macroTaps}
 * @see {@link macroSamples}
 * @see {@link maps.mapFlow}
 * @see {@link state.getState}
 *
 * @example ```
 *   const values = [2, 4, 1];
 *   const derives = [2, , [[1, 0], true]];
 *
 *   // Automatically packed values - values across fewer textures/passes.
 *   // Only a single texture output per pass - values across more passes.
 *   const state = {
 *     passNow: 0, steps: 2, size: { count: 2**5 },
 *     maps: mapFlow({ values, derives, channelsMax: 4, buffersMax: 1 })
 *   };
 *
 *   macroPass(state); // =>
 *   '#define gpgpu_texture_1 0\n'+
 *   '#define gpgpu_channels_1 rgba\n'+
 *   '\n'+
 *   '#define gpgpu_texture_0 1\n'+
 *   '#define gpgpu_channels_0 rg\n'+
 *   '\n'+
 *   '#define gpgpu_texture_2 1\n'+
 *   '#define gpgpu_channels_2 b\n'+
 *   '\n'+
 *   '#define count 32\n'+
 *   '#define gpgpu_textures 2\n'+
 *   '#define gpgpu_passes 2\n'+
 *   '#define gpgpu_stepsPast 1\n'+
 *   '#define gpgpu_steps 2\n'+
 *   '\n'+
 *   '#define gpgpu_passNow 0\n'+
 *   '\n'+
 *   '#define gpgpu_bound_1 0\n'+
 *   '#define gpgpu_attach_1 0\n'+
 *   '#define gpgpu_output_1 gl_FragData[gpgpu_attach_1].rgba\n'+
 *   '\n';
 *
 *   // Next pass and extra step.
 *   ++state.steps;
 *   ++state.passNow;
 *   state.pre = '';
 *   macroPass(state); // =>
 *   '#define texture_1 0\n'+
 *   '#define channels_1 rgba\n'+
 *   '\n'+
 *   '#define texture_0 1\n'+
 *   '#define channels_0 rg\n'+
 *   '\n'+
 *   '#define texture_2 1\n'+
 *   '#define channels_2 b\n'+
 *   '\n'+
 *   '#define count 32\n'+
 *   '#define textures 2\n'+
 *   '#define passes 2\n'+
 *   '#define stepsPast 2\n'+
 *   '#define steps 3\n'+
 *   '\n'+
 *   '#define passNow 1\n'+
 *   '\n'+
 *   '#define bound_0 1\n'+
 *   '#define attach_0 0\n'+
 *   '#define output_0 gl_FragData[attach_0].rg\n'+
 *   '\n'+
 *   '#define bound_2 1\n'+
 *   '#define attach_2 0\n'+
 *   '#define output_2 gl_FragData[attach_2].b\n'+
 *   '\n'+
 *   '#define useSamples'+cr+
 *     'const int samples_l = 3;'+cr+
 *     'const ivec2 samples_0 = ivec2(0, 1);'+cr+
 *     'const ivec2 samples_1 = ivec2(1, 1);'+cr+
 *     'const ivec2 samples_2 = ivec2(0, 0);\n'+
 *   '// Index macro `samples_i` (e.g: `samples_i(0)`) may be slow, '+
 *     'use name (e.g: `samples_0`) if possible.\n'+
 *   '#define samples_i(i)'+cr+
 *     '((i == 2)? samples_2 : ((i == 1)? samples_1 : samples_0))\n'+
 *   '\n'+
 *   '#define useReads_0'+cr+
 *     'const int reads_0_l = 1;'+cr+
 *     'const int reads_0_0 = int(0);\n'+
 *   '// Index macro `reads_0_i` (e.g: `reads_0_i(0)`) may be slow, '+
 *     'use name (e.g: `reads_0_0`) if possible.\n'+
 *   '#define reads_0_i(i) reads_0_0\n'+
 *   '\n'+
 *   '#define useReads_2'+cr+
 *     'const int reads_2_l = 4;'+cr+
 *     'const int reads_2_0 = int(1);'+cr+
 *     'const int reads_2_1 = int(0);'+cr+
 *     'const int reads_2_2 = int(2);'+cr+
 *     'const int reads_2_3 = int(0);\n'+
 *   '// Index macro `reads_2_i` (e.g: `reads_2_i(0)`) may be slow, '+
 *     'use name (e.g: `reads_2_0`) if possible.\n'+
 *   '#define reads_2_i(i) ((i == 3)? reads_2_3 : ((i == 2)? reads_2_2 '+
 *     ': ((i == 1)? reads_2_1 : reads_2_0)))\n'+
 *   '\n'+
 *   '// States in a `sampler2D[]`; looks up 1D index and 2D `uv`.\n'+
 *   '@todo';
 * ```
 *
 * @param {object} state Properties for generating the macros. See `getState`
 *   and `mapGroups`.
 * @param {string} [on] Any further macro `hooks` specifier; if given, both
 *   the hook key and this specifier are checked (e.g: `key` and `key_on`).
 *
 * @returns {string} The `GLSL` preprocessor macros defining the mappings for
 *   values, textures, channels, bound outputs of the active pass, etc. See
 *   `macroValues`, `macroOutput`, and `macroSamples`.
 */
export const macroPass = (state, on) =>
  hasMacros(state, hooks.macroPass, on) ??
    macroValues(state)+macroOutput(state)+macroSamples(state)+macroTaps(state);

export default macroPass;
