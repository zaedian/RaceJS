// game.js
const scene = new THREE.Scene();

const textureLoader = new THREE.TextureLoader();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 15);
camera.lookAt(0, 0, 0);
const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

const updatables = [];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

let paused = false;

document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Skybox
const loader = new THREE.CubeTextureLoader();
scene.background = loader.load([
    'skybox/clouds1_east_iq8cr6.png', 'skybox/clouds1_west_gwd0gs.png', 'skybox/clouds1_up_tnxqka.png',
    'skybox/clouds1_down_p10z7n.png', 'skybox/clouds1_north_anykiq.png', 'skybox/clouds1_south_bek22d.png'
]);
scene.fog = new THREE.FogExp2(0xcccccc, 0.007);

const grassTexture = textureLoader.load('textures/grass.png');
grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.repeat.set(64, 64);

// Lights
const ambientLight = new THREE.AmbientLight(0x404040, 2);
scene.add(ambientLight);

const Sun = new THREE.DirectionalLight(0xffffff, 1);
Sun.castShadow = true;

Sun.shadow.camera.left = -50;
Sun.shadow.camera.right = 50;
Sun.shadow.camera.top = 50;
Sun.shadow.camera.bottom = -50;
Sun.shadow.camera.near = 1;
Sun.shadow.camera.far = 300;
Sun.shadow.mapSize.width = 4096;
Sun.shadow.mapSize.height = 4096;
Sun.shadow.bias = 0.00005;        // Added bias for shadow acne reduction
Sun.shadow.normalBias = 0.02;     // Better normal bias

Sun.target.position.set(0, 0, 0);
scene.add(Sun.target);
scene.add(Sun);

// Camera & Sun follow offsets
const cameraOffset = new THREE.Vector3(0, 5, 10);
const cameraLookAtOffset = new THREE.Vector3(0, 1.5, 0);
const sunOffset = new THREE.Vector3(20, 30, 20);

// Ammo.js variables
let physicsWorld, vehicle, chassisBody, chassisMesh, wheelMeshes = [], transformAux1;
const maxEngineForce = 6500, maxBreakingForce = 2000, maxSteeringValue = 0.45;
const steeringIncrement = 0.1, steeringClamp = 0.3;
const suspensionRestLength = 1.0, suspensionStiffness = 30, suspensionDamping = 10, suspensionCompression = 1, suspensionRelaxation = 5;
//How fast the car rolls over
const rollInfluence = 0.01, wheelFriction = 1000, wheelRadius = 0.3, wheelWidth = 0.15;
let currentSteeringValue = 0, engineForce = 0, breakingForce = 0;
const clock = new THREE.Clock();

let cameraMode = 'thirdPerson'; // Default camera mode is third-person

Ammo().then(function (Ammo) {
    const gltfLoader = new THREE.GLTFLoader();
    initPhysics();
    createGround();
    createCar();
	createBall({ x: -25, y: 0, z: 30 }, 1.5, 1);
	createBall({ x: -30, y: 0, z: 30 }, 1.5, 1000);
	createBall({ x: -35, y: 0, z: 30 }, 1.5, 12000);
    createMap();
    transformAux1 = new Ammo.btTransform();

    const keys = {};
    window.addEventListener('keydown', e => {
        keys[e.key.toLowerCase()] = true;
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', ' '].includes(e.key.toLowerCase())) {
            e.preventDefault();
        }

	// Toggle camera view on pressing P, C, or V
	if (['p', 'c', 'v'].includes(e.key.toLowerCase())) {
		cameraMode = (cameraMode === 'thirdPerson') ? 'firstPerson' : 'thirdPerson';
	}
    });
    window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

    animate();

    function initPhysics() {
        const config = new Ammo.btDefaultCollisionConfiguration();
        const dispatcher = new Ammo.btCollisionDispatcher(config);
        const broadphase = new Ammo.btDbvtBroadphase();
        const solver = new Ammo.btSequentialImpulseConstraintSolver();
        physicsWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, config);
        physicsWorld.setGravity(new Ammo.btVector3(0, -19.81, 0));
    }

    function createGround() {
        const groundSize = 265;
        const groundThickness = 0.1;
        const shape = new Ammo.btBoxShape(new Ammo.btVector3(groundSize / 2, groundThickness / 2, groundSize / 2));
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(0, -groundThickness, 0));
        const motionState = new Ammo.btDefaultMotionState(transform);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, new Ammo.btVector3(0, 0, 0));
        const body = new Ammo.btRigidBody(rbInfo);
        physicsWorld.addRigidBody(body);

        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(groundSize, groundThickness, groundSize),
            new THREE.MeshStandardMaterial({ map: grassTexture })
        );
        mesh.position.y = -groundThickness;
        mesh.receiveShadow = true;
        scene.add(mesh);
    }

    function createMap() {
        gltfLoader.load('models/map.glb', function(gltf) {
            const map = gltf.scene;
            map.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = true;

                    // OPTIONAL: Add physics if needed
                    const shape = createAmmoShapeFromMesh(child);
                    if (shape) {
                        const transform = new Ammo.btTransform();
                        transform.setIdentity();
                        const position = child.getWorldPosition(new THREE.Vector3());
                        transform.setOrigin(new Ammo.btVector3(position.x, position.y, position.z));
                        const motionState = new Ammo.btDefaultMotionState(transform);
                        const rbInfo = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, new Ammo.btVector3(0, 0, 0));
                        const body = new Ammo.btRigidBody(rbInfo);
                        physicsWorld.addRigidBody(body);
                    }
                }
            });

            scene.add(map);
        }, undefined, function(error) {
            console.error('Error loading map.glb:', error);
        });
    }
	
	
function createBall(position, radius, mass) {

    // Load the map.glb and find the ball model inside it
    gltfLoader.load('models/map.glb', function (gltf) {
        const map = gltf.scene;
        const ballModel = map.getObjectByName('Ball');

        if (ballModel) {
            ballModel.position.set(position.x, position.y, position.z);
            ballModel.scale.set(radius, radius, radius);
            ballModel.castShadow = true;
            ballModel.receiveShadow = true;
            scene.add(ballModel);

            const ballShape = new Ammo.btSphereShape(radius);
            const startTransform = new Ammo.btTransform();
            startTransform.setIdentity();
            startTransform.setOrigin(new Ammo.btVector3(position.x, position.y, position.z));

            const localInertia = new Ammo.btVector3(0, 0, 0);
            ballShape.calculateLocalInertia(mass, localInertia);

            const motionState = new Ammo.btDefaultMotionState(startTransform);
            const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, ballShape, localInertia);
            const ballBody = new Ammo.btRigidBody(rbInfo);
            ballBody.setFriction(1);
            ballBody.setRestitution(0.6);
            physicsWorld.addRigidBody(ballBody);

            const update = () => {
                const ms = ballBody.getMotionState();
                if (ms) {
                    ms.getWorldTransform(transformAux1);
                    const p = transformAux1.getOrigin();
                    const q = transformAux1.getRotation();
                    ballModel.position.set(p.x(), p.y(), p.z());
                    ballModel.quaternion.set(q.x(), q.y(), q.z(), q.w());
                }
            };

            updatables.push(update);
        } else {
            console.error("Ball model not found in map.glb");
        }
    }, undefined, function (error) {
        console.error('Error loading map.glb:', error);
    });
}





function createAmmoShapeFromMesh(mesh) {
    const geometry = mesh.geometry;
    if (!geometry || !geometry.attributes.position) return null;

    const vertices = geometry.attributes.position.array;
    const index = geometry.index ? geometry.index.array : null;
    const triangleMesh = new Ammo.btTriangleMesh();

    // create the triangle mesh from geometry's indices
    for (let i = 0; i < (index ? index.length : vertices.length / 3); i += 3) {
        const idx0 = index ? index[i] * 3 : i * 3;
        const idx1 = index ? index[i + 1] * 3 : (i + 1) * 3;
        const idx2 = index ? index[i + 2] * 3 : (i + 2) * 3;

        const v0 = new Ammo.btVector3(vertices[idx0], vertices[idx0 + 1], vertices[idx0 + 2]);
        const v1 = new Ammo.btVector3(vertices[idx1], vertices[idx1 + 1], vertices[idx1 + 2]);
        const v2 = new Ammo.btVector3(vertices[idx2], vertices[idx2 + 1], vertices[idx2 + 2]);

        triangleMesh.addTriangle(v0, v1, v2, true);
    }

    const shape = new Ammo.btBvhTriangleMeshShape(triangleMesh, true, true);
    return shape;
}


    function createCar() {
// Step 2: Create the sphere geometry (chassis shape) with radius 2, widthSegments 8, heightSegments 8
        const geometry = new THREE.SphereGeometry(2, 12, 12);
		geometry.scale(0.6, 0.7, 1); // Oval shape
      
	  
		// Add visual for collision shape
		//const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true }); // Green wireframe
		//const sphere = new THREE.Mesh(geometry, material);
        //scene.add(sphere);

const positionAttr = geometry.attributes.position;
const vertices = positionAttr.array;
const chassisShape = new Ammo.btConvexHullShape();

for (let i = 0; i < vertices.length; i += 3) {
    let x = vertices[i];
    let y = vertices[i + 1];
    let z = vertices[i + 2];

    // Flatten the bottom: if y is below a threshold, clamp it
    const bottomY = -0.5; // Adjust as needed
    if (y < bottomY) y = bottomY;

    chassisShape.addPoint(new Ammo.btVector3(x, y, z));
}

        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(0, 1.0, 0));
        const mass = 1000;
        const localInertia = new Ammo.btVector3(0, 0, 0);
        chassisShape.calculateLocalInertia(mass, localInertia);
        const motionState = new Ammo.btDefaultMotionState(transform);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, chassisShape, localInertia);
        chassisBody = new Ammo.btRigidBody(rbInfo);
        chassisBody.setAngularFactor(new Ammo.btVector3(1, 1, 1));
        physicsWorld.addRigidBody(chassisBody);
		
		 const linearDamping = 0.33; // Adjust this value
		const angularDamping = 0.33; // Adjust this value
		chassisBody.setDamping(linearDamping, angularDamping);

        // Create a more complex car body geometry (e.g., combining box for chassis with additional parts)
        gltfLoader.load('models/car.glb', gltf => {
            chassisMesh = gltf.scene;
            chassisMesh.scale.set(1, 1, 1); // Adjust as needed
            chassisMesh.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
			
			
			/*const neonLight = new THREE.RectAreaLight(0x0000ff, 5, 2, 3.75);
			neonLight.position.set(0, -0.5, 0);
			neonLight.rotation.x = -Math.PI / 2;
			chassisMesh.add(neonLight);*/


            scene.add(chassisMesh);
        });
		
		

        // Vehicle setup
        const tuning = new Ammo.btVehicleTuning();
        const raycaster = new Ammo.btDefaultVehicleRaycaster(physicsWorld);
        vehicle = new Ammo.btRaycastVehicle(tuning, chassisBody, raycaster);
        vehicle.setCoordinateSystem(0, 1, 2);
        physicsWorld.addAction(vehicle);

        const connection = new Ammo.btVector3(0, 0, 0);
        const wheelDirection = new Ammo.btVector3(0, -1, 0);
        const wheelAxle = new Ammo.btVector3(-1, 0, 0);

        const positions = [
            [ 0.75, 0.5,  1.2, true ],    // Front right
            [-0.75, 0.5,  1.2, true ],
            [ 0.75, 0.5, -1.3, false ],
            [-0.75, 0.5, -1.3, false ]
        ];

        // Create a texture loader
        const textureLoader = new THREE.TextureLoader();

        // Load the wheel texture
        const wheelTexture = textureLoader.load('textures/wheel.png', (texture) => {
        }, undefined, (error) => {
            // Handle errors during texture loading
            console.error('Error loading wheel texture:', error);
        });

        // Create a more detailed wheel (cylinder with a smooth edge)
        const wheelGeom = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 12);
        wheelGeom.rotateZ(Math.PI / 2);

        // Create a material using the loaded texture
        const wheelMat = new THREE.MeshStandardMaterial({
            map: wheelTexture, // Apply the texture to the material's color map
            color: 0x777777, // You can still set a base color, which will be tinted by the texture
            metalness: 0.5, // Adjust material properties for a more realistic look
            roughness: 0.7
        });

        positions.forEach(([x, y, z, isFront]) => {
            vehicle.addWheel(new Ammo.btVector3(x, y, z), wheelDirection, wheelAxle,
                suspensionRestLength, wheelRadius, tuning, isFront);
            const mesh = new THREE.Mesh(wheelGeom, wheelMat);
            mesh.castShadow = true;
            scene.add(mesh);
            wheelMeshes.push(mesh);
        });

        for (let i = 0; i < vehicle.getNumWheels(); i++) {
            const wheelInfo = vehicle.getWheelInfo(i);
            wheelInfo.set_m_suspensionStiffness(suspensionStiffness);
            wheelInfo.set_m_wheelsDampingRelaxation(suspensionDamping);
            wheelInfo.set_m_wheelsDampingCompression(suspensionCompression);
            wheelInfo.set_m_frictionSlip(wheelFriction);
            wheelInfo.set_m_rollInfluence(rollInfluence);
            wheelInfo.set_m_maxSuspensionForce(10000);
        }
		
    }
	
function updateVehicle(deltaTime) {
    engineForce = 0;
    breakingForce = 0;
    let currentEngineForce = 0;

    // Activate the chassis to ensure it responds to forces
    chassisBody.activate();

    if (keys['w'] || keys['arrowup']) currentEngineForce = maxEngineForce;
    else if (keys['s'] || keys['arrowdown']) currentEngineForce = -maxEngineForce * 0.5;

    if (keys[' ']) { breakingForce = 50; currentEngineForce = 0; }

    // Calculate speed (use only the x and z velocity components)
    const speed = getVehicleSpeed();

// Steering should be more responsive at higher speeds
const speedFactor = Math.max(1, speed / 8);
const steeringMultiplier = 1 / speedFactor;

    if (keys['a'] || keys['arrowleft']) {
        currentSteeringValue = Math.min(currentSteeringValue + steeringIncrement * deltaTime * 60 * steeringMultiplier, steeringClamp);
    }
    else if (keys['d'] || keys['arrowright']) {
        currentSteeringValue = Math.max(currentSteeringValue - steeringIncrement * deltaTime * 60 * steeringMultiplier, -steeringClamp);
    }
    else {
        currentSteeringValue += currentSteeringValue > 0 ? -steeringIncrement * deltaTime * 60 * steeringMultiplier : currentSteeringValue < 0 ? steeringIncrement * deltaTime * 60 * steeringMultiplier : 0;
    }

    for (let i = 0; i < vehicle.getNumWheels(); i++) {
        vehicle.applyEngineForce(currentEngineForce, i);
        vehicle.setBrake(breakingForce, i);
        if (i < 2) vehicle.setSteeringValue(currentSteeringValue, i);
    }
}

	
	function getVehicleSpeed() {
    const velocity = chassisBody.getLinearVelocity();
    const speed = velocity.length(); // Get the magnitude of the velocity vector
    return speed;
}
	
	
	// Yaw and Pitch for First Person and Third Person
let yawFirstPerson = 0;
let pitchFirstPerson = 0;
let yawThirdPerson = 0;
let pitchThirdPerson = 0;

// Pointer lock on click
renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
    // Immediately add mousemove listener once the pointer is locked
    document.addEventListener('mousemove', onMouseMove, false);
});

// Pointer lock change
document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== renderer.domElement) {
        // Remove the mousemove event listener when pointer lock is lost
        document.removeEventListener('mousemove', onMouseMove, false);
    }
});

// Mouse move handler
function onMouseMove(event) {
    const sensitivity = 0.002;
    
    // Update yaw and pitch based on mouse movement
    if (cameraMode === 'firstPerson') {
        yawFirstPerson -= (event.movementX || 0) * sensitivity;
        pitchFirstPerson -= (event.movementY || 0) * sensitivity;

        // Limit the pitch (up and down) to prevent flipping
        pitchFirstPerson = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitchFirstPerson));
    } else if (cameraMode === 'thirdPerson') {
        yawThirdPerson -= (event.movementX || 0) * sensitivity;
        pitchThirdPerson -= (event.movementY || 0) * sensitivity;

        // Limit the pitch (up and down) to prevent flipping
        pitchThirdPerson = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitchThirdPerson));
    }
}




// Animation loop
function animate() {
    requestAnimationFrame(animate);
    let deltaTime = clock.getDelta();
    if (paused) return;

    deltaTime = Math.min(deltaTime, 0.05); // Clamp it


    if (vehicle) updateVehicle(deltaTime);
    if (physicsWorld) physicsWorld.stepSimulation(deltaTime, 20);

    if (chassisBody && chassisMesh) {
        const ms = chassisBody.getMotionState();
        if (ms) {
            ms.getWorldTransform(transformAux1);
            const p = transformAux1.getOrigin(), q = transformAux1.getRotation();
            chassisMesh.position.set(p.x(), p.y(), p.z());
            chassisMesh.quaternion.set(q.x(), q.y(), q.z(), q.w());

            const carPosition = chassisMesh.position;
			
			
			
			// Auto-flip if upside down or sideways too long
const rotation = chassisMesh.quaternion;
const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
if (up.y < 0.2) { // Almost upside down
    if (!chassisMesh.flipTimer) chassisMesh.flipTimer = 0;
    chassisMesh.flipTimer += deltaTime;

    if (chassisMesh.flipTimer > 5) { // Wait 5 seconds before flipping
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(
            chassisMesh.position.x,
            chassisMesh.position.y + 2,
            chassisMesh.position.z
        ));
        transform.setRotation(new Ammo.btQuaternion(0, 0, 0, 1)); // Reset rotation
        chassisBody.setWorldTransform(transform);
        chassisBody.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
        chassisBody.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
        chassisBody.activate();
        chassisMesh.flipTimer = 0;
    }
} else {
    chassisMesh.flipTimer = 0;
}

			

            // Sun position remains unchanged
            Sun.position.x = carPosition.x - 15;
            Sun.position.y = carPosition.y + 90;
            Sun.position.z = carPosition.z - 30;
                
            Sun.target.position.set(
                carPosition.x,
                carPosition.y,
                carPosition.z
            );
            Sun.target.updateMatrixWorld();

// First-person camera update logic
if (cameraMode === 'firstPerson') {
    const cameraHeight = 0.45;
    // Assuming the car's local forward is positive Z and right is positive X

    // Calculate the camera position relative to the car's local space
    // Adjust the offset here if the camera should be positioned differently relative to the car's origin
    const cameraLocalOffset = new THREE.Vector3(0.4, cameraHeight, -0.2); // Example: slightly behind the origin, at a certain height

    // Apply the car's rotation to the local offset to get the world offset
    const cameraWorldOffset = cameraLocalOffset.clone().applyQuaternion(chassisMesh.quaternion);

    // Set the camera position in world space
    const carPosition = new THREE.Vector3(); // Assuming you have carPosition
    chassisMesh.getWorldPosition(carPosition); // Get car's world position
    camera.position.copy(carPosition).add(cameraWorldOffset);

    // Orientation
    const carQuaternion = chassisMesh.quaternion.clone();

    const cameraRelativeRotation = new THREE.Quaternion();

    const forwardAlignQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    cameraRelativeRotation.multiply(forwardAlignQuaternion); // cameraRelativeRotation = identity * forwardAlign

    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawFirstPerson);
    cameraRelativeRotation.multiply(yawQuat); // cameraRelativeRotation = forwardAlign * yaw

    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchFirstPerson); 
    cameraRelativeRotation.multiply(pitchQuat); // cameraRelativeRotation = forwardAlign * yaw * pitch
    camera.quaternion.copy(carQuaternion).multiply(cameraRelativeRotation);
}






            // Third-person camera update logic
            else {
                const cameraDistance = 5;
                const cameraHeight = 1.5;
                const offset = new THREE.Vector3(
                    -Math.sin(yawThirdPerson) * cameraDistance,
                    0,
                    -Math.cos(yawThirdPerson) * cameraDistance
                );

                camera.position.copy(carPosition).add(offset);
                camera.position.y += cameraHeight - Math.sin(pitchThirdPerson) * cameraDistance;

                // Raycast down to keep camera above the map
                raycaster.set(new THREE.Vector3(camera.position.x, camera.position.y + 10, camera.position.z), downVector);
                const intersects = raycaster.intersectObjects(scene.children, true); // check all children
                if (intersects.length > 0) {
                    const groundY = intersects[0].point.y;
                    camera.position.y = Math.max(camera.position.y, groundY + 0.5); // add some height above ground
                }

                camera.lookAt(carPosition);
            }
        }
    }

    // Update wheel meshes
    for (let i = 0; i < wheelMeshes.length; i++) {
        vehicle.updateWheelTransform(i, true);
        const tm = vehicle.getWheelTransformWS(i);
        const p = tm.getOrigin(), q = tm.getRotation();
        wheelMeshes[i].position.set(p.x(), p.y(), p.z());
        wheelMeshes[i].quaternion.set(q.x(), q.y(), q.z(), q.w());
    }
	
	updatables.forEach(fn => fn());

    renderer.render(scene, camera);
}

});
