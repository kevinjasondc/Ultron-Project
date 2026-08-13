"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus } from "@/lib/handTracker";

type CameraState = "off" | "starting" | "on" | "error";
type BrainState = "idle" | "listening" | "thinking" | "speaking" | "error";

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};

export default function JarvisOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldListenRef = useRef(false);

  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({
    hands: 0,
    mode: "idle",
  });

  const [error, setError] = useState<string | null>(null);

  const [brainState, setBrainState] = useState<BrainState>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");

  /*
   * THREE.JS ORB
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = createOrbScene(container);
    sceneRef.current = scene;

    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;

      recognitionRef.current?.stop();
      recognitionRef.current = null;

      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  /*
   * GEMINI
   */
  const askGemini = useCallback(async (message: string) => {
    if (!message.trim()) return;

    setBrainState("thinking");
    setResponse("");

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Gemini request failed");
      }

      const answer = data.response || "I have no response.";

      setResponse(answer);
      setBrainState("speaking");

      /*
       * TEXT TO SPEECH
       */
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(answer);

        utterance.rate = 1;
        utterance.pitch = 0.9;
        utterance.volume = 1;

        utterance.onend = () => {
          setBrainState("idle");

          if (shouldListenRef.current) {
            setTimeout(() => {
              recognitionRef.current?.start();
            }, 300);
          }
        };

        window.speechSynthesis.speak(utterance);
      } else {
        setBrainState("idle");
      }
    } catch (err) {
      console.error(err);

      setBrainState("error");
      setResponse("Gemini connection failed.");

      setTimeout(() => {
        setBrainState("idle");
      }, 2500);
    }
  }, []);

  /*
   * VOICE INPUT
   */
  const startVoice = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("VOICE INPUT NOT SUPPORTED IN THIS BROWSER");
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setBrainState("listening");
      setTranscript("");
      setError(null);
    };

    recognition.onresult = (event) => {
      let finalText = "";

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        const text = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalText += text;
        } else {
          setTranscript(text);
        }
      }

      if (finalText) {
        setTranscript(finalText);
        void askGemini(finalText);
      }
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);

      setBrainState("error");

      if (event.error === "not-allowed") {
        setError("MICROPHONE ACCESS DENIED");
      } else {
        setError("VOICE INPUT FAILED");
      }

      setTimeout(() => {
        setBrainState("idle");
      }, 2000);
    };

    recognition.onend = () => {
      if (brainState === "listening") {
        setBrainState("idle");
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      console.error(err);
    }
  }, [askGemini, brainState]);

  const toggleVoice = useCallback(() => {
    if (brainState === "listening") {
      shouldListenRef.current = false;
      recognitionRef.current?.stop();
      setBrainState("idle");
      return;
    }

    shouldListenRef.current = false;
    startVoice();
  }, [brainState, startVoice]);

  /*
   * GESTURES
   */
  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;

    setCamera("off");
    setStatus({
      hands: 0,
      mode: "idle",
    });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;

    if (!video || !overlay || trackerRef.current) return;

    setCamera("starting");
    setError(null);

    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => {
        sceneRef.current?.rotateBy(dt, dp);
      },

      onZoom: (factor) => {
        sceneRef.current?.zoomBy(factor);
      },

      onStatus: setStatus,
    });

    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();

      setCamera("error");

      setError(
        err instanceof DOMException &&
          err.name === "NotAllowedError"
          ? "CAMERA ACCESS DENIED"
          : "TRACKING INIT FAILED",
      );
    }
  }, []);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) {
      stopGestures();
    } else {
      void startGestures();
    }
  }, [startGestures, stopGestures]);

  /*
   * KEYBOARD
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;

        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;

        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;

        case "g":
        case "G":
          toggleGestures();
          break;

        case "v":
        case "V":
          toggleVoice();
          break;
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [toggleGestures, toggleVoice]);

  const cameraOn = camera === "on";

  const brainLabel = {
    idle: "STANDBY",
    listening: "LISTENING",
    thinking: "THINKING",
    speaking: "ULTRON ONLINE",
    error: "SYSTEM ERROR",
  }[brainState];

  return (
    <>
      <div ref={containerRef} className="orb-root" />

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      <div className="hud hud-title">
        U.L.T.R.O.N.
      </div>

      {/* BRAIN STATUS */}
      <div className={`ultron-brain brain-${brainState}`}>
        <div className="brain-status">
          <span className="brain-dot" />
          {brainLabel}
        </div>

        {transcript && (
          <div className="brain-transcript">
            <span>YOU:</span> {transcript}
          </div>
        )}

        {response && (
          <div className="brain-response">
            <span>ULTRON:</span>
            <p>{response}</p>
          </div>
        )}
      </div>

      <div className="hud hud-hint">
        <div>
          <span className="key">DRAG</span> spin&nbsp;&nbsp;
          <span className="key">SCROLL</span> zoom
        </div>

        {cameraOn ? (
          <div>
            <span className="key">PINCH + MOVE</span> spin&nbsp;&nbsp;
            <span className="key">
              PINCH BOTH HANDS ± SPREAD
            </span>{" "}
            zoom
          </div>
        ) : (
          <div>
            <span className="key">G</span> hand gestures&nbsp;&nbsp;
            <span className="key">R</span> reset&nbsp;&nbsp;
            <span className="key">V</span> voice
          </div>
        )}
      </div>

      <div className="hud hud-controls">
        <div className={`camera-panel${cameraOn ? " visible" : ""}`}>
          <video
            ref={videoRef}
            muted
            playsInline
            className="camera-video"
          />

          <canvas
            ref={overlayRef}
            width={208}
            height={156}
            className="camera-overlay"
          />

          <div className="camera-status">
            {status.hands > 0
              ? `${status.hands} HAND${
                  status.hands > 1 ? "S" : ""
                } · ${MODE_LABEL[status.mode]}`
              : "SHOW HANDS"}
          </div>
        </div>

        {error && (
          <div className="hud-error">
            {error}
          </div>
        )}

        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            onClick={toggleVoice}
          >
            {brainState === "listening"
              ? "STOP LISTENING"
              : "ACTIVATE ULTRON"}
          </button>
        </div>

        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-pressed={cameraOn}
            onClick={toggleGestures}
            disabled={camera === "starting"}
          >
            {camera === "starting"
              ? "INITIALIZING…"
              : cameraOn
              ? "GESTURES ON"
              : "GESTURES OFF"}
          </button>
        </div>

        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            onClick={() => sceneRef.current?.zoomIn()}
            aria-label="Zoom in"
          >
            +
          </button>

          <button
            type="button"
            className="hud-btn"
            onClick={() => sceneRef.current?.zoomOut()}
            aria-label="Zoom out"
          >
            −
          </button>

          <button
            type="button"
            className="hud-btn"
            onClick={() => sceneRef.current?.resetView()}
          >
            RESET
          </button>
        </div>
      </div>
    </>
  );
}