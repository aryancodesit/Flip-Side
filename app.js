// App State
const state = {
    currentStage: 'intro', // intro, record-target, listen, record-attempt, results
    audioContext: null,
    targetBuffer: null,
    attemptBuffer: null,
    isRecording: false,
    recordingStartTime: 0,
    timerInterval: null,
    maxDuration: 10000, // 10 seconds
};

// DOM Elements
const stages = {
    intro: document.getElementById('stage-intro'),
    recordTarget: document.getElementById('stage-record-target'),
    listen: document.getElementById('stage-listen'),
    recordAttempt: document.getElementById('stage-record-attempt'),
    results: document.getElementById('stage-results'),
};

const buttons = {
    start: document.getElementById('btn-start-game'),
    recordTarget: document.getElementById('btn-record-target'),
    playOriginal: document.getElementById('btn-play-original'),
    playReverse: document.getElementById('btn-play-reverse'),
    goToAttempt: document.getElementById('btn-go-to-record-attempt'),
    recordAttempt: document.getElementById('btn-record-attempt'),
    playAttemptReversed: document.getElementById('btn-play-attempt-reversed'),
    playAttemptOriginal: document.getElementById('btn-play-attempt-original'),
    playTargetOriginal: document.getElementById('btn-play-target-original'),
    restart: document.getElementById('btn-restart'),
    themeToggle: document.getElementById('theme-toggle'),
};

const progressRings = document.querySelectorAll('.progress-ring__circle');
const CIRCUMFERENCE = 2 * Math.PI * 90; // r=90

// Initialization
function init() {
    setupTheme();
    setupEventListeners();
    setupProgressRings();
}

function setupTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    buttons.themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    });
}

function setupProgressRings() {
    progressRings.forEach(ring => {
        ring.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
        ring.style.strokeDashoffset = CIRCUMFERENCE;
    });
}

function setProgress(percent, ringIndex = 0) {
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    // Find the visible ring (hacky but works for this simple app)
    // Actually we should target the ring in the active stage
    const activeRing = document.querySelector('.stage.active .progress-ring__circle');
    if (activeRing) {
        activeRing.style.strokeDashoffset = offset;
    }
}

function setupEventListeners() {
    buttons.start.addEventListener('click', () => switchStage('recordTarget'));
    
    buttons.recordTarget.addEventListener('click', () => handleRecording('target'));
    buttons.recordAttempt.addEventListener('click', () => handleRecording('attempt'));
    
    buttons.playOriginal.addEventListener('click', () => playBuffer(state.targetBuffer));
    buttons.playReverse.addEventListener('click', () => playBuffer(state.targetBuffer, true));
    
    buttons.goToAttempt.addEventListener('click', () => switchStage('recordAttempt'));
    
    buttons.playAttemptReversed.addEventListener('click', () => playBuffer(state.attemptBuffer, true));
    buttons.playAttemptOriginal.addEventListener('click', () => playBuffer(state.attemptBuffer));
    buttons.playTargetOriginal.addEventListener('click', () => playBuffer(state.targetBuffer));
    
    buttons.restart.addEventListener('click', () => {
        state.targetBuffer = null;
        state.attemptBuffer = null;
        switchStage('intro');
    });
}

function switchStage(stageName) {
    // Hide all
    Object.values(stages).forEach(el => {
        el.classList.remove('active');
        el.classList.add('hidden');
        // slight delay to allow display:none to apply for fade effect if we were doing complex animations
        // but for now simple class toggle
        setTimeout(() => {
            if(!el.classList.contains('active')) el.style.display = 'none';
        }, 500); 
    });

    // Show target
    const target = stages[stageName];
    target.style.display = 'flex';
    // Force reflow
    void target.offsetWidth;
    target.classList.remove('hidden');
    target.classList.add('active');
    
    state.currentStage = stageName;
    
    // Reset progress rings
    setProgress(0);
}

// Audio Logic
async function initAudio() {
    if (!state.audioContext) {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioContext.state === 'suspended') {
        await state.audioContext.resume();
    }
}

async function handleRecording(type) {
    await initAudio();

    if (state.isRecording) {
        stopRecording();
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        startRecording(stream, type);
    } catch (err) {
        console.error("Error accessing microphone:", err);
        alert("Could not access microphone. Please allow permissions.");
    }
}

let mediaRecorder;
let audioChunks = [];

function startRecording(stream, type) {
    state.isRecording = true;
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); // or audio/ogg
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
        
        if (type === 'target') {
            state.targetBuffer = audioBuffer;
            switchStage('listen');
        } else {
            state.attemptBuffer = audioBuffer;
            switchStage('results');
        }
        
        // Cleanup
        stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    
    // UI Updates
    const btn = type === 'target' ? buttons.recordTarget : buttons.recordAttempt;
    btn.classList.add('recording');
    btn.querySelector('.label').textContent = 'STOP';
    
    // Timer
    state.recordingStartTime = Date.now();
    state.timerInterval = setInterval(() => {
        const elapsed = Date.now() - state.recordingStartTime;
        const percent = Math.min((elapsed / state.maxDuration) * 100, 100);
        setProgress(percent);
        
        if (elapsed >= state.maxDuration) {
            stopRecording();
        }
    }, 50);
}

function stopRecording() {
    if (!state.isRecording) return;
    
    state.isRecording = false;
    mediaRecorder.stop();
    clearInterval(state.timerInterval);
    
    // UI Reset
    document.querySelectorAll('.record-bubble').forEach(btn => {
        btn.classList.remove('recording');
        btn.querySelector('.label').textContent = 'REC';
    });
}

function playBuffer(buffer, reverse = false) {
    if (!buffer) return;
    
    const source = state.audioContext.createBufferSource();
    
    if (reverse) {
        // Create a reversed buffer
        const reversedBuffer = state.audioContext.createBuffer(
            buffer.numberOfChannels,
            buffer.length,
            buffer.sampleRate
        );
        
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            const inputData = buffer.getChannelData(i);
            const outputData = reversedBuffer.getChannelData(i);
            // Copy and reverse
            for (let j = 0; j < buffer.length; j++) {
                outputData[j] = inputData[buffer.length - 1 - j];
            }
        }
        source.buffer = reversedBuffer;
    } else {
        source.buffer = buffer;
    }
    
    source.connect(state.audioContext.destination);
    source.start();
}

// Start
init();
