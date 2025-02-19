/**
 * The update step for a GPGPU particle simulation.
 * Requires setup with preprocessor macros - see `macroPass`.
 * Executed in one or more passes; each chunk depending on a `gpgpu` macro may
 * be combined with others into one pass or separated into its own pass; `gpgpu`
 * preprocessor macros control the combination according to which `values` are
 * currently bound for `output` to the next `state`.
 *
 * @see {@link step.getStep}
 * @see {@link macros.macroPass}
 */

#ifdef GL_EXT_draw_buffers
  #extension GL_EXT_draw_buffers : require
#endif

precision highp float;

// Setting up the macros and aliases `gl-gpgpu` provides.

// Note that these `texture_i`/`channels_i`/`reads_i_j` indexes correspond to a
// value at that index in the `values`/`derives` arrays provided to `gl-gpgpu`;
// they are defined here to match that arrangement.

// The texture channels each of the `values` is stored in.
#define positionChannels channels_0
#define motionChannels channels_1
#define lifeChannels channels_2

/** Set up sampling logic via `gl-gpgpu` macro. */
useSamples

// Set up minimal texture reads logic; only read what a value with a currently
// bound output `derives` from other `values` for its next state.
// See `derives` for indexing `reads_${bound value index}_${derives index}`.
#ifdef output_0
  #define positionOutput output_0
  useReads_0
  #define positionReadPosition0 reads_0_0
  #define positionReadPosition1 reads_0_1
  #define positionReadMotion reads_0_2
  #define positionReadLife reads_0_3
#endif
#ifdef output_1
  #define motionOutput output_1
  useReads_1
  #define motionReadMotion reads_1_0
  #define motionReadLife reads_1_1
  #define motionReadPosition reads_1_2
#endif
#ifdef output_2
  #define lifeOutput output_2
  useReads_2
  #define lifeReadLifeLast reads_2_0
  #define lifeReadLife1 reads_2_1
#endif

// The main shader.

// States from `gl-gpgpu`; in separate textures or merged.
#ifdef mergedStates
  uniform sampler2D states;
#else
  uniform sampler2D states[stepsPast*textures];
#endif

/** The current step from `gl-gpgpu`. */
uniform float stepNow;

// Custom inputs for this demo.

uniform float dt0;
uniform float dt1;
uniform float loop;
/** A particle's lifetime range, and whether it's allowed to respawn. */
uniform vec3 lifetime;
uniform float useVerlet;
uniform float epsilon;
uniform float moveCap;
uniform vec2 scale;
uniform vec2 spout;
uniform vec3 source;
/** Sink position, and universal gravitational constant. */
uniform vec4 sink;
/** Constant acceleration of gravity; and whether to use it or the `sink`. */
uniform vec4 g;
// uniform vec3 drag;

varying vec2 uv;

#pragma glslify: map = require(glsl-map)
#pragma glslify: le = require(glsl-conditionals/when_le)
#pragma glslify: random = require(glsl-random)

#ifdef positionOutput
  /** @todo Try Velocity Verlet integration. */
  #pragma glslify: verlet = require(@epok.tech/glsl-verlet/p-p-a)
#endif

#if defined(positionOutput) || defined(motionOutput)
  #pragma glslify: tau = require(glsl-constants/TWO_PI)

  /** @see [Spherical distribution](https://observablehq.com/@rreusser/equally-distributing-points-on-a-sphere) */
  vec3 randomOnSphere(float randomAngle, float randomDepth) {
    float a = randomAngle*tau;
    float u = (randomDepth*2.0)-1.0;

    return vec3(sqrt(1.0-(u*u))*vec2(cos(a), sin(a)), u);
  }
#endif

/**
 * Drag acceleration, constrained within the given velocity.
 * @see [Wikipedia on Verlet](https://en.wikipedia.org/wiki/Verlet_integration#Algorithmic_representation)
 */
// vec3 dragAcc(vec3 velocity, vec3 drag) {
//   vec3 l = abs(velocity);

//   return clamp(-0.5*sign(velocity)*dot(velocity, velocity)*drag, -l, l);
// }

void main() {
  // Sample the desired state values - creates the `data` array.
  tapState(uv)

  // Read values.

  #ifdef positionOutput
    vec3 position0 = data[positionReadPosition0].positionChannels;
  #endif

  // If reads all map to the same value sample, any of them will do.
  #if defined(positionOutput) || defined(motionOutput)
    #if defined(positionOutput)
      #define readMotion positionReadMotion
      #define readPosition positionReadPosition1
    #elif defined(motionOutput)
      #define readMotion motionReadMotion
      #define readPosition motionReadPosition
    #endif

    vec3 position1 = data[readPosition].positionChannels;
    vec3 motion = data[readMotion].motionChannels;
  #endif

  // If reads all map to the same value sample, any of them will do.
  #if defined(positionOutput)
    #define readLife positionReadLife
  #elif defined(lifeOutput)
    #define readLife lifeReadLife
  #elif defined(motionOutput)
    #define readLife motionReadLife
  #endif

  float life = data[readLife].lifeChannels;

  #ifdef lifeOutput
    float lifeLast = data[lifeReadLifeLast].lifeChannels;
  #endif

  // Update and output values.
  // Note that the update/output logic components within each `#if` macro
  // block from `gpgpu` are independent modules, as the `gpgpu` macros
  // determine whether they're executed across one or more passes - they could
  // also be coded in separate files called from here, however they're coded
  // inline here for brevity, relevance, and easy access to shared variables.

  /** Whether the particle is ready to respawn. */
  float spawn = le(life, 0.0);

  #if defined(positionOutput) || defined(motionOutput)
    // Workaround for switching Euler/Verlet; interpret `motion` data as
    // acceleration/velocity, respectively.
    vec3 velocity = motion;
    vec3 acceleration = motion;

    /** Spawn randomly on a sphere around the source, move in that direction. */
    vec3 spoutSpawn = random(loop-(uv*dt0))*
      randomOnSphere(random((uv+loop)/dt1), random((uv-loop)*dt0));
  #endif

  #ifdef positionOutput
    /** For numeric accuracy, encoded as exponent `[b, p] => b*(10**p)`. */
    float size = scale.s*pow(10.0, scale.t);

    /**
     * Constrain Verlet movement; handle here for better numerical accuracy.
     * Any position changes below the movement cap remain the same; any
     * bigger clamped towards current position, by the ratio over the limit.
     */
    vec3 back = mix(position0, position1,
      clamp((distance(position1, position0)/moveCap)-1.0, 0.0, 1.0));

    // Use either Euler integration...
    vec3 positionTo = mix(position1+(velocity*dt1*size),
      // ... or Verlet integration...
      verlet(back, position1, acceleration*size, dt0, dt1),
      // ... according to which is currently active.
      useVerlet);

    /** Spawn around the source. */
    vec3 positionSpawn = source+(spout.x*spoutSpawn);

    /** Output the next position value to its channels in the state texture. */
    positionOutput = mix(positionTo, positionSpawn, spawn);
  #endif
  #ifdef motionOutput
    /**
     * Gravitate towards the sink point (simplified).
     * @see [Wikipedia on gravitation](https://en.wikipedia.org/wiki/Newton%27s_law_of_universal_gravitation)
     */
    vec3 gravity = sink.xyz-position1;

    gravity *= sink.w/max(dot(gravity, gravity), epsilon);

    /** Use sink point, or constant acceleration due to gravity. */
    acceleration = mix(gravity, g.xyz, g.w);

    /** Can also combine other forces, e.g: drag. */
    // acceleration += dragAcc(mix(velocity, acceleration*dt1, useVerlet), drag);

    vec3 motionTo = mix(velocity+(acceleration*dt1), acceleration, useVerlet);
    vec3 motionNew = spout.y*spoutSpawn;

    /** Output the next motion value to its channels in the state texture. */
    motionOutput = mix(motionTo, motionNew, spawn);
  #endif
  #ifdef lifeOutput
    float lifeTo = max(life-dt1, 0.0);
    float lifeNew = map(random(uv*loop), 0.0, 1.0, lifetime.s, lifetime.t);
    /** Whether the oldest of this trail has faded. */
    float faded = le(lifeLast, 0.0);

    /**
     * Output the next life value to its channels in the state texture.
     * Only spawn life once the oldest step reaches the end of its lifetime
     * (past and current life are both 0), and if it's allowed to respawn.
     */
    lifeOutput = mix(lifeTo, lifeNew, spawn*faded*lifetime.z);
  #endif
}
