# Driftwood Racer
## Game Design & Technical Specification — MVP v0.1

**Status:** Pre-production / Prototype  
**Genre:** Physics sandbox, traversal, racing  
**Perspective:** Third-person 3D  
**Target:** PC, keyboard and mouse, controller later  
**Player count (MVP):** Single-player  
**Engine:** To be selected  
**Primary objective:** Prove that interacting with floating logs in a dynamic river is consistently fun.

---

# 1. Game Overview

Driftwood Racer is a surreal, physics-driven game in which the player rides giant floating logs down rivers, navigating rapids, obstacles, branching waterways, and massive waterfalls.

The character is physically independent of the log. They can walk and run on its surface, jump, grab onto it, enter the water, paddle, and transfer between logs.

The logs are free-moving rigid bodies propelled by the river. Their position, rotation, velocity, and behavior depend on their physical properties, contact with other objects, and forces applied by water and the player.

The environment is a continuous, navigable river system. Players can choose different routes, become separated from their original log, discover alternate channels, and reach destinations through emergent movement.

The experience should feel playful, unpredictable, and dreamlike, with beautiful natural environments and exaggerated but consistent physics.

## 1.1 Core Design Pillars

**1. Physical freedom**

The player and logs are separate physical entities. The player is never artificially locked to their log and can move between surfaces freely.

**2. Emergent interactions**

Steering, acceleration, balancing, jumping, and recovering should primarily arise from interactions between physics systems rather than scripted contextual actions.

**3. Continuous movement**

The river provides constant downstream momentum. The environment continues moving whether the player acts or not.

**4. No punishment for experimentation**

The player cannot die or drown. Falls, collisions, and mistakes are part of the experience. Recovery should be quick and entertaining.

**5. Exploratory traversal**

The river offers multiple paths. The player is not restricted to a single racing line, and route choices should emerge naturally.

**6. Physics that are playable, not necessarily realistic**

Believable reactions and consistency are more important than physical accuracy. Deliberate exaggeration is acceptable when it improves fun or responsiveness.

---

# 2. MVP Scope

## 2.1 Primary MVP Goal

Create a small but complete physics playground containing:

- One controllable character
- Several floating logs
- One continuous flowing river
- A branching river section with two navigable routes
- Obstacles such as rocks and riverbanks
- One significant waterfall
- A downstream endpoint

The prototype must support free movement on logs, physical interaction with them, swimming, grabbing, paddling, and recovering from falls.

## 2.2 In Scope

**Character**
- Run and walk freely on moving logs
- Jump while retaining appropriate momentum
- Grab and hold onto logs
- Climb back onto logs
- Swim and paddle through the water
- Physically influence logs through movement and contact
- Fall into water and recover

**Logs**
- Float naturally
- Translate and rotate freely
- Respond to river current
- Respond to player weight and movement
- Collide with rocks, banks, and other logs
- Travel through rapids and over waterfalls
- Continue moving when the player is not aboard

**Water**
- Move objects downstream
- Apply directional current forces
- Support buoyancy
- Accelerate through narrow river sections
- Change flow direction at turns and junctions
- Carry objects over waterfalls and into plunge pools

**Environment**
- One test river
- Multiple reachable channels
- Obstacles and collision surfaces
- A waterfall with a physically traversable drop
- Basic camera and debugging tools

## 2.3 Explicitly Out of Scope

- Multiplayer and networking
- AI opponents
- Log destruction or damage
- Racing timers and leaderboards
- Character customization
- Progression and unlocks
- Procedural world generation
- Full fluid simulation
- Large open worlds
- Complex ragdoll animation
- Detailed final art
- Inventory, crafting, or quests

These features should not affect the MVP architecture unnecessarily.

---

# 3. Core Gameplay

## 3.1 Gameplay Flow

1. The player spawns on a floating log in an upstream river section.
2. The river transports the log downstream.
3. The player moves around the log, shifting its balance and influencing its motion.
4. The player uses grabbing, paddling, jumping, and contact with the environment to navigate.
5. The river introduces curves, rocks, faster currents, junctions, and drops.
6. The player may remain on their log, fall into the water, or transfer to another log.
7. The player eventually passes over a waterfall and continues downstream.
8. The session ends upon reaching a downstream finish region.

There are no mandatory checkpoints, fixed routes, or scripted log-switching moments.

## 3.2 Camera

Use a third-person camera following the player rather than the log.

Requirements:
- Camera remains stable while logs rotate or roll.
- Camera follows player translation with configurable smoothing.
- Camera rotates around the character using mouse or right stick.
- Camera does not inherit the log's rotational movement.
- Camera adjusts distance when necessary to prevent obstruction.
- During large drops, the camera preserves visibility of the player and nearby logs.

The initial implementation can use a standard third-person orbit camera with collision handling.

---

# 4. Character Controller

## 4.1 Design Approach

The character is independently simulated and does not become a child or permanently attached component of a log.

For the MVP, use a responsive, physics-aware character controller rather than relying on an uncontrolled full ragdoll.

The player must:
- Stand on independently moving platforms
- Maintain appropriate relative motion with the surface
- Be affected by changes in platform velocity
- Apply physical forces to contacted logs
- Leave the platform naturally when jumping or losing contact

Use a hybrid character controller if necessary. Direct movement assistance is acceptable, provided contacts still affect logs and physics remain coherent.

## 4.2 Player States

The initial controller supports:

**Grounded**
Standing or running on a log, rock, bank, or other valid surface.

**Airborne**
No supported contact. Gravity and existing momentum affect movement.

**Swimming**
The character is sufficiently immersed in water and can propel themselves through it.

**Grabbing**
The character has an active physical grip on another object.

**Climbing**
The character is transitioning from hanging or swimming back onto a log.

These states are conceptual. State transitions should be driven by surface contact, immersion, and grab conditions wherever practical.

## 4.3 Provisional Controls

| Action | Keyboard / mouse |
|---|---|
| Move | WASD |
| Camera | Mouse |
| Jump | Space |
| Grab / hold | Left mouse button |
| Paddle / push | Right mouse button |
| Sprint | Shift |
| Release grip | Release left mouse button |

Exact controls are subject to playtesting.

### Moving on Logs

When the player stands on a floating log, they can move along and across its surface.

The player should inherit appropriate velocity from the log while retaining independent walking movement.

Walking and running should apply opposite reaction forces to the log, subject to practical stability limits.

If the log rotates, the player must respond to the resulting surface movement rather than remaining artificially upright relative to the log.

### Jumping

Jumping applies an impulse to the character.

The jump should preserve the log's local surface velocity at the launch point, plus the player's movement velocity and jump impulse.

The character can jump onto nearby logs or into the water.

### Grabbing

While holding the grab input, the player can attach a temporary physical grip to a reachable valid surface.

Potential targets include:
- Logs
- Branches
- Environmental geometry
- Other floating objects

Grabs should have limited range and configurable strength.

The player can hang from a log, be dragged through the water, or pull themselves toward the object.

The implementation may use a physics joint or spring-based constraint.

### Paddling and Pushing

The player can interact with the water using directional paddle strokes while swimming or leaning near the edge of a log.

For the MVP, this is an explicit input-driven physical force, not a detailed hand-based fluid simulation.

The applied force should:
- Accelerate the character or log appropriately
- Depend on paddle direction
- Respect force limits
- Produce a reciprocal reaction when applicable

The goal is to make paddling useful for steering and recovery without overpowering the current.

---

# 5. Log Physics

## 5.1 Representation

Each log is a free-moving rigid body with:

- Mass
- Approximate cylindrical collision geometry
- Center of mass
- Linear and angular velocity
- Friction
- Water drag
- Buoyancy parameters
- Surface contact properties

The first prototype should use simple cylindrical or capsule-like geometry.

Realistic irregular mesh colliders are unnecessary initially.

## 5.2 Buoyancy

Buoyancy is calculated using multiple sample points distributed along and around the log.

At each submerged sample point:
1. Determine water surface height.
2. Calculate submersion depth.
3. Apply upward buoyant force.
4. Apply appropriate water drag.
5. Apply local water-current force.

The forces must act at their individual sample positions so the log can rotate, pitch, roll, and tilt naturally.

Avoid applying all buoyancy at the center of mass.

## 5.3 River Propulsion

Logs move primarily because of current forces applied to their submerged portions.

The log's motion should depend on the difference between the local water velocity and the velocity of the submerged point on the log.

This produces:
- Faster downstream movement in stronger currents
- Rotation in changing flow fields
- Different reactions for differently oriented logs
- Drag and acceleration from local water movement

## 5.4 Player Influence

The character affects the log through:
- Weight and contact forces
- Walking acceleration and deceleration
- Jumping impulses
- Grabbing constraints
- Paddling forces
- Collisions

The player should be able to change a log's orientation and trajectory over time, but not directly rotate it as if it were a vehicle.

## 5.5 Collisions

Logs must physically collide with:
- Other logs
- Rocks
- Riverbanks
- Terrain
- The player

Objects can become temporarily stuck, bounce, rotate, or deflect into another current.

Permanent deadlocks should be mitigated through level geometry, forgiving physics parameters, and recovery safeguards rather than scripted obstacle avoidance.

---

# 6. River System

## 6.1 Technical Approach

Do not attempt to simulate volumetric water.

Instead, use a visual water surface combined with an independently defined physical flow field.

Create a system capable of querying:

`SampleWater(worldPosition)`

The result should include:

- Water surface height
- Water velocity vector
- Water presence / validity
- Optional turbulence value

The same interface should be used for logs and characters.

This allows the water simulation implementation to be changed later without rewriting every interacting object.

## 6.2 Flow Fields

The river should be built from connected regions or spline-guided flow volumes.

Each region defines:
- Direction of current
- Current magnitude
- Water height
- Influence bounds
- Optional turbulence

Velocity fields can vary laterally and longitudinally.

This enables:
- Fast currents in narrow sections
- Slower water near riverbanks
- Deflection around boulders
- Curved flow around bends
- Different currents at river forks
- Turbulence downstream of major obstacles

Smooth blending between adjacent flow regions is required.

## 6.3 River Branching

The MVP river includes at least one split.

The two routes should:
- Be physically accessible
- Have different shapes or current speeds
- Lead to a shared downstream section or finish area
- Require no teleportation or route-selection UI

A log's trajectory at a junction should be determined by its velocity, orientation, player interaction, and the local water field.

The player should be capable of affecting which channel they enter.

## 6.4 Waterfalls

A waterfall must behave as a continuous physical traversal event.

At the lip:
- The current accelerates toward the drop.
- Buoyancy support decreases as the object leaves the water.
- The object continues with its existing velocity under gravity.

During freefall:
- Character and logs remain independently simulated.
- Existing linear and angular momentum is preserved.
- The player may jump, move in the air, and grab reachable logs.

At the bottom:
- The plunge pool provides buoyancy and drag.
- Impacts are exaggerated but survivable.
- Objects can submerge temporarily and resurface.
- The character can recover and continue.

The waterfall is not a cinematic teleport or animation sequence.

---

# 7. MVP Level Design

## Level: First Descent

A compact continuous environment that demonstrates the entire interaction model.

### Section A — Gentle Current

A wide, calm river.

Purpose:
- Learn movement on logs
- Test buoyancy and platform motion
- Experiment with paddling and grabbing

### Section B — River Bend

A winding river with rocks and variation in current speed.

Purpose:
- Test steering through physical interactions
- Test contact forces
- Allow logs to drift along different paths

### Section C — River Fork

The river splits into two channels.

**Left channel:** Wider, slower, easier navigation.

**Right channel:** Narrower, faster, with more obstacles.

Purpose:
- Validate branching routes
- Test whether the player can influence their trajectory
- Demonstrate meaningful navigation choices

### Section D — Waterfall

Both channels eventually lead toward a large waterfall.

Purpose:
- Test transitions from water propulsion to freefall
- Test independent airborne physics
- Test landing, splashing, immersion, and recovery

### Section E — Recovery Pool

A wide pool leading to a downstream endpoint.

Purpose:
- Recover from the waterfall
- Rejoin or change logs
- Demonstrate continuous gameplay

**Level requirement:** No loading screens, teleports, or scripted sequences are needed to complete the descent.

---

# 8. Camera, Feel, and Physics Tuning

The MVP should prioritize enjoyment over simulation purity.

Tunable parameters should include:

- Character movement speed and acceleration
- Character traction on wet logs
- Jump impulse
- Grab range and strength
- Paddle impulse and cadence
- Log mass and density
- Log surface friction
- Angular damping
- Water current strength
- Water drag and buoyancy
- Turbulence intensity
- Camera follow smoothing
- Midair character control
- Recovery assistance

Parameters should be editable without modifying source code.

Physics must behave consistently across the chosen fixed simulation timestep.

The simulation should be tested at different render frame rates.

---

# 9. Recovery and Failure Handling

The character cannot die.

Falling into the river is a valid game state, not a fail state.

Expected recovery methods:
- Swim toward nearby logs
- Grab a floating log and climb aboard
- Paddle into an accessible current
- Reach a riverbank or shallow section
- Continue downstream without the original log

An emergency recovery/reset input may exist during development, but normal gameplay should not depend on it.

If a log or player becomes permanently stuck, the situation should be detectable in debugging tools.

The intended final behavior is continuous recovery through physical interaction.

---

# 10. Proposed System Architecture

Organize the prototype around independent, testable systems.

### WaterFlowSystem
Responsible for sampling water height, velocity, and turbulence.

### FloatingBody
Reusable component applying buoyancy, drag, and current forces to rigid bodies.

### LogActor
Log geometry, collision shape, physical properties, and related configuration.

### PlayerController
Player movement, input, jumping, grounded movement, and swimming.

### GrabSystem
Detection and temporary physical constraints for grabbing.

### PaddleSystem
Directional paddle impulses and environmental push forces.

### CharacterWaterInteraction
Immersion detection, swimming forces, and transition between water and air.

### CameraController
Third-person camera tracking, rotation, collision avoidance, and smoothing.

### RiverLevel
River geometry, water regions, junctions, rapids, waterfall, and endpoint.

### PhysicsDebugTools
Visualizations, live configuration values, reset controls, and instrumentation.

**Architecture principle:** Do not hard-code individual log behavior or player behavior to a particular river section. Systems should remain reusable as the environment expands.

---

# 11. Development Plan

## Milestone 1 — Floating Logs

**Goal:** Prove the water-to-log interaction.

Tasks:
- Create a simple river channel
- Implement basic water current sampling
- Implement buoyancy for a cylindrical rigid body
- Spawn multiple independently floating logs
- Add rocks and collision boundaries
- Expose physics tuning parameters

**Done when:** Logs float, follow the current, rotate, and collide without persistent instability.

## Milestone 2 — Riding a Log

**Goal:** Make moving on a free-floating log possible and enjoyable.

Tasks:
- Implement third-person character movement
- Support grounding on moving rigid bodies
- Preserve relative platform velocity
- Apply player contact forces to logs
- Implement jumping from and landing on logs
- Tune character traction and stability

**Done when:** The character can run along and across a moving, rotating log, jump off, and land again without obvious snapping or uncontrolled jitter.

## Milestone 3 — Water Interaction and Recovery

**Goal:** Make falling off a log part of gameplay.

Tasks:
- Implement swimming
- Add paddle input and water propulsion
- Implement grabbing nearby logs
- Add climbing/recovery
- Support transfers between logs
- Tune the transition between grounded, airborne, grabbing, and swimming states

**Done when:** The player can fall into the water, swim, grab another moving log, climb aboard, and resume riding without resetting the game.

## Milestone 4 — River Navigation

**Goal:** Make navigation and player choice meaningful.

Tasks:
- Add river bends
- Add multiple current speeds
- Add boulders and obstacles
- Implement a river fork with two routes
- Tune paddling and weight shifting to affect direction
- Test collisions and unplanned shortcuts

**Done when:** The player can deliberately influence the log into different river channels with reasonable repeatability.

## Milestone 5 — Waterfall

**Goal:** Validate seamless extreme traversal.

Tasks:
- Create the waterfall geometry
- Implement current transition at the waterfall lip
- Handle freefall and airborne log rotation
- Create the plunge pool
- Tune splashdown buoyancy and drag
- Support player recovery below the waterfall

**Done when:** The player and log can travel over the waterfall independently, land in the pool, and continue without a scene transition or reset.

## Milestone 6 — Integrated Playable MVP

**Goal:** Assemble a coherent end-to-end experience.

Tasks:
- Connect all river sections
- Add several logs throughout the course
- Add a starting position and downstream endpoint
- Implement basic restart functionality
- Tune controls and physics as a complete experience
- Add minimal sound and visual feedback
- Run repeated playtests

**Done when:** A player can complete a full descent and the experience remains enjoyable across multiple attempts.

---

# 12. MVP Acceptance Criteria

The MVP can be considered successful when these tests pass.

| ID | Test | Acceptance condition |
|---|---|---|
| T01 | Floating | Logs remain buoyant and react to current changes |
| T02 | Riding | Character can stand and run on moving logs |
| T03 | Momentum | Jumping preserves plausible log/platform velocity |
| T04 | Influence | Player actions produce observable reactions in log movement |
| T05 | Grabbing | Character can catch and hold a moving log |
| T06 | Swimming | Character can enter water and actively move through it |
| T07 | Recovery | Character can return to a moving log without restarting |
| T08 | Collisions | Logs bounce, rotate, and deflect against obstacles |
| T09 | Branching | Player can navigate either river branch |
| T10 | Waterfall | Logs and player traverse a waterfall in continuous simulation |
| T11 | Stability | Normal gameplay does not produce frequent explosive physics or unrecoverable states |
| T12 | Completion | Player can reach the downstream endpoint through continuous gameplay |

Tests should be repeatable in debug scenes, not evaluated only through full-level playthroughs.

---

# 13. Prototype Validation

The project should answer five central questions before expanding scope.

**Q1. Is moving on a physically simulated floating log enjoyable?**

This is the most important validation point. If it does not feel good, further content will not fix the core game.

**Q2. Can players intentionally influence their direction?**

The river should be unpredictable, but players need enough agency to develop skill.

**Q3. Is falling off entertaining instead of frustrating?**

Recovering should create interesting decisions without excessive downtime.

**Q4. Do the physics create surprising situations naturally?**

Collisions, rolling, jumps, and water movement should generate memorable moments without hand-authored events.

**Q5. Does the environment support meaningful exploration?**

Different channels should genuinely change the experience, rather than serving as purely visual alternatives.

The MVP should not expand into multiplayer, progression, or detailed content production until these questions have convincing answers.

---

# 14. Technical Risks

### Risk 1 — Character stability on moving logs

Physics-based moving platforms are difficult, especially when rotating and moving rapidly.

**Mitigation:** Prototype moving-platform locomotion early, with a simple cylinder on flat ground before introducing water.

### Risk 2 — Uncontrollable steering

Realistic buoyancy and contact friction might not provide enough steering authority.

**Mitigation:** Allow configurable paddle force, character grip, and slightly exaggerated contact impulses. Tune for intentional movement.

### Risk 3 — Water simulation complexity

Advanced fluid simulation could absorb most development time.

**Mitigation:** Use spline-guided flow fields and point-sampled buoyancy. Separate visual water from physical water.

### Risk 4 — High-speed collision instability

Fast logs, rotating contacts, waterfalls, and multiple rigid bodies could cause tunneling or violent numerical errors.

**Mitigation:** Use continuous collision detection where appropriate, tuned physics timesteps, stable constraints, and force limits.

### Risk 5 — Recovery becoming tedious

Players might spend too much time swimming after an uncontrollable fall.

**Mitigation:** Design catchable logs, generous grab ranges, sensible river geometry, and adjustable swimming propulsion.

### Risk 6 — Physics feeling inconsistent

Too much artificial correction might undermine the sandbox fantasy.

**Mitigation:** Favor consistent force-based interactions. Any assists should preserve visible momentum and behave predictably.

---

# 15. Future Features — Not MVP

Potential follow-up development directions:

- Real-time multiplayer
- Competitive downhill racing
- Additional river environments
- Multiple log types and sizes
- Destructible logs
- Massive interconnected river networks
- Racing ghosts and time trials
- Free-roam exploration
- Environmental events
- Surreal dreamlike river mechanics
- Character customization
- Replay and cinematic camera tools

Future features should be prioritized based on what proves most fun in the prototype.

---

# 16. Definition of Success

The MVP is successful if the player can:

1. Stand on a log being carried by a river.
2. Move naturally and influence the log's physics.
3. Interact physically with water and obstacles.
4. Jump, grab, and transfer between floating objects.
5. Fall into the water and recover.
6. Choose between different river routes.
7. Ride or fall over a huge waterfall.
8. Reach the downstream endpoint in one continuous experience.

Most importantly, the player should want to repeat the experience simply because moving through the river is fun.

**Guiding principle: Build the physics playground first. Let the game emerge from it.**
