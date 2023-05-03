import * as THREE from 'three';
import AttributeField from './AttributeField.js';
import ConfigInator from './Config-inator.js';
import GridCellRender from './GridCellRender.js';
import ParticleSim from './ParticleSim.js';
import ParticleRender from './ParticleRender.js';
import ParticleAge from './ParticleAge.js';
import Advector from './Advect.js';
import ExternalForce from './External-Forces.js';
import Divergence from './Divergence.js';
import Jacobi from './Jacobi.js';
import Gradient from './Gradient.js';
import Boundary from './Boundary.js';

var scene, camera, renderer;
var grid_resolution = new THREE.Vector2(512, 256);

/* Attribute Fields */
var velocityField;
var divergenceField;
var boundaryField;
var pressureField;

/* Simulation shader loaders */
var v_conf_inator;
var advector;
var externalVelocity;
var divergence2D;
var jacobi;
var projector;
var boundary;

/* Particle simulation shader & particle position buffer */
var particleAge;
var particleSim;
var particlePositions;
var particleAgeState;

/* Shader loaders for final render + texture variables */
var particleRender;
var gridCellRender;
var particleTex;
var gridCellTex;
var velocityCellScale;
var velocityCellBias;
var pressureCellScale;
var pressureCellBias;
var divergenceCellScale;
var divergenceCellBias;

/* Variables for canvas/screen render */
var canvasMaterial;
var canvasGeometry;
var canvas;

var displayConfig = {
    // BASIC DISPLAY OPTIONS WITH PLACEHOLDER VALUES -> ADD MORE + DECIDE ON DEFAULT VALUES LATER
    JACOBI_ITERATIONS: 30,
    PAUSED: false,
    NUM_PARTICLES: 25000,
    NUM_RENDER_STEPS: 5,
    MAX_PARTICLE_AGE: 100,
    V_SCALE: 20,
    DELTA_TIME:  1.0,
    PARTICLES_ON: true,
    LAYER: "Fluid"
    // Cont.
    // TODO
};

function initGUI() {
    var gui = new dat.GUI( { width: 400 } );

    // Add display options and toggleables here
    // gui.add(displayConfig, 'PARTICLES_ON').name("Toggle Particles?");
    gui.add(displayConfig, 'PAUSED').name("Pause?");
    gui.add(displayConfig, "LAYER", [
        "Fluid",
        "Velocity",
        "Pressure",
        "Divergence"
    ]).name("Layer");
    gui.add(displayConfig, 'V_SCALE', 10, 50).name("Velocity Scaling Term");
    gui.add(displayConfig, 'JACOBI_ITERATIONS', 20, 60).name("Jacobi Iterations");

    // Cont.
    // TODO
}

function initScene() {
    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        alpha : true,
        preserveDrawingBuffer: true 
    });
    renderer.autoClear = false;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
}

function init_attrib_fields() {

    /* Initialize attribute fields */
    velocityField = new AttributeField(grid_resolution);
    divergenceField = new AttributeField(grid_resolution);
    pressureField = new AttributeField(grid_resolution);
    boundaryField = new AttributeField(grid_resolution);
    velocityCellScale = new THREE.Vector3(2.0, 2.0, 2.0);
    velocityCellBias = new THREE.Vector3(0.6, 0.6, 0.6);
    pressureCellScale = new THREE.Vector3(4.0, 4.0, 4.0);
    pressureCellBias = new THREE.Vector3(0.6, 0.6, 0.6);
    divergenceCellScale = new THREE.Vector3(4.0, 4.0, 4.0);
    divergenceCellBias = new THREE.Vector3(0.6, 0.6, 0.6);

    /* This just initializes the velocityField with v = < 1,0,0,1 > (i.e fluid initially flows to the right) */
    v_conf_inator = new ConfigInator(grid_resolution);
    // v_conf_inator.configure_field(renderer, velocityField.read_buf);
    // v_conf_inator.configure_field(renderer, velocityField.write_buf);

    /* Initialize fluid simulation shader loaders */
    advector = new Advector(grid_resolution);
    externalVelocity = new ExternalForce(grid_resolution);
    divergence2D = new Divergence(grid_resolution);
    jacobi = new Jacobi(grid_resolution);
    projector = new Gradient(grid_resolution);
    boundary = new Boundary(grid_resolution);

    /* Initialize particle simulation shader loader, particle positions buffer and particle age buffer */
    var particleSpan = Math.sqrt(displayConfig.NUM_PARTICLES);
    var particleSpanVec2 = new THREE.Vector2(particleSpan, particleSpan);
    particleSim = new ParticleSim(grid_resolution, particleSpan, displayConfig.NUM_RENDER_STEPS, displayConfig.DELTA_TIME);
    particleAge = new ParticleAge(grid_resolution, displayConfig.MAX_PARTICLE_AGE, particleSpan, displayConfig.DELTA_TIME);
    particlePositions = new AttributeField(particleSpanVec2);
    particleAgeState = new AttributeField(particleSpanVec2);

    /* Initialize the shader loaders for the canvas/screen render */
    particleRender = new ParticleRender(grid_resolution, displayConfig.NUM_PARTICLES);
    gridCellRender = new GridCellRender(grid_resolution);
    particleTex = new THREE.WebGLRenderTarget( grid_resolution.x, grid_resolution.y, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.FloatType });
    gridCellTex = new THREE.WebGLRenderTarget( grid_resolution.x, grid_resolution.y, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.FloatType });


    /* This is for the actual render to the canvas. The canvasTex will be written to by the gridCellRender (which runs the
       shader that visualizes one of the grid attributes as colored cells in the grid) or particleRender (which loads the shader
       that visualizes the movement of the fluid using particles) */
    canvasGeometry = new THREE.PlaneGeometry( 2, 2 );
    canvasMaterial =  new THREE.MeshBasicMaterial({map: particleTex.texture});
    canvas = new THREE.Mesh( canvasGeometry, canvasMaterial );
    scene.add(canvas);
}

var prevTime = null;
var lastX = null;
var lastY = null;
function UpdateMousePosition(X,Y){
    var currentTime = Date.now();
    var deltaTime = currentTime - prevTime;

    externalVelocity.source.x = X * grid_resolution.x / window.innerWidth;
    externalVelocity.source.y = Y * grid_resolution.y / window.innerHeight;

    externalVelocity.sourceDirection.x = Math.round((X-lastX) / deltaTime * 100);
    externalVelocity.sourceDirection.y = Math.round((Y-lastY) / deltaTime * 100);

    prevTime = currentTime;
    lastX = X;
    lastY = Y;
}

document.onmousemove = function(event){
    UpdateMousePosition(event.clientX, window.innerHeight - event.clientY);
}

document.onmousedown = function(event) {
    prevTime = Date.now();
    lastX = event.clientX;
    lastY = window.innerHeight - event.clientY;
    externalVelocity.source.z = 1.0;
}

document.onmouseup = function(event) {
    externalVelocity.source.z = 0;
}

function render() {
    /* Implement main simulation step below, update relevant grids/buffers */
    if (!displayConfig.PAUSED) {

        /* Advect velocity through the fluid */
        advector.advect_texture(renderer, velocityField.read_buf, velocityField.read_buf, 0.998, 1.0, velocityField.write_buf);
        velocityField.update_read_buf();

        /* Diffusion Step? */
        for (let i = 0; i < displayConfig.JACOBI_ITERATIONS; i++) {
            jacobi.compute(renderer, 1.0, 0.20, velocityField.read_buf, velocityField.read_buf, velocityField.write_buf);
            velocityField.update_read_buf();
        }

        /* Boundary velocity step */
        boundary.compute(renderer, -1.0, velocityField.read_buf, velocityField.write_buf);
        velocityField.update_read_buf();
        
        /* Apply external forces */
        externalVelocity.apply_force(renderer, velocityField.read_buf, 5.0, velocityField.write_buf);
        velocityField.update_read_buf();

        /* Calculate the divergence of the intermediate velocity field. */
        divergence2D.compute_divergence(renderer, velocityField.read_buf, divergenceField.write_buf);
        divergenceField.update_read_buf();

        /* Using the divergence field, compute the pressure values within each grid cell using Jacobi iteration. */
        renderer.setRenderTarget(pressureField.read_buf);
        renderer.clear();
        renderer.setRenderTarget(null);
        for (let i = 0; i < displayConfig.JACOBI_ITERATIONS; i++) {
            jacobi.compute(renderer, -1.0, 0.25, pressureField.read_buf, divergenceField.read_buf, pressureField.write_buf);
            pressureField.update_read_buf();

            /* Boundary pressure step */
            boundary.compute(renderer, 1.0, pressureField.read_buf, pressureField.write_buf);
            pressureField.update_read_buf();
        }

        /* Projection step => Subract the pressure gradient from the intermediate velocity field to enforce incompressibility. */
        projector.subtract_gradient(renderer, pressureField.read_buf, velocityField.read_buf, velocityField.write_buf);
        velocityField.update_read_buf();


        /* Boundary velocity step */
        boundary.compute(renderer, -1.0, velocityField.read_buf, velocityField.write_buf);
        velocityField.update_read_buf();

        
        /* Age particles */
        particleAge.renderToTarget(renderer, particleAgeState.write_buf);
        particleAgeState.update_read_buf();
        particleAge.update_ages(particleAgeState.read_buf);

        /* Advect particles using forward integration with velocityField */
        for (let i = 0; i < displayConfig.NUM_RENDER_STEPS; i++) {

            /* Render to particle texture displayConfig.NUM_RENDER_STEPS times for smoother trails in the case that a 
               particle travels more than 1px in one timestep */
            particleSim.renderToTarget(renderer, velocityField.read_buf, particleAgeState.read_buf, displayConfig.V_SCALE, particlePositions.write_buf);
            particlePositions.update_read_buf();
            particleSim.update_positions(particlePositions.read_buf);

            /* Render particlePositions to the particleTex render target. */
            particleRender.renderToTarget(renderer, particlePositions.read_buf, velocityField.read_buf, particleTex);
        }

        /* Render the desired grid attribute values to the gridCellTex render target. */
        var toRender = displayConfig.LAYER;
        switch(toRender) {
            case "Fluid":
                displayConfig.PARTICLES_ON = true;
                break;
            case "Velocity":
                displayConfig.PARTICLES_ON = false;
                gridCellRender.renderToTarget(renderer, velocityField.read_buf, velocityCellScale, velocityCellBias, gridCellTex);
                break;
            case "Pressure":
                displayConfig.PARTICLES_ON = false;
                gridCellRender.renderToTarget(renderer, pressureField.read_buf, pressureCellScale, pressureCellBias, gridCellTex);
                break;
            case "Divergence":
                displayConfig.PARTICLES_ON = false;
                gridCellRender.renderToTarget(renderer, divergenceField.read_buf, divergenceCellScale, divergenceCellBias, gridCellTex);
                break;
            default:
                break;
        }
        // gridCellRender.renderToTarget(renderer, velocityField.read_buf, gridCellTex);
        // gridCellRender.renderToTarget(renderer, pressureField.read_buf, gridCellTex);
        // gridCellRender.renderToTarget(renderer, boundaryField.read_buf, gridCellTex);
    }

    if (displayConfig.PARTICLES_ON) {
        canvasMaterial.map = particleTex.texture;
    } else {
        canvasMaterial.map = gridCellTex.texture;
    }

    renderer.render(scene, camera);

    requestAnimationFrame(render);
}

initGUI();
initScene();
init_attrib_fields();
render()