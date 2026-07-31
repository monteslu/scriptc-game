/* Flat C surface over Box3D (Erin Catto's 3D physics engine) for the
 * box3d seam. This is the NATIVE half of the backend contract that
 * box3d-wasm's embind layer implements for the wasm half: scalar args in,
 * scalar handles out, so the shared TS frontend can sit on either.
 *
 * Box3D hands out by-value struct ids (b3BodyId is 64 bits of index +
 * world + generation). scriptc FFI scalars are exact only to 2^53 through
 * f64, so ids never cross the boundary raw: a u32 slot table holds them,
 * the same trick sg_tables.c plays for Skia pointers.
 *
 * Reads go through a scratch row (sg_b3_body_read fills, sg_b3_getf
 * indexes), the sg_gl_geti pattern: one call per float is fine at the
 * body counts a game runs, and the contract stays pointer-free. */

#include <box3d/box3d.h>
#include <stdint.h>

/* ---- handle tables ---------------------------------------------------- */

#define SG_B3_MAX_BODIES 16384
#define SG_B3_MAX_SHAPES 16384

static b3BodyId sg_b3_bodies[SG_B3_MAX_BODIES];
static uint32_t sg_b3_body_free[SG_B3_MAX_BODIES];
static uint32_t sg_b3_body_top = 1;   /* slot 0 = null */
static uint32_t sg_b3_body_nfree = 0;

static b3ShapeId sg_b3_shapes[SG_B3_MAX_SHAPES];
static uint32_t sg_b3_shape_free[SG_B3_MAX_SHAPES];
static uint32_t sg_b3_shape_top = 1;
static uint32_t sg_b3_shape_nfree = 0;

static uint32_t sg_b3_body_slot( b3BodyId id )
{
	uint32_t s;
	if ( sg_b3_body_nfree > 0 )
	{
		s = sg_b3_body_free[--sg_b3_body_nfree];
	}
	else
	{
		if ( sg_b3_body_top >= SG_B3_MAX_BODIES ) return 0;
		s = sg_b3_body_top++;
	}
	sg_b3_bodies[s] = id;
	return s;
}

static uint32_t sg_b3_shape_slot( b3ShapeId id )
{
	uint32_t s;
	if ( sg_b3_shape_nfree > 0 )
	{
		s = sg_b3_shape_free[--sg_b3_shape_nfree];
	}
	else
	{
		if ( sg_b3_shape_top >= SG_B3_MAX_SHAPES ) return 0;
		s = sg_b3_shape_top++;
	}
	sg_b3_shapes[s] = id;
	return s;
}

/* ---- scratch reads ---------------------------------------------------- */

static double sg_b3_scratch[12];

double sg_b3_getf( int32_t i )
{
	if ( i < 0 || i >= 12 ) return 0;
	return sg_b3_scratch[i];
}

/* ---- world ------------------------------------------------------------ */

uint32_t sg_b3_world_create( double gx, double gy, double gz, uint8_t enable_sleep,
                             uint32_t worker_count )
{
	b3WorldDef def = b3DefaultWorldDef();
	def.gravity.x = (float)gx;
	def.gravity.y = (float)gy;
	def.gravity.z = (float)gz;
	def.enableSleep = enable_sleep != 0;
	/* No task callbacks on purpose: workerCount > 1 makes Box3D spin up
	 * its own in-tree scheduler (see src/scheduler.c), the same path the
	 * deluxe wasm build uses. The engine clamps to B3_MAX_WORKERS. */
	def.workerCount = worker_count > 0 ? worker_count : 1;
	return b3StoreWorldId( b3CreateWorld( &def ) );
}

void sg_b3_world_step( uint32_t w, double dt, int32_t substeps )
{
	b3World_Step( b3LoadWorldId( w ), (float)dt, substeps );
}

void sg_b3_world_set_gravity( uint32_t w, double gx, double gy, double gz )
{
	b3Vec3 g = { (float)gx, (float)gy, (float)gz };
	b3World_SetGravity( b3LoadWorldId( w ), g );
}

void sg_b3_world_destroy( uint32_t w )
{
	b3DestroyWorld( b3LoadWorldId( w ) );
	/* Bodies and shapes died with the world; their slots are stale by
	 * definition, so reset the tables rather than leak them. One world at
	 * a time is the v0 stance (a game has one). */
	sg_b3_body_top = 1;
	sg_b3_body_nfree = 0;
	sg_b3_shape_top = 1;
	sg_b3_shape_nfree = 0;
}

/* ---- bodies ----------------------------------------------------------- */

uint32_t sg_b3_body_create( uint32_t w, int32_t type, double px, double py, double pz,
                            double qx, double qy, double qz, double qw )
{
	b3BodyDef def = b3DefaultBodyDef();
	def.type = type == 2 ? b3_dynamicBody : type == 1 ? b3_kinematicBody : b3_staticBody;
	def.position.x = px;
	def.position.y = py;
	def.position.z = pz;
	def.rotation.v.x = (float)qx;
	def.rotation.v.y = (float)qy;
	def.rotation.v.z = (float)qz;
	def.rotation.s = (float)qw;
	return sg_b3_body_slot( b3CreateBody( b3LoadWorldId( w ), &def ) );
}

void sg_b3_body_destroy( uint32_t b )
{
	if ( b == 0 || b >= sg_b3_body_top ) return;
	b3DestroyBody( sg_b3_bodies[b] );
	sg_b3_body_free[sg_b3_body_nfree++] = b;
}

/* Fills the scratch row: [px,py,pz, qx,qy,qz,qw, awake, vx,vy,vz]. */
void sg_b3_body_read( uint32_t b )
{
	b3BodyId id = sg_b3_bodies[b];
	b3Pos p = b3Body_GetPosition( id );
	b3Quat q = b3Body_GetRotation( id );
	b3Vec3 v = b3Body_GetLinearVelocity( id );
	sg_b3_scratch[0] = p.x;
	sg_b3_scratch[1] = p.y;
	sg_b3_scratch[2] = p.z;
	sg_b3_scratch[3] = q.v.x;
	sg_b3_scratch[4] = q.v.y;
	sg_b3_scratch[5] = q.v.z;
	sg_b3_scratch[6] = q.s;
	sg_b3_scratch[7] = b3Body_IsAwake( id ) ? 1 : 0;
	sg_b3_scratch[8] = v.x;
	sg_b3_scratch[9] = v.y;
	sg_b3_scratch[10] = v.z;
}

/* Move a body WITHOUT sweeping it there: restart/respawn teleports.
 * Full pose: a respawned stack needs its rotations squared up too. */
void sg_b3_body_teleport( uint32_t b, double px, double py, double pz,
                          double qx, double qy, double qz, double qw )
{
	b3BodyId id = sg_b3_bodies[b];
	b3Pos p = { px, py, pz };
	b3Quat q;
	q.v.x = (float)qx;
	q.v.y = (float)qy;
	q.v.z = (float)qz;
	q.s = (float)qw;
	b3Body_SetTransform( id, p, q );
}

/* Player-ship shaping: gravity scale (0 = flies), and an all-angular
 * lock so a hull driven by velocity never picks up spin from contacts. */
void sg_b3_body_config( uint32_t b, double gravity_scale, uint8_t lock_angular )
{
	b3BodyId id = sg_b3_bodies[b];
	b3Body_SetGravityScale( id, (float)gravity_scale );
	b3MotionLocks locks = b3Body_GetMotionLocks( id );
	locks.angularX = lock_angular != 0;
	locks.angularY = lock_angular != 0;
	locks.angularZ = lock_angular != 0;
	b3Body_SetMotionLocks( id, locks );
}

void sg_b3_body_set_velocity( uint32_t b, double vx, double vy, double vz )
{
	b3Vec3 v = { (float)vx, (float)vy, (float)vz };
	b3Body_SetLinearVelocity( sg_b3_bodies[b], v );
}

void sg_b3_body_set_angular_velocity( uint32_t b, double wx, double wy, double wz )
{
	b3Vec3 v = { (float)wx, (float)wy, (float)wz };
	b3Body_SetAngularVelocity( sg_b3_bodies[b], v );
}

void sg_b3_body_impulse( uint32_t b, double ix, double iy, double iz, uint8_t wake )
{
	b3Vec3 v = { (float)ix, (float)iy, (float)iz };
	b3Body_ApplyLinearImpulseToCenter( sg_b3_bodies[b], v, wake != 0 );
}

/* ---- shapes ----------------------------------------------------------- */

static b3ShapeDef sg_b3_shape_def( double density, double friction, double restitution )
{
	b3ShapeDef def = b3DefaultShapeDef();
	if ( density >= 0 ) def.density = (float)density;
	if ( friction >= 0 ) def.baseMaterial.friction = (float)friction;
	if ( restitution >= 0 ) def.baseMaterial.restitution = (float)restitution;
	return def;
}

uint32_t sg_b3_shape_box( uint32_t b, double hx, double hy, double hz,
                          double density, double friction, double restitution )
{
	b3ShapeDef def = sg_b3_shape_def( density, friction, restitution );
	b3BoxHull hull = b3MakeBoxHull( (float)hx, (float)hy, (float)hz );
	return sg_b3_shape_slot( b3CreateHullShape( sg_b3_bodies[b], &def, &hull.base ) );
}

uint32_t sg_b3_shape_sphere( uint32_t b, double radius,
                             double density, double friction, double restitution )
{
	b3ShapeDef def = sg_b3_shape_def( density, friction, restitution );
	b3Sphere sphere = { { 0, 0, 0 }, (float)radius };
	return sg_b3_shape_slot( b3CreateSphereShape( sg_b3_bodies[b], &def, &sphere ) );
}

/* Radial blast: Box3D's b3World_Explode, the tool for making a shot FEEL
 * like a shot -- one impulse into a packed stack bleeds into friction, an
 * area impulse scatters the neighbourhood. */
void sg_b3_world_explode( uint32_t w, double px, double py, double pz,
                          double radius, double falloff, double impulse_per_area )
{
	b3ExplosionDef def = b3DefaultExplosionDef();
	def.position.x = px;
	def.position.y = py;
	def.position.z = pz;
	def.radius = (float)radius;
	def.falloff = (float)falloff;
	def.impulsePerArea = (float)impulse_per_area;
	b3World_Explode( b3LoadWorldId( w ), &def );
}
